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
