import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
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
  /** 受け取ったすべてのメッセージ（waitFor で取り除かない） */
  log: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];
  constructor(public ws: WebSocket) {
    ws.accept();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data as string) as ServerMessage;
      this.received.push(m);
      this.log.push(m);
      this.waiters.splice(0).forEach((w) => w(m));
    });
  }
  send(m: unknown) { this.ws.send(typeof m === "string" ? m : JSON.stringify(m)); }
  /**
   * 指定 type（と任意の条件）に合う最初のメッセージを返し、バッファから取り除く。
   * 全件を並列に流すと、ローカルの Durable Object がまれに 2 秒ほど止まって 1 通だけ遅れて届くので、上限は長めにとる
   */
  async waitFor<T extends ServerMessage["type"]>(
    type: T,
    pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 10_000,
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

/** 開始してタイトルスライドを飛ばし、第1問が始まるまで進める（説明スライドの無いセット用） */
async function startGame(gm: Client, questionSetId: string, carryOverScores = false) {
  gm.send({ type: "start", questionSetId, carryOverScores });
  await gm.waitFor("introStarted");
  gm.send({ type: "next" });
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

    await startGame(gm, set.id);
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
    // send は送りっぱなしなので、反映（全員への state）を待ってからつなぎ直す。
    // 待たないと、再接続の方が先に届いて finalResult の state が返ることがある
    await gm.waitFor("state", (m) => m.phase === "lobby");
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
    await startGame(gm, set.id);
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
    await startGame(gm, set.id);
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
    expect(st0.settings).toEqual({ override: {}, effective: null, mode: null });
    const p1 = await join("LIVE02", "みさき");
    const c1 = await connect("LIVE02", p1.participantToken);
    await c1.waitFor("state");

    await startGame(gm, set.id);
    const q0 = await gm.waitFor("questionStarted");
    const startedAt = q0.question.deadlineAt! - 30_000;
    // 開始時に実際に効く設定が配られる
    const atStart = await gm.waitFor("settingsUpdated");
    expect(atStart.settings).toEqual({ override: {}, effective: { ...DEFAULT_SETTINGS, timerMode: "fixed", timerSeconds: 30, maxAttempts: 3, wrongPenalty: 0 }, mode: "anagram" });
    await c1.waitFor("settingsUpdated");

    gm.send({ type: "updateSettings", settings: { timerSeconds: 5, maxAttempts: null } });
    // start（タイトル）と第1問の開始で settingsUpdated が2回届いているので、上書き入りのものを待つ
    const isOverride = (m: { settings: { override: { timerSeconds?: number } } }) => m.settings.override.timerSeconds === 5;
    const upd = await gm.waitFor("settingsUpdated", isOverride);
    expect(upd.settings.override).toEqual({ timerSeconds: 5, maxAttempts: null });
    expect(upd.settings.effective).toEqual({ timerMode: "fixed", timerSeconds: 5, maxAttempts: null, wrongPenalty: 0, basePoints: 100, rankBonus: [50, 30, 10], charsPerSecond: 6 });
    // 参加者にも届き、残り回答回数の表示に使う maxAttempts が今の問題に反映される
    const updP = await c1.waitFor("settingsUpdated", isOverride);
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
    await startGame(gm, set.id);
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
    await startGame(gm, set.id);
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
    await startGame(gm, set.id);
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
    await startGame(gm, set.id);
    await c1.waitFor("questionStarted"); await c2.waitFor("questionStarted");
    c1.send({ type: "answer", text: "りんご" });
    await c1.waitFor("answerResult");

    gm.send({ type: "kick", participantId: p2.participantId });
    await gm.waitFor("participantRemoved");
    const closed = await gm.waitFor("questionClosed");
    expect(closed.result.results.map((r) => r.participantId)).toEqual([p1.participantId]);
  });
});

describe("Room DO intro slides", () => {
  async function seedSetWithIntro() {
    return createQuestionSet(testEnv.DB, {
      name: "イントロ",
      settings: { ...DEFAULT_SETTINGS, timerMode: "fixed", timerSeconds: 1 },
      introSlides: [{ id: "s1", heading: "ルール", body: "3回まで" }],
      questions: [{ id: "q1", type: "anagram", prompt: "ごんり", answers: ["りんご"] }],
    });
  }

  it("start shows the title, next shows each slide, then question 1 arms the deadline alarm", async () => {
    const set = await seedSetWithIntro();
    await initRoom("INTR01");
    const gm = await connect("INTR01", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("INTR01", "みさき");
    const c1 = await connect("INTR01", p1.participantToken);
    await c1.waitFor("state");

    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    const title = await c1.waitFor("introStarted");
    expect(title.intro).toMatchObject({ index: 0, total: 2, slide: { kind: "title", name: "イントロ", questionCount: 1, settings: { timerSeconds: 1 } } });
    expect((await gm.waitFor("introStarted")).intro.index).toBe(0);
    expect((await gm.waitFor("settingsUpdated")).settings.effective?.timerSeconds).toBe(1);

    // intro 中に再接続すると state に intro が入り、question は無い
    const gm2 = await connect("INTR01", "gm-token");
    const st = await gm2.waitFor("state");
    expect(st.phase).toBe("intro");
    expect(st.intro?.index).toBe(0);
    expect(st.question).toBeNull();

    // intro 中は回答も締切も再開始もできない
    c1.send({ type: "answer", text: "りんご" });
    expect((await c1.waitFor("error")).code).toBe("not_in_question");
    gm.send({ type: "close" });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");

    gm.send({ type: "next" });
    const slide = await c1.waitFor("introStarted", (m) => m.intro.index === 1);
    expect(slide.intro.slide).toEqual({ kind: "slide", heading: "ルール", body: "3回まで", imageUrl: undefined });

    gm.send({ type: "next" });
    const qs = await c1.waitFor("questionStarted");
    expect(qs.question).toMatchObject({ index: 0, prompt: "ごんり" });
    expect(qs.question.deadlineAt).not.toBeNull();
    // 第1問に入った時点で締切アラームが張られている
    expect(await runDurableObjectAlarm(stubFor("INTR01"))).toBe(true);
    await c1.waitFor("questionClosed");
  });

  it("the alarm during intro is the 24h cleanup, not a deadline", async () => {
    const set = await seedSetWithIntro();
    await initRoom("INTR02");
    const gm = await connect("INTR02", "gm-token");
    await gm.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    await gm.waitFor("introStarted");
    expect(await runDurableObjectAlarm(stubFor("INTR02"))).toBe(true);
    // cleanup が走ったのでルームは消えている
    expect((await stubFor("INTR02").fetch("http://room/exists")).status).toBe(404);
  });

  it("updateSettings during intro only broadcasts settingsUpdated and the title reflects it", async () => {
    const set = await seedSetWithIntro();
    await initRoom("INTR03");
    const gm = await connect("INTR03", "gm-token");
    await gm.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    await gm.waitFor("introStarted");
    gm.send({ type: "updateSettings", settings: { maxAttempts: 5 } });
    const su = await gm.waitFor("settingsUpdated", (m) => m.settings.override.maxAttempts === 5);
    expect(su.settings.effective?.maxAttempts).toBe(5);
    expect(gm.received.some((m) => m.type === "deadlineSet")).toBe(false);
    const gm2 = await connect("INTR03", "gm-token");
    const st = await gm2.waitFor("state");
    expect(st.intro?.slide).toMatchObject({ kind: "title", settings: { maxAttempts: 5 } });
  });

  it("start from finalResult shows the title again and keeps scores when carrying over", async () => {
    const set = await seedSet({ timerMode: "none" });
    await initRoom("INTR04");
    const gm = await connect("INTR04", "gm-token");
    await gm.waitFor("state");
    const p1 = await join("INTR04", "みさき");
    const c1 = await connect("INTR04", p1.participantToken);
    await c1.waitFor("state");
    await startGame(gm, set.id);
    await c1.waitFor("questionStarted");
    c1.send({ type: "answer", text: "りんご" });
    await c1.waitFor("answerResult");
    gm.send({ type: "close" }); await gm.waitFor("questionClosed");
    gm.send({ type: "next" }); await gm.waitFor("questionStarted", (m) => m.question.index === 1);
    gm.send({ type: "close" }); await gm.waitFor("questionClosed", (m) => m.result.answers[0] === "ばなな");
    gm.send({ type: "next" }); await gm.waitFor("finalResult");

    // ここまでに届いた leaderboard を捨て、2ゲーム目の開始で届くものだけを見る
    gm.received.length = 0;
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: true });
    const title = await c1.waitFor("introStarted");
    expect(title.intro.slide.kind).toBe("title");
    const lb = await gm.waitFor("leaderboard", (m) => m.entries[0]?.nickname === "みさき");
    expect(lb.entries[0].score).toBe(150);
  });
});

describe("Room DO buzzer mode", () => {
  const PROMPT = "日本で一番高い山は何でしょう？";
  async function seedBuzzerSet() {
    return createQuestionSet(testEnv.DB, {
      name: "早押し", mode: "buzzer",
      settings: { ...DEFAULT_SETTINGS, timerMode: "fixed", timerSeconds: 1, charsPerSecond: 5, wrongPenalty: 20 },
      questions: [
        { id: "b1", type: "anagram", prompt: PROMPT, answers: ["富士山"], hint: "静岡" },
        { id: "b2", type: "anagram", prompt: "二番目は？", answers: ["北岳"] },
      ],
    });
  }
  async function setup(code: string) {
    const set = await seedBuzzerSet();
    await initRoom(code);
    const gm = await connect(code, "gm-token");
    await gm.waitFor("state");
    const p1 = await join(code, "みさき");
    const p2 = await join(code, "たろう");
    const c1 = await connect(code, p1.participantToken);
    const c2 = await connect(code, p2.participantToken);
    await c1.waitFor("state"); await c2.waitFor("state");
    await startGame(gm, set.id);
    const qsGm = await gm.waitFor("questionStarted");
    const qs1 = await c1.waitFor("questionStarted");
    await c2.waitFor("questionStarted");
    return { set, gm, p1, p2, c1, c2, qsGm, qs1 };
  }

  it("sends the prompt only to the GM, starts ready without a deadline, and the alarm is the cleanup", async () => {
    const { gm, c1, qsGm, qs1 } = await setup("BUZZ01");
    expect(qsGm.question).toMatchObject({ mode: "buzzer", prompt: PROMPT, hint: "静岡", deadlineAt: null });
    expect(qs1.question).toMatchObject({ mode: "buzzer", prompt: "", deadlineAt: null });
    expect(qs1.question.hint).toBeUndefined();
    const bz = await c1.waitFor("buzzerUpdated");
    expect(bz.buzzer).toMatchObject({ status: "ready", promptLength: 15, charsPerSecond: 5, queue: [], lockedOut: [] });
    await gm.waitFor("buzzerUpdated");
    expect((await gm.waitFor("settingsUpdated")).settings.mode).toBe("buzzer");
    // 締切アラームではなく 24h の cleanup なので、発火するとルームが消える
    expect(await runDurableObjectAlarm(stubFor("BUZZ01"))).toBe(true);
    expect((await stubFor("BUZZ01").fetch("http://room/exists")).status).toBe(404);
  });

  it("runs a buzzer question: startReading, buzz, wrong, next answerer, correct, closed", async () => {
    const { gm, p1, p2, c1, c2 } = await setup("BUZZ02");
    c1.send({ type: "buzz" });
    expect((await c1.waitFor("error")).code).toBe("not_reading");
    c1.send({ type: "answer", text: "富士山" });
    expect((await c1.waitFor("error")).code).toBe("not_in_question");

    gm.send({ type: "startReading" });
    const reading = await c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    expect(reading.buzzer.readingStartedAt).not.toBeNull();

    c2.send({ type: "buzz" });
    const paused = await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "paused");
    expect(paused.buzzer.queue).toEqual([{ participantId: p2.participantId, nickname: "たろう" }]);
    c1.send({ type: "buzz" });
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 2);
    c1.send({ type: "buzz" });
    expect((await c1.waitFor("error")).code).toBe("already_buzzed");

    gm.send({ type: "judge", participantId: p2.participantId, correct: false });
    const wrong = await c2.waitFor("answerResult");
    expect(wrong).toEqual({ type: "answerResult", correct: false, correctRank: null, remainingAttempts: 0, points: -20 });
    const nextUp = await gm.waitFor("buzzerUpdated", (m) => m.buzzer.lockedOut.length === 1);
    expect(nextUp.buzzer).toMatchObject({ status: "paused", queue: [{ participantId: p1.participantId, nickname: "みさき" }], lockedOut: [p2.participantId] });
    expect((await gm.waitFor("leaderboard", (m) => m.entries.some((e) => e.score < 0))).entries.find((e) => e.participantId === p2.participantId)?.score).toBe(-20);
    c2.send({ type: "buzz" });
    expect((await c2.waitFor("error")).code).toBe("locked_out");

    // 「不正解」の二度押し: 判定対象が回答中の人（p1）と違うので拒否され、p1 は減点されない
    gm.send({ type: "judge", participantId: p2.participantId, correct: false });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");

    gm.send({ type: "judge", participantId: p1.participantId, correct: true });
    expect(await c1.waitFor("answerResult")).toEqual({ type: "answerResult", correct: true, correctRank: 1, remainingAttempts: null, points: 100 });
    expect(await gm.waitFor("someoneCorrect")).toMatchObject({ nickname: "みさき", correctRank: 1, points: 100 });
    const closed = await c2.waitFor("questionClosed");
    expect(closed.result.answers).toEqual(["富士山"]);
    expect(closed.result.results).toEqual([{ participantId: p1.participantId, nickname: "みさき", correctRank: 1, points: 100 }]);

    // 「正解」の二度押し: すでに閉じているので invalid_state、点数は変わらない
    gm.send({ type: "judge", participantId: p1.participantId, correct: true });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");
    const gm2 = await connect("BUZZ02", "gm-token");
    const st = await gm2.waitFor("state");
    expect(st.phase).toBe("questionResult");
    expect(st.buzzer).toBeNull();
    expect(st.leaderboard.find((e) => e.participantId === p1.participantId)?.score).toBe(100);
  });

  it("rejects startReading/judge from players and buzz from the GM, and startReading twice", async () => {
    const { gm, c1 } = await setup("BUZZ03");
    c1.send({ type: "startReading" });
    expect((await c1.waitFor("error")).code).toBe("forbidden");
    c1.send({ type: "judge", participantId: "x", correct: true });
    expect((await c1.waitFor("error")).code).toBe("forbidden");
    gm.send({ type: "buzz" });
    expect((await gm.waitFor("error")).code).toBe("forbidden");
    gm.send({ type: "judge", participantId: "x", correct: true });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");
    gm.send({ type: "startReading" });
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    gm.send({ type: "startReading" });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");
  });

  it("a GM reconnecting mid-answer gets the queue with nicknames in state", async () => {
    const { gm, p2, c2 } = await setup("BUZZ04");
    gm.send({ type: "startReading" });
    await c2.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c2.send({ type: "buzz" });
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "paused");
    const gm2 = await connect("BUZZ04", "gm-token");
    const st = await gm2.waitFor("state");
    expect(st.question?.prompt).toBe(PROMPT);
    expect(st.buzzer).toMatchObject({ status: "paused", queue: [{ participantId: p2.participantId, nickname: "たろう" }] });
    // 参加者の再接続では問題文は空のまま
    const c2b = await connect("BUZZ04", (await join("BUZZ04", "ゆい")).participantToken);
    expect((await c2b.waitFor("state")).question?.prompt).toBe("");
  });

  it("closes automatically when every connected participant is locked out", async () => {
    const { gm, p1, p2, c1, c2 } = await setup("BUZZ05");
    gm.send({ type: "startReading" });
    await c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c1.send({ type: "buzz" }); await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 1);
    gm.send({ type: "judge", participantId: p1.participantId, correct: false });
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.lockedOut.length === 1);
    c2.send({ type: "buzz" }); await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 1);
    gm.send({ type: "judge", participantId: p2.participantId, correct: false });
    const closed = await gm.waitFor("questionClosed");
    expect(closed.result.results).toEqual([]);
  });

  it("kicking the answerer passes the turn and broadcasts buzzerUpdated", async () => {
    const { gm, p1, p2, c1, c2 } = await setup("BUZZ06");
    gm.send({ type: "startReading" });
    await c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c1.send({ type: "buzz" }); await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 1);
    c2.send({ type: "buzz" }); await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 2);
    gm.send({ type: "kick", participantId: p1.participantId });
    await gm.waitFor("participantRemoved");
    const after = await gm.waitFor("buzzerUpdated", (m) => m.buzzer.queue.length === 1);
    expect(after.buzzer.queue[0].participantId).toBe(p2.participantId);
  });

  it("changing charsPerSecond mid-reading rebases the segment and broadcasts buzzerUpdated", async () => {
    const { gm, c1 } = await setup("BUZZ07");
    gm.send({ type: "startReading" });
    const reading = await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    gm.send({ type: "updateSettings", settings: { charsPerSecond: 20 } });
    const rebased = await c1.waitFor("buzzerUpdated", (m) => m.buzzer.charsPerSecond === 20);
    expect(rebased.buzzer.status).toBe("reading");
    expect(rebased.buzzer.readingStartedAt!).toBeGreaterThanOrEqual(reading.buzzer.readingStartedAt!);
    expect((await gm.waitFor("settingsUpdated", (m) => m.settings.override.charsPerSecond === 20)).settings.effective?.charsPerSecond).toBe(20);
  });
});

describe("Room DO judge device", () => {
  const PROMPT = "日本で一番高い山は何でしょう？";
  const NOTE = "山だけは不正解";
  async function seedJudgeSet() {
    return createQuestionSet(testEnv.DB, {
      name: "早押し判定", mode: "buzzer",
      settings: { ...DEFAULT_SETTINGS, charsPerSecond: 5, wrongPenalty: 20 },
      questions: [
        { id: "b1", type: "anagram", prompt: PROMPT, answers: ["富士山"], judgeNote: NOTE },
        { id: "b2", type: "anagram", prompt: "二番目は？", answers: ["北岳"] },
      ],
    });
  }
  /** GM がペアリング QR を出し、そのコードで判定用トークンを受け取る */
  async function issueCode(gm: Client, code: string) {
    gm.send({ type: "issueJudgePairing" });
    const pairing = await gm.waitFor("judgePairing");
    const m = pairing.url.match(new RegExp(`^/judge/${code}#pair=([0-9a-f]{64})$`));
    expect(m).not.toBeNull();
    return { pairCode: m![1], expiresAt: pairing.expiresAt };
  }
  function postPair(code: string, pairCode: string) {
    return stubFor(code).fetch("http://room/judge-pair", { method: "POST", body: JSON.stringify({ pairCode }) });
  }
  async function pair(gm: Client, code: string) {
    const { pairCode } = await issueCode(gm, code);
    const res = await postPair(code, pairCode);
    expect(res.status).toBe(200);
    return ((await res.json()) as { judgeToken: string }).judgeToken;
  }
  /** 判定用端末をつないでから早押しセットを開始し、第1問まで進める */
  async function setup(code: string) {
    const set = await seedJudgeSet();
    await initRoom(code);
    const gm = await connect(code, "gm-token");
    await gm.waitFor("state");
    const judgeToken = await pair(gm, code);
    const jd = await connect(code, judgeToken);
    expect((await jd.waitFor("state")).role).toBe("judge");
    await gm.waitFor("judgeStatus", (m) => m.connected);
    const p1 = await join(code, "みさき");
    const p2 = await join(code, "たろう");
    const c1 = await connect(code, p1.participantToken);
    const c2 = await connect(code, p2.participantToken);
    await c1.waitFor("state"); await c2.waitFor("state");
    await startGame(gm, set.id);
    await gm.waitFor("questionStarted");
    await c1.waitFor("questionStarted"); await c2.waitFor("questionStarted");
    const info = await jd.waitFor("judgeInfo", (m) => m.judge !== null);
    jd.received.length = 0;   // 開始時の judgeInfo(null) などを捨てる
    return { set, gm, jd, judgeToken, p1, p2, c1, c2, info };
  }

  it("pairs once: the QR code yields a judge token, a second use is 403", async () => {
    await initRoom("JDG01");
    const gm = await connect("JDG01", "gm-token");
    await gm.waitFor("state");
    const now = Date.now();
    const { pairCode, expiresAt } = await issueCode(gm, "JDG01");
    expect(expiresAt).toBeGreaterThanOrEqual(now + 5 * 60_000 - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000);
    const res = await postPair("JDG01", pairCode);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { judgeToken: string }).judgeToken).toMatch(/^[0-9a-f]{64}$/);
    const again = await postPair("JDG01", pairCode);
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({ error: "pair_invalid" });
    expect((await postPair("JDG01", "nope")).status).toBe(403);
    // 本文がオブジェクトでなければ 403（500 にしない）
    for (const body of ["null", "42", "\"x\"", "[]", "not json"]) {
      const bad = await stubFor("JDG01").fetch("http://room/judge-pair", { method: "POST", body });
      expect(bad.status).toBe(403);
      expect(await bad.json()).toEqual({ error: "pair_invalid" });
    }
    // ルームが無ければ 404
    expect((await postPair("JDGNONE", pairCode)).status).toBe(404);
  });

  it("an expired pairing code is 403", async () => {
    await initRoom("JDG02");
    const gm = await connect("JDG02", "gm-token");
    await gm.waitFor("state");
    const { pairCode } = await issueCode(gm, "JDG02");
    await runInDurableObject(stubFor("JDG02"), (_instance, state) => {
      state.storage.sql.exec("UPDATE kv SET value = ? WHERE key = 'judgePair'", JSON.stringify({ code: pairCode, expiresAt: Date.now() - 1 }));
    });
    expect((await postPair("JDG02", pairCode)).status).toBe(403);
  });

  it("issuing a new pairing code discards the previous one", async () => {
    await initRoom("JDG03");
    const gm = await connect("JDG03", "gm-token");
    await gm.waitFor("state");
    const first = await issueCode(gm, "JDG03");
    const second = await issueCode(gm, "JDG03");
    expect((await postPair("JDG03", first.pairCode)).status).toBe(403);
    expect((await postPair("JDG03", second.pairCode)).status).toBe(200);
  });

  it("the judge sees answers and judgeNote; GM and players never do", async () => {
    const { gm, jd, p1, c1, c2, info } = await setup("JDG04");
    expect(info.judge).toMatchObject({ questionNumber: 1, total: 2, prompt: PROMPT, answers: ["富士山"], judgeNote: NOTE });
    // 判定用端末の再接続でも state に載る。問題文・音声は参加者と同じく隠す
    const jd2 = await connect("JDG04", (await pair(gm, "JDG04")));
    const st = await jd2.waitFor("state");
    expect(st.judge).toMatchObject({ answers: ["富士山"], judgeNote: NOTE });
    expect(st.question?.prompt).toBe("");
    expect(st.me).toBeNull();
    // GM・参加者の再接続の state には載らない
    const gm2 = await connect("JDG04", "gm-token");
    expect((await gm2.waitFor("state")).judge).toBeNull();

    gm.send({ type: "startReading" });
    await c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c1.send({ type: "buzz" });
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "paused");
    jd2.send({ type: "judge", participantId: p1.participantId, correct: true });
    await gm.waitFor("questionClosed");
    await c1.waitFor("questionClosed"); await c2.waitFor("questionClosed");
    expect(jd.log.length).toBeGreaterThan(0);

    for (const client of [gm, gm2, c1, c2]) {
      for (const m of client.log) {
        if (m.type === "questionClosed") continue;
        const json = JSON.stringify(m);
        expect(json).not.toContain("富士山");
        expect(json).not.toContain(NOTE);
        expect(m.type).not.toBe("judgeInfo");
      }
    }
  });

  it("the judge can judge the answerer but nothing else", async () => {
    const { gm, jd, p1, c1 } = await setup("JDG05");
    gm.send({ type: "startReading" });
    await c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c1.send({ type: "buzz" });
    await jd.waitFor("buzzerUpdated", (m) => m.buzzer.status === "paused");
    jd.send({ type: "judge", participantId: p1.participantId, correct: false });
    expect(await c1.waitFor("answerResult")).toMatchObject({ correct: false, points: -20 });

    const attempts: unknown[] = [
      { type: "startReading" },
      { type: "next" },
      { type: "close" },
      { type: "pickGenre", genre: null },
      { type: "adjustScore", participantId: p1.participantId, delta: 10 },
      { type: "issueJudgePairing" },
      { type: "buzz" },
      { type: "answer", text: "富士山" },
    ];
    for (const a of attempts) {
      jd.send(a);
      expect((await jd.waitFor("error")).code).toBe("forbidden");
    }
  });

  it("pairing a new device revokes the old one", async () => {
    await initRoom("JDG06");
    const gm = await connect("JDG06", "gm-token");
    await gm.waitFor("state");
    const oldToken = await pair(gm, "JDG06");
    const old = await connect("JDG06", oldToken);
    await old.waitFor("state");
    // QR を出しただけでは切らない
    await issueCode(gm, "JDG06");
    const newToken = await pair(gm, "JDG06");
    expect(newToken).not.toBe(oldToken);
    await old.waitFor("judgeRevoked");
    const res = await stubFor("JDG06").fetch(`http://room/ws?token=${oldToken}`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
    const fresh = await connect("JDG06", newToken);
    expect((await fresh.waitFor("state")).role).toBe("judge");
    expect(old.log.filter((m) => m.type === "judgeRevoked")).toHaveLength(1);
  });

  it("GM gets judgeStatus paired only when a pairing code is used", async () => {
    await initRoom("JDG09");
    const gm = await connect("JDG09", "gm-token");
    await gm.waitFor("state");
    const token = await pair(gm, "JDG09");
    expect(await gm.waitFor("judgeStatus")).toMatchObject({ paired: true });
    const jd = await connect("JDG09", token);
    await jd.waitFor("state");
    expect(await gm.waitFor("judgeStatus", (m) => m.connected)).not.toHaveProperty("paired");
    // ペアリング済みの端末が再接続しても paired は付かない
    jd.ws.close(1000, "bye");
    await gm.waitFor("judgeStatus", (m) => !m.connected);
    const jd2 = await connect("JDG09", token);
    await jd2.waitFor("state");
    await gm.waitFor("judgeStatus", (m) => m.connected);
    expect(gm.log.filter((m) => m.type === "judgeStatus" && m.paired)).toHaveLength(1);
  });

  it("a judge connection whose token was replaced is ignored", async () => {
    const { gm, jd, p1, c1 } = await setup("JDG10");
    gm.send({ type: "startReading" });
    await c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c1.send({ type: "buzz" });
    await jd.waitFor("buzzerUpdated", (m) => m.buzzer.status === "paused");
    // 接続を閉じずにトークンだけ差し替え、古い接続が残った状況を作る
    await runInDurableObject(stubFor("JDG10"), (instance) => {
      (instance as unknown as { judgeToken: string }).judgeToken = "f".repeat(64);
    });
    jd.send({ type: "judge", participantId: p1.participantId, correct: false });
    expect((await jd.waitFor("error")).code).toBe("forbidden");
    // 古い接続の不正解判定は効いていないので、GM の正解判定が通る
    gm.send({ type: "judge", participantId: p1.participantId, correct: true });
    expect(await c1.waitFor("answerResult")).toMatchObject({ correct: true });
    await gm.waitFor("questionClosed");
    // 古い接続には judgeInfo も届かない
    gm.send({ type: "next" });
    await gm.waitFor("questionStarted");
    await c1.waitFor("questionStarted");
    expect(jd.received.filter((m) => m.type === "judgeInfo")).toHaveLength(0);
  });

  it("GM gets judgeStatus and judgeConnected in state", async () => {
    await initRoom("JDG07");
    const gm = await connect("JDG07", "gm-token");
    expect((await gm.waitFor("state")).judgeConnected).toBe(false);
    const token = await pair(gm, "JDG07");
    const jd = await connect("JDG07", token);
    await jd.waitFor("state");
    await gm.waitFor("judgeStatus", (m) => m.connected);
    expect((await (await connect("JDG07", "gm-token")).waitFor("state")).judgeConnected).toBe(true);
    // 参加者には意味が無いので false
    const c1 = await connect("JDG07", (await join("JDG07", "みさき")).participantToken);
    expect((await c1.waitFor("state")).judgeConnected).toBe(false);

    jd.ws.close(1000, "bye");
    await gm.waitFor("judgeStatus", (m) => !m.connected);
    expect((await (await connect("JDG07", "gm-token")).waitFor("state")).judgeConnected).toBe(false);
  });

  it("judgeInfo is null outside a buzzer question", async () => {
    const { gm, jd, judgeToken } = await setup("JDG08");
    gm.send({ type: "close" });
    await gm.waitFor("questionClosed");
    expect((await jd.waitFor("judgeInfo")).judge).toBeNull();
    const jd2 = await connect("JDG08", judgeToken);
    const st = await jd2.waitFor("state");
    expect(st.phase).toBe("questionResult");
    expect(st.judge).toBeNull();
    // 次の問題で中身が戻り、途中終了で null になる
    gm.send({ type: "next" });
    expect((await jd.waitFor("judgeInfo")).judge).toMatchObject({ questionNumber: 2, answers: ["北岳"] });
    gm.send({ type: "finish" });
    await gm.waitFor("finalResult");
    expect((await jd.waitFor("judgeInfo")).judge).toBeNull();
  });
});

describe("Room DO genre mode", () => {
  async function seedGenreSet() {
    const qs = ["歴史", "科学", "芸能"].flatMap((genre) => [1, 2].map((n) => ({ id: `${genre}${n}`, type: "anagram" as const, prompt: `${genre}の問題${n}`, answers: ["答え"], genre })));
    return createQuestionSet(testEnv.DB, {
      name: "ジャンル制", mode: "buzzer",
      settings: { ...DEFAULT_SETTINGS, timerMode: "none", charsPerSecond: 5, wrongPenalty: 20 },
      questions: qs,
    });
  }
  /** GM と参加者 2 人が入って開始する。specialties が true なら、第 1 問の前に p1=[g0,g1] / p2=[g1,g2] を選ばせる */
  async function setup(code: string, opts: { specialties?: boolean } = {}) {
    const set = await seedGenreSet();
    await initRoom(code);
    const gm = await connect(code, "gm-token");
    await gm.waitFor("state");
    const p1 = await join(code, "みさき");
    const p2 = await join(code, "たろう");
    const c1 = await connect(code, p1.participantToken);
    const c2 = await connect(code, p2.participantToken);
    await c1.waitFor("state"); await c2.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    await gm.waitFor("introStarted");
    const started = await gm.waitFor("genreUpdated");
    const genres = started.genres!.map((g) => g.genre);
    if (opts.specialties) {
      c1.send({ type: "chooseSpecialties", genres: [genres[0], genres[1]] });
      c2.send({ type: "chooseSpecialties", genres: [genres[1], genres[2]] });
      await gm.waitFor("specialtiesChosen", (m) => m.participant.id === p1.participantId);
      await gm.waitFor("specialtiesChosen", (m) => m.participant.id === p2.participantId);
    }
    gm.send({ type: "next" });
    const qsGm = await gm.waitFor("questionStarted");
    await c1.waitFor("questionStarted"); await c2.waitFor("questionStarted");
    return { gm, p1, p2, c1, c2, genres, started, question: qsGm.question };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;
  /** 第 1 問を p1 の正解で閉じ、next でジャンル選択（選ぶ人は p1）に入る */
  async function toGenreSelect(code: string) {
    const ctx = await setup(code, { specialties: true });
    await answerCorrect(ctx, ctx.p1.participantId, ctx.c1);
    ctx.gm.send({ type: "next" });
    const sel = await ctx.gm.waitFor("genreSelectStarted");
    return { ...ctx, sel };
  }
  async function answerCorrect(ctx: Ctx, pid: string, c: Client) {
    ctx.gm.send({ type: "startReading" });
    await c.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c.send({ type: "buzz" });
    await ctx.gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "paused");
    ctx.gm.send({ type: "judge", participantId: pid, correct: true });
    await ctx.gm.waitFor("questionClosed");
  }

  it("start broadcasts genreUpdated; question 1 carries genre, randomGenre and number 1", async () => {
    const { started, genres, question, c1 } = await setup("GEN01");
    expect(started.genres).toEqual(genres.map((genre) => ({ genre, remaining: 2 })));
    expect(genres).toHaveLength(3);
    expect(question).toMatchObject({ number: 1, randomGenre: true });
    expect(genres).toContain(question.genre);
    const after = await c1.waitFor("genreUpdated", (m) => m.genres!.some((g) => g.remaining === 1));
    expect(after.genres!.find((g) => g.genre === question.genre)?.remaining).toBe(1);
  });

  it("players choose specialties, everyone gets specialtiesChosen, and state includes them", async () => {
    const { gm, c1, c2, p1, genres, started } = await (async () => {
      const set = await seedGenreSet();
      await initRoom("GEN02");
      const gm = await connect("GEN02", "gm-token"); await gm.waitFor("state");
      const p1 = await join("GEN02", "みさき"); const p2 = await join("GEN02", "たろう");
      const c1 = await connect("GEN02", p1.participantToken); const c2 = await connect("GEN02", p2.participantToken);
      await c1.waitFor("state"); await c2.waitFor("state");
      gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
      const started = await gm.waitFor("genreUpdated");
      return { gm, c1, c2, p1, genres: started.genres!.map((g) => g.genre), started };
    })();
    expect(started.genres).toHaveLength(3);
    c1.send({ type: "chooseSpecialties", genres: [genres[0]] });
    expect((await c1.waitFor("error")).code).toBe("bad_specialties");
    gm.send({ type: "chooseSpecialties", genres: [genres[0], genres[1]] });
    expect((await gm.waitFor("error")).code).toBe("forbidden");
    c1.send({ type: "chooseSpecialties", genres: [genres[0], genres[1]] });
    for (const c of [gm, c1, c2]) {
      const m = await c.waitFor("specialtiesChosen");
      expect(m.participant).toMatchObject({ id: p1.participantId, specialties: [genres[0], genres[1]] });
    }
    c1.send({ type: "chooseSpecialties", genres: [genres[1], genres[2]] });
    expect((await c1.waitFor("error")).code).toBe("specialties_already_set");
    const st = await (await connect("GEN02", "gm-token")).waitFor("state");
    expect(st.participants.find((p) => p.id === p1.participantId)?.specialties).toEqual([genres[0], genres[1]]);
    expect(st.genres).toEqual(genres.map((genre) => ({ genre, remaining: 2 })));
    expect(st.genreSelect).toBeNull();
  });

  it("a player without specialties gets specialties_required on buzz", async () => {
    const { gm, c1 } = await setup("GEN03");
    gm.send({ type: "startReading" });
    await c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    c1.send({ type: "buzz" });
    expect((await c1.waitFor("error")).code).toBe("specialties_required");
  });

  it("correct answer → next → genreSelectStarted; the picker's pickGenre opens that genre for everyone", async () => {
    const { gm, c1, c2, p1, question, sel, genres } = await toGenreSelect("GEN04");
    expect(sel.select.picker).toEqual({ participantId: p1.participantId, nickname: "みさき" });
    expect(sel.select.genres.find((g) => g.genre === question.genre)?.remaining).toBe(1);
    expect((await c2.waitFor("genreSelectStarted")).select.picker.participantId).toBe(p1.participantId);
    const target = genres.find((g) => g !== question.genre)!;
    c1.send({ type: "pickGenre", genre: target });
    for (const c of [gm, c1, c2]) {
      const q = await c.waitFor("questionStarted");
      expect(q.question).toMatchObject({ genre: target, number: 2 });
      expect(q.question.randomGenre).toBeFalsy();
      const upd = await c.waitFor("genreUpdated", (m) => m.genres!.find((g) => g.genre === target)!.remaining === 1);
      expect(upd.genres!.find((g) => g.genre === target)?.remaining).toBe(1);
    }
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "ready");
  });

  it("rejects pickGenre from a non-picker (forbidden) and a second pick (invalid_state)", async () => {
    const { gm, c1, c2, genres } = await toGenreSelect("GEN05");
    c2.send({ type: "pickGenre", genre: genres[0] });
    expect((await c2.waitFor("error")).code).toBe("forbidden");
    c1.send({ type: "pickGenre", genre: null });
    expect((await c1.waitFor("error")).code).toBe("forbidden");
    c1.send({ type: "pickGenre", genre: "存在しない" });
    expect((await c1.waitFor("error")).code).toBe("genre_unavailable");
    c1.send({ type: "pickGenre", genre: genres[0] });
    await gm.waitFor("questionStarted");
    c1.send({ type: "pickGenre", genre: genres[1] });
    expect((await c1.waitFor("error")).code).toBe("invalid_state");
  });

  it("reconnecting during genreSelect restores picker and counts from state", async () => {
    const { p1, sel } = await toGenreSelect("GEN06");
    const c1b = await connect("GEN06", p1.participantToken);
    const st = await c1b.waitFor("state");
    expect(st.phase).toBe("genreSelect");
    expect(st.genreSelect).toEqual(sel.select);
    expect(st.genres).toEqual(sel.select.genres);
    expect(st.question).toBeNull();
  });

  it("the GM picks on behalf, and null picks at random", async () => {
    const a = await toGenreSelect("GEN07");
    const target = a.genres.find((g) => g !== a.question.genre)!;
    a.gm.send({ type: "pickGenre", genre: target });
    expect((await a.c2.waitFor("questionStarted")).question.genre).toBe(target);

    const b = await toGenreSelect("GEN08");
    b.gm.send({ type: "pickGenre", genre: null });
    const q = (await b.c2.waitFor("questionStarted")).question;
    expect(q.randomGenre).toBe(true);
    expect(b.genres).toContain(q.genre);
    expect(q.number).toBe(2);
  });

  it("kicking the picker opens a random question", async () => {
    const { gm, c2, p1, genres } = await toGenreSelect("GEN09");
    gm.send({ type: "kick", participantId: p1.participantId });
    const q = (await c2.waitFor("questionStarted")).question;
    expect(q.randomGenre).toBe(true);
    expect(genres).toContain(q.genre);
    await gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "ready");
  });

  it("a correct answer is doubled exactly when the question's genre is outside the answerer's specialties", async () => {
    const ctx = await setup("GEN10", { specialties: true });
    const inSpecialty = ctx.question.genre === ctx.genres[0] || ctx.question.genre === ctx.genres[1];   // p1 の得意
    ctx.gm.send({ type: "startReading" });
    await ctx.c1.waitFor("buzzerUpdated", (m) => m.buzzer.status === "reading");
    ctx.c1.send({ type: "buzz" });
    await ctx.gm.waitFor("buzzerUpdated", (m) => m.buzzer.status === "paused");
    ctx.gm.send({ type: "judge", participantId: ctx.p1.participantId, correct: true });
    const mine = await ctx.c1.waitFor("answerResult");
    const all = await ctx.gm.waitFor("someoneCorrect");
    for (const m of [mine, all]) {
      expect(m.points).toBe(inSpecialty ? 100 : 200);
      expect(m.multiplier).toBe(inSpecialty ? undefined : 2);
    }
  });

  it("finish from question goes to finalResult; players cannot finish", async () => {
    const { gm, c1, c2, p1 } = await setup("GEN11", { specialties: true });
    c1.send({ type: "finish" });
    expect((await c1.waitFor("error")).code).toBe("forbidden");
    gm.send({ type: "finish" });
    for (const c of [gm, c1, c2]) {
      const fin = await c.waitFor("finalResult");
      expect(fin.entries.map((e) => e.participantId)).toContain(p1.participantId);
    }
    expect((await (await connect("GEN11", "gm-token")).waitFor("state")).phase).toBe("finalResult");
    gm.send({ type: "finish" });
    expect((await gm.waitFor("error")).code).toBe("invalid_state");
  });

  it.each([false, true])("second game in the same room resets specialties on clients (carryOverScores %s) and accepts new picks", async (carry) => {
    const { gm, c1, c2, p1, genres } = await setup(`GEN13${carry ? "C" : "N"}`, { specialties: true });
    gm.send({ type: "finish" });
    for (const c of [gm, c1, c2]) await c.waitFor("finalResult");
    const set2 = await seedGenreSet();
    gm.send({ type: "start", questionSetId: set2.id, carryOverScores: carry });
    for (const c of [gm, c1, c2]) {
      const st = await c.waitFor("state");
      expect(st.phase).toBe("intro");
      expect(st.participants.every((p) => p.specialties === undefined)).toBe(true);
      expect(st.me?.specialties).toBeUndefined();
      expect(st.genres).toHaveLength(3);
    }
    c1.send({ type: "chooseSpecialties", genres: [genres[0], genres[2]] });
    expect((await gm.waitFor("specialtiesChosen", (m) => m.participant.id === p1.participantId)).participant.specialties).toEqual([genres[0], genres[2]]);
  });

  it("starting a non-genre set broadcasts genreUpdated with null", async () => {
    const set = await seedSet();
    await initRoom("GEN12");
    const gm = await connect("GEN12", "gm-token"); await gm.waitFor("state");
    gm.send({ type: "start", questionSetId: set.id, carryOverScores: false });
    expect((await gm.waitFor("genreUpdated")).genres).toBeNull();
    const st = await (await connect("GEN12", "gm-token")).waitFor("state");
    expect(st.genres).toBeNull();
    expect(st.genreSelect).toBeNull();
  });
});
