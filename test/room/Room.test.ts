import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import type { ServerMessage } from "../../src/shared/messages";
import { createQuestionSet } from "../../src/worker/questionSets";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";

const testEnv = env as unknown as { ROOM: DurableObjectNamespace; DB: D1Database };

function stubFor(code: string) {
  return testEnv.ROOM.get(testEnv.ROOM.idFromName(code));
}

async function initRoom(code: string, gmToken = "gm-token") {
  const res = await stubFor(code).fetch("http://room/init", {
    method: "POST", body: JSON.stringify({ roomCode: code, gmToken }),
  });
  expect(res.status).toBe(200);
}

async function join(code: string, nickname: string) {
  const res = await stubFor(code).fetch("http://room/join", { method: "POST", body: JSON.stringify({ nickname }) });
  expect(res.status).toBe(200);
  return (await res.json()) as { participantId: string; participantToken: string };
}

class Client {
  received: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];
  constructor(public ws: WebSocket) {
    ws.accept();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data as string) as ServerMessage;
      this.received.push(m);
      this.waiters.splice(0).forEach((w) => w(m));
    });
  }
  send(m: unknown) { this.ws.send(typeof m === "string" ? m : JSON.stringify(m)); }
  /** 指定 type（と任意の条件）に合う最初のメッセージを返し、バッファから取り除く */
  async waitFor<T extends ServerMessage["type"]>(
    type: T,
    pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    type M = Extract<ServerMessage, { type: T }>;
    const matches = (m: ServerMessage): m is M => m.type === type && pred(m as M);
    const found = this.received.find(matches);
    if (found) { this.received.splice(this.received.indexOf(found), 1); return found; }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
      const check = (m: ServerMessage) => {
        if (matches(m)) { clearTimeout(t); this.received.splice(this.received.indexOf(m), 1); resolve(m); }
        else this.waiters.push(check);
      };
      this.waiters.push(check);
    });
  }
}

async function connect(code: string, token: string): Promise<Client> {
  const res = await stubFor(code).fetch(`http://room/ws?token=${token}`, { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  return new Client(res.webSocket!);
}

async function seedSet(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
  return createQuestionSet(testEnv.DB, {
    name: "テスト",
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    questions: [
      { id: "q1", type: "anagram", prompt: "ごんり", answers: ["りんご"] },
      { id: "q2", type: "anagram", prompt: "なばな", answers: ["ばなな"] },
    ],
  });
}

describe("Room DO lifecycle", () => {
  it("init is required before join and exists", async () => {
    expect((await stubFor("NEW001").fetch("http://room/exists")).status).toBe(404);
    expect((await stubFor("NEW001").fetch("http://room/join", { method: "POST", body: JSON.stringify({ nickname: "a" }) })).status).toBe(404);
    await initRoom("NEW001");
    expect((await stubFor("NEW001").fetch("http://room/exists")).status).toBe(200);
    const again = await stubFor("NEW001").fetch("http://room/init", { method: "POST", body: JSON.stringify({ roomCode: "NEW001", gmToken: "x" }) });
    expect(again.status).toBe(409);
  });

  it("rejects websocket with a bad token", async () => {
    await initRoom("BAD001");
    const res = await stubFor("BAD001").fetch("http://room/ws?token=nope", { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
  });

  it("sends state on connect and broadcasts joins", async () => {
    await initRoom("JOIN01");
    const gm = await connect("JOIN01", "gm-token");
    const st = await gm.waitFor("state");
    expect(st.role).toBe("gm");
    expect(st.phase).toBe("lobby");
    expect(st.roomCode).toBe("JOIN01");
    expect(typeof st.serverTime).toBe("number");

    const p1 = await join("JOIN01", "みさき");
    const joined = await gm.waitFor("participantJoined");
    expect(joined.participant).toMatchObject({ id: p1.participantId, nickname: "みさき", score: 0 });

    const c1 = await connect("JOIN01", p1.participantToken);
    const pst = await c1.waitFor("state");
    expect(pst.role).toBe("player");
    expect(pst.me).toMatchObject({ id: p1.participantId, nickname: "みさき" });
  });

  it("numbers duplicate nicknames", async () => {
    await initRoom("DUP001");
    await join("DUP001", "みさき");
    await join("DUP001", "みさき");
    const third = await join("DUP001", "みさき");
    const c3 = await connect("DUP001", third.participantToken);
    const st = await c3.waitFor("state");
    expect(st.participants.map((p) => p.nickname).sort()).toEqual(["みさき", "みさき (2)", "みさき (3)"]);
    expect(st.me?.nickname).toBe("みさき (3)");
  });
});

describe("Room DO game flow", () => {
  it("runs a full game: start, answer, popup, leaderboard, close, next, final", async () => {
    const set = await seedSet({ timerMode: "none" });
    await initRoom("GAME01");
    const gm = await connect("GAME01", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("GAME01", "みさき");
    const p2 = await join("GAME01", "たろう");
    const c1 = await connect("GAME01", p1.participantToken);
    const c2 = await connect("GAME01", p2.participantToken);
    await c1.waitFor("state"); await c2.waitFor("state");

    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    const qs = await c1.waitFor("questionStarted");
    expect(qs.question).toMatchObject({ index: 0, total: 2, prompt: "ごんり", deadlineAt: null });
    await c2.waitFor("questionStarted");

    c1.send({ type: "answer", text: "リンゴ" });
    const r1 = await c1.waitFor("answerResult");
    expect(r1).toEqual({ type: "answerResult", correct: true, correctRank: 1, remainingAttempts: null, points: 150 });
    const popup = await gm.waitFor("someoneCorrect");
    expect(popup).toMatchObject({ nickname: "みさき", correctRank: 1, points: 150 });
    // 入室時・開始時にも leaderboard が届いているので、スコアが反映されたものを待つ
    const lb = await gm.waitFor("leaderboard", (m) => m.entries.some((e) => e.score > 0));
    expect(lb.entries[0]).toMatchObject({ nickname: "みさき", score: 150, rank: 1 });

    c2.send({ type: "answer", text: "ごりら" });
    const r2 = await c2.waitFor("answerResult");
    expect(r2).toEqual({ type: "answerResult", correct: false, correctRank: null, remainingAttempts: 2, points: 0 });

    gm.send({ type: "close" });
    const closed = await c2.waitFor("questionClosed");
    expect(closed.result.answers).toEqual(["りんご"]);
    expect(closed.result.results).toHaveLength(1);

    gm.send({ type: "next" });
    expect((await c1.waitFor("questionStarted", (m) => m.question.index === 1)).question.prompt).toBe("なばな");
    gm.send({ type: "close" });
    await gm.waitFor("questionClosed", (m) => m.result.answers[0] === "ばなな");
    gm.send({ type: "next" });
    const fin = await c2.waitFor("finalResult");
    expect(fin.entries[0]).toMatchObject({ nickname: "みさき", score: 150 });

    gm.send({ type: "endGame" });
    // 再接続で state が lobby になっていること
    const gm2 = await connect("GAME01", "gm-token");
    expect((await gm2.waitFor("state")).phase).toBe("lobby");
  });

  it("rejects GM commands from players and answers outside question phase", async () => {
    await initRoom("PERM01");
    const p1 = await join("PERM01", "みさき");
    const c1 = await connect("PERM01", p1.participantToken);
    await c1.waitFor("state");
    c1.send({ type: "start", questionSetId: "x", carryOverScores: false });
    expect((await c1.waitFor("error")).code).toBe("forbidden");
    c1.send({ type: "answer", text: "りんご" });
    expect((await c1.waitFor("error")).code).toBe("not_in_question");
    c1.send("not json");
    c1.send(JSON.stringify({ type: "unknown" }));
    expect((await c1.waitFor("error")).code).toBe("bad_message");
  });

  it("returns question_set_not_found for a missing set", async () => {
    await initRoom("MISS01");
    const gm = await connect("MISS01", "gm-token");
    await gm.waitFor("state");
    gm.send({ type: "start", questionSetId: "does-not-exist", carryOverScores: false });
    expect((await gm.waitFor("error")).code).toBe("question_set_not_found");
  });

  it("closes the question automatically when the deadline alarm fires", async () => {
    // 1秒後の締切を設定し、runDurableObjectAlarm で alarm() を即時実行する
    const set = await seedSet({ timerMode: "fixed", timerSeconds: 1 });
    await initRoom("ALRM01");
    const gm = await connect("ALRM01", "gm-token");
    await gm.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    const qs = await gm.waitFor("questionStarted");
    expect(qs.question.deadlineAt).not.toBeNull();
    const ran = await runDurableObjectAlarm(stubFor("ALRM01"));
    expect(ran).toBe(true);
    const closed = await gm.waitFor("questionClosed");
    expect(closed.result.answers).toEqual(["りんご"]);
    const gm2 = await connect("ALRM01", "gm-token");
    expect((await gm2.waitFor("state")).phase).toBe("questionResult");
  });

  it("closes automatically when every connected participant is done", async () => {
    const set = await seedSet({ timerMode: "none", maxAttempts: 1 });
    await initRoom("DONE01");
    const gm = await connect("DONE01", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("DONE01", "みさき");
    const c1 = await connect("DONE01", p1.participantToken);
    await c1.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    await c1.waitFor("questionStarted");
    c1.send({ type: "answer", text: "ごりら" });
    await c1.waitFor("answerResult");
    const closed = await gm.waitFor("questionClosed");
    expect(closed.result.results).toHaveLength(0);
  });

  it("marks participants disconnected on close and broadcasts participantLeft", async () => {
    await initRoom("LEFT01");
    const gm = await connect("LEFT01", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("LEFT01", "みさき");
    const c1 = await connect("LEFT01", p1.participantToken);
    await c1.waitFor("state");
    await gm.waitFor("participantJoined");
    c1.ws.close(1000, "bye");
    const left = await gm.waitFor("participantLeft");
    expect(left.participant).toMatchObject({ id: p1.participantId, connected: false });
  });
});

describe("Room DO GM live controls", () => {
  it("rejects live-control commands from players", async () => {
    await initRoom("LIVE00");
    const p1 = await join("LIVE00", "みさき");
    const c1 = await connect("LIVE00", p1.participantToken);
    await c1.waitFor("state");
    c1.send({ type: "updateSettings", settings: { timerSeconds: 5 } });
    expect((await c1.waitFor("error")).code).toBe("forbidden");
    c1.send({ type: "adjustScore", participantId: p1.participantId, delta: 100 });
    expect((await c1.waitFor("error")).code).toBe("forbidden");
    c1.send({ type: "kick", participantId: p1.participantId });
    expect((await c1.waitFor("error")).code).toBe("forbidden");
  });

  it("rejects malformed live-control payloads as bad_message", async () => {
    await initRoom("LIVE01");
    const gm = await connect("LIVE01", "gm-token");
    await gm.waitFor("state");
    for (const bad of [
      { type: "updateSettings", settings: { timerSeconds: 0 } },
      { type: "updateSettings", settings: { timerSeconds: 1.5 } },
      { type: "updateSettings", settings: { maxAttempts: 0 } },
      { type: "updateSettings", settings: { wrongPenalty: -1 } },
      { type: "updateSettings", settings: { basePoints: -1 } },
      { type: "updateSettings", settings: { timerMode: "soon" } },
      { type: "updateSettings", settings: { rankBonus: ["a"] } },
      { type: "updateSettings", settings: { unknown: 1 } },
      { type: "updateSettings" },
      { type: "adjustScore", participantId: "x", delta: "10" },
      { type: "adjustScore", participantId: "x", delta: 1.5 },
      { type: "kick" },
    ]) {
      gm.send(bad);
      expect((await gm.waitFor("error")).code).toBe("bad_message");
    }
  });

  it("updateSettings overrides the set from the next question and is included in state", async () => {
    const set = await seedSet({ timerMode: "fixed", timerSeconds: 30, maxAttempts: 3, wrongPenalty: 0 });
    await initRoom("LIVE02");
    const gm = await connect("LIVE02", "gm-token");
    const st0 = await gm.waitFor("state");
    expect(st0.settings).toEqual({ override: {}, effective: null });
    const p1 = await join("LIVE02", "みさき");
    const c1 = await connect("LIVE02", p1.participantToken);
    await c1.waitFor("state");

    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    const q0 = await gm.waitFor("questionStarted");
    const startedAt = q0.question.deadlineAt! - 30_000;
    // 開始時に実際に効く設定が配られる
    const atStart = await gm.waitFor("settingsUpdated");
    expect(atStart.settings).toEqual({ override: {}, effective: { ...DEFAULT_SETTINGS, timerMode: "fixed", timerSeconds: 30, maxAttempts: 3, wrongPenalty: 0 } });
    await c1.waitFor("settingsUpdated");

    gm.send({ type: "updateSettings", settings: { timerSeconds: 5, maxAttempts: null } });
    const upd = await gm.waitFor("settingsUpdated");
    expect(upd.settings.override).toEqual({ timerSeconds: 5, maxAttempts: null });
    expect(upd.settings.effective).toEqual({ timerMode: "fixed", timerSeconds: 5, maxAttempts: null, wrongPenalty: 0, basePoints: 100, rankBonus: [50, 30, 10] });
    // 参加者にも届き、残り回答回数の表示に使う maxAttempts が今の問題に反映される
    const updP = await c1.waitFor("settingsUpdated");
    expect(updP.settings.effective?.maxAttempts).toBeNull();

    gm.send({ type: "close" });
    await gm.waitFor("questionClosed");
    gm.send({ type: "next" });
    const q1 = await gm.waitFor("questionStarted", (m) => m.question.index === 1);
    expect(q1.question.maxAttempts).toBeNull();
    expect(q1.question.deadlineAt! - startedAt).toBeLessThan(30_000);

    const gm2 = await connect("LIVE02", "gm-token");
    const st = await gm2.waitFor("state");
    expect(st.settings.override).toEqual({ timerSeconds: 5, maxAttempts: null });
    expect(st.settings.effective).toMatchObject({ timerSeconds: 5, maxAttempts: null });
  });

  it("switching timerMode to fixed mid-question starts a countdown now and the alarm closes the question", async () => {
    const set = await seedSet({ timerMode: "none", timerSeconds: 60 });
    await initRoom("LIVE25");
    const gm = await connect("LIVE25", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("LIVE25", "みさき");
    const c1 = await connect("LIVE25", p1.participantToken);
    await c1.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    expect((await gm.waitFor("questionStarted")).question.deadlineAt).toBeNull();

    const before = Date.now();
    gm.send({ type: "updateSettings", settings: { timerMode: "fixed", timerSeconds: 1 } });
    const dl = await gm.waitFor("deadlineSet");
    expect(dl.deadlineAt).toBeGreaterThanOrEqual(before + 1_000);
    expect((await c1.waitFor("deadlineSet")).deadlineAt).toBe(dl.deadlineAt);
    await gm.waitFor("settingsUpdated");

    expect(await runDurableObjectAlarm(stubFor("LIVE25"))).toBe(true);
    await gm.waitFor("questionClosed");
    expect((await (await connect("LIVE25", "gm-token")).waitFor("state")).phase).toBe("questionResult");
  });

  it("switching timerMode to none mid-question clears the deadline and the alarm no longer closes it", async () => {
    const set = await seedSet({ timerMode: "fixed", timerSeconds: 1 });
    await initRoom("LIVE26");
    const gm = await connect("LIVE26", "gm-token");
    await gm.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    expect((await gm.waitFor("questionStarted")).question.deadlineAt).not.toBeNull();

    const p1 = await join("LIVE26", "みさき");
    const c1 = await connect("LIVE26", p1.participantToken);
    await c1.waitFor("state");

    gm.send({ type: "updateSettings", settings: { timerMode: "none" } });
    expect((await gm.waitFor("deadlineSet")).deadlineAt).toBeNull();
    await gm.waitFor("settingsUpdated");
    const st = await (await connect("LIVE26", "gm-token")).waitFor("state");
    expect(st.phase).toBe("question");
    expect(st.question?.deadlineAt).toBeNull();

    // 元の締切（1秒）を過ぎても回答を受け付ける
    await new Promise((r) => setTimeout(r, 1_200));
    c1.send({ type: "answer", text: "りんご" });
    expect((await c1.waitFor("answerResult")).correct).toBe(true);
  });

  it("changing only the seconds mid-question keeps the running deadline and sends no deadlineSet", async () => {
    const set = await seedSet({ timerMode: "fixed", timerSeconds: 30 });
    await initRoom("LIVE27");
    const gm = await connect("LIVE27", "gm-token");
    await gm.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    const q = await gm.waitFor("questionStarted");
    gm.send({ type: "updateSettings", settings: { timerSeconds: 5 } });
    await gm.waitFor("settingsUpdated");
    expect(gm.received.some((m) => m.type === "deadlineSet")).toBe(false);
    const st = await (await connect("LIVE27", "gm-token")).waitFor("state");
    expect(st.question?.deadlineAt).toBe(q.question.deadlineAt);
  });

  it("adjustScore changes the score and broadcasts the leaderboard", async () => {
    await initRoom("LIVE03");
    const gm = await connect("LIVE03", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("LIVE03", "みさき");
    const c1 = await connect("LIVE03", p1.participantToken);
    await c1.waitFor("state");

    gm.send({ type: "adjustScore", participantId: p1.participantId, delta: -40 });
    const lb = await c1.waitFor("leaderboard", (m) => m.entries.some((e) => e.score !== 0));
    expect(lb.entries[0]).toMatchObject({ participantId: p1.participantId, score: -40 });

    gm.send({ type: "adjustScore", participantId: "nobody", delta: 1 });
    expect((await gm.waitFor("error")).code).toBe("participant_not_found");
  });

  it("kick removes the participant, notifies them, closes their socket and invalidates their token", async () => {
    await initRoom("LIVE04");
    const gm = await connect("LIVE04", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("LIVE04", "みさき");
    const p2 = await join("LIVE04", "たろう");
    const c1 = await connect("LIVE04", p1.participantToken);
    const c2 = await connect("LIVE04", p2.participantToken);
    await c1.waitFor("state"); await c2.waitFor("state");
    const closed = new Promise<void>((resolve) => c1.ws.addEventListener("close", () => resolve()));

    gm.send({ type: "kick", participantId: p1.participantId });
    expect(await c1.waitFor("kicked")).toEqual({ type: "kicked" });
    await closed;
    const removed = await gm.waitFor("participantRemoved");
    expect(removed.participant).toMatchObject({ id: p1.participantId, nickname: "みさき" });
    expect((await c2.waitFor("participantRemoved")).participant.id).toBe(p1.participantId);

    const res = await stubFor("LIVE04").fetch(`http://room/ws?token=${p1.participantToken}`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
    const gm2 = await connect("LIVE04", "gm-token");
    const st = await gm2.waitFor("state");
    expect(st.participants.map((p) => p.id)).toEqual([p2.participantId]);
    expect(st.leaderboard.map((e) => e.participantId)).toEqual([p2.participantId]);

    gm.send({ type: "kick", participantId: p1.participantId });
    expect((await gm.waitFor("error")).code).toBe("participant_not_found");
  });

  it("kicking the last undecided participant closes the question", async () => {
    const set = await seedSet({ timerMode: "none" });
    await initRoom("LIVE15");
    const gm = await connect("LIVE15", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("LIVE15", "みさき");
    const p2 = await join("LIVE15", "たろう");
    const c1 = await connect("LIVE15", p1.participantToken);
    const c2 = await connect("LIVE15", p2.participantToken);
    await c1.waitFor("state"); await c2.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    await c1.waitFor("questionStarted"); await c2.waitFor("questionStarted");
    c1.send({ type: "answer", text: "りんご" });
    await c1.waitFor("answerResult");

    gm.send({ type: "kick", participantId: p2.participantId });
    await gm.waitFor("participantRemoved");
    const closed = await gm.waitFor("questionClosed");
    expect(closed.result.results.map((r) => r.participantId)).toEqual([p1.participantId]);
  });
});
