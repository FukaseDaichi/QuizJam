import { DurableObject } from "cloudflare:workers";
import type { Env } from "../worker/env";
import { GameEngine, type EngineState } from "./GameEngine";
import { parseClientMessage, type ClientMessage, type ServerMessage, type StateMessage, type ErrorCode } from "../shared/messages";
import { getQuestionSet } from "../worker/questionSets";

type Attachment = { role: "gm" } | { role: "player"; participantId: string };

const CLEANUP_AFTER_MS = 24 * 60 * 60 * 1000;

export class Room extends DurableObject<Env> {
  private engine: GameEngine | null = null;
  private gmToken: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS tokens (token TEXT PRIMARY KEY, participant_id TEXT NOT NULL)`);
      const snap = this.kvGet("snapshot");
      if (snap) this.engine = GameEngine.fromSnapshot(JSON.parse(snap) as EngineState);
      this.gmToken = this.kvGet("gmToken");
    });
  }

  // ---- storage helpers ----
  private kvGet(key: string): string | null {
    const rows = this.ctx.storage.sql.exec("SELECT value FROM kv WHERE key = ?", key).toArray() as { value: string }[];
    return rows[0]?.value ?? null;
  }
  private kvSet(key: string, value: string): void {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", key, value);
  }
  private save(): void {
    if (this.engine) this.kvSet("snapshot", JSON.stringify(this.engine.snapshot()));
  }

  // ---- HTTP (internal, called by the Worker) ----
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/init") return this.handleInit(request);
    if (url.pathname === "/exists") {
      return this.engine ? Response.json({ roomCode: this.engine.roomCode }) : Response.json({ error: "not_found" }, { status: 404 });
    }
    if (request.method === "POST" && url.pathname === "/join") return this.handleJoin(request);
    if (url.pathname === "/ws") return this.handleWebSocket(request, url);
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  private async handleInit(request: Request): Promise<Response> {
    if (this.engine) return Response.json({ error: "already_initialized" }, { status: 409 });
    const { roomCode, gmToken } = (await request.json()) as { roomCode: string; gmToken: string };
    this.engine = GameEngine.create(roomCode);
    this.gmToken = gmToken;
    this.kvSet("gmToken", gmToken);
    this.save();
    await this.scheduleCleanup();
    return Response.json({ roomCode });
  }

  private async handleJoin(request: Request): Promise<Response> {
    if (!this.engine) return Response.json({ error: "not_found" }, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { nickname?: unknown };
    const base = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 20) : "";
    if (!base) return Response.json({ error: "nickname_required" }, { status: 400 });
    // 同名が居たら「名前 (2)」「名前 (3)」… と番号を付けて区別する（仕様 §4.4）
    const taken = new Set(this.engine.participants().map((p) => p.nickname));
    let nickname = base;
    for (let n = 2; taken.has(nickname); n++) nickname = `${base} (${n})`;
    const participantId = crypto.randomUUID();
    const participantToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    this.ctx.storage.sql.exec("INSERT INTO tokens (token, participant_id) VALUES (?, ?)", participantToken, participantId);
    const participant = this.engine.addParticipant(participantId, nickname);
    this.save();
    this.broadcast({ type: "participantJoined", participant });
    this.broadcast({ type: "leaderboard", entries: this.engine.leaderboard() });
    return Response.json({ participantId, participantToken, roomCode: this.engine.roomCode });
  }

  private handleWebSocket(request: Request, url: URL): Response {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    if (!this.engine) return Response.json({ error: "not_found" }, { status: 404 });
    const token = url.searchParams.get("token") ?? "";
    const attachment = this.resolveToken(token);
    if (!attachment) return Response.json({ error: "unauthorized" }, { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const tags = attachment.role === "gm" ? ["role:gm"] : ["role:player", `pid:${attachment.participantId}`];
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment(attachment);

    if (attachment.role === "player") {
      const p = this.engine.setConnected(attachment.participantId, true);
      this.save();
      if (p) this.broadcast({ type: "participantJoined", participant: p }, server);
    }
    server.send(JSON.stringify(this.stateFor(attachment)));
    return new Response(null, { status: 101, webSocket: client });
  }

  private resolveToken(token: string): Attachment | null {
    if (!token) return null;
    if (this.gmToken && token === this.gmToken) return { role: "gm" };
    const rows = this.ctx.storage.sql.exec("SELECT participant_id FROM tokens WHERE token = ?", token).toArray() as { participant_id: string }[];
    return rows[0] ? { role: "player", participantId: rows[0].participant_id } : null;
  }

  // ---- WebSocket handlers (hibernation API) ----
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.engine) return;
    const attachment = ws.deserializeAttachment() as Attachment;
    const msg = typeof raw === "string" ? parseClientMessage(raw) : null;
    if (!msg) return this.sendError(ws, "bad_message", "メッセージを解釈できません");
    try {
      await this.dispatch(ws, attachment, msg);
    } catch (e) {
      console.error("dispatch failed", e);
      this.sendError(ws, "invalid_state", "操作を実行できません");
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (attachment?.role === "player" && this.engine) {
      const stillConnected = this.ctx.getWebSockets(`pid:${attachment.participantId}`).filter((w) => w !== ws).length > 0;
      if (!stillConnected) {
        const p = this.engine.setConnected(attachment.participantId, false);
        this.save();
        if (p) this.broadcast({ type: "participantLeft", participant: p });
      }
    }
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011, "error");
  }

  private async dispatch(ws: WebSocket, attachment: Attachment, msg: ClientMessage): Promise<void> {
    const engine = this.engine!;
    const now = Date.now();

    if (msg.type === "answer") {
      if (attachment.role !== "player") return this.sendError(ws, "forbidden", "GMは回答できません");
      const outcome = engine.submitAnswer(attachment.participantId, msg.text, now);
      if (outcome.kind === "rejected") return this.sendError(ws, outcome.code, this.errorText(outcome.code));
      this.save();
      if (outcome.kind === "correct") {
        const p = engine.getParticipant(attachment.participantId)!;
        this.send(ws, { type: "answerResult", correct: true, correctRank: outcome.correctRank, remainingAttempts: null, points: outcome.points });
        this.broadcast({ type: "someoneCorrect", participantId: p.id, nickname: p.nickname, correctRank: outcome.correctRank, points: outcome.points });
        if (outcome.deadlineJustSet && outcome.deadlineAt !== null) {
          this.broadcast({ type: "deadlineSet", deadlineAt: outcome.deadlineAt });
          await this.ctx.storage.setAlarm(outcome.deadlineAt);
          this.kvSet("alarmKind", "deadline");
        }
      } else {
        this.send(ws, { type: "answerResult", correct: false, correctRank: null, remainingAttempts: outcome.remainingAttempts, points: outcome.points });
      }
      this.broadcast({ type: "leaderboard", entries: engine.leaderboard() });
      if (engine.allParticipantsDone()) await this.closeQuestion(now);
      return;
    }

    if (attachment.role !== "gm") return this.sendError(ws, "forbidden", "GMのみ操作できます");

    switch (msg.type) {
      case "start": {
        if (engine.phase !== "lobby" && engine.phase !== "finalResult") return this.sendError(ws, "invalid_state", "開始できる状態ではありません");
        const set = await getQuestionSet(this.env.DB, msg.questionSetId);
        if (!set || set.questions.length === 0) return this.sendError(ws, "question_set_not_found", "問題セットが見つかりません");
        const question = engine.start(set, msg.carryOverScores, now);
        this.save();
        this.broadcast({ type: "questionStarted", question });
        this.broadcast({ type: "leaderboard", entries: engine.leaderboard() });
        await this.armDeadline(question.deadlineAt);
        return;
      }
      case "close": {
        if (engine.phase !== "question") return this.sendError(ws, "invalid_state", "出題中ではありません");
        await this.closeQuestion(now);
        return;
      }
      case "next": {
        if (engine.phase !== "questionResult") return this.sendError(ws, "invalid_state", "次へ進める状態ではありません");
        const r = engine.next(now);
        this.save();
        if (r.kind === "question") {
          this.broadcast({ type: "questionStarted", question: r.question });
          await this.armDeadline(r.question.deadlineAt);
        } else {
          this.broadcast({ type: "finalResult", entries: r.entries });
          await this.scheduleCleanup();
        }
        return;
      }
      case "endGame": {
        engine.endGame();
        this.save();
        this.broadcastState();
        await this.scheduleCleanup();
        return;
      }
    }
  }

  private async closeQuestion(now: number): Promise<void> {
    const engine = this.engine!;
    const result = engine.closeQuestion(now);
    this.save();
    this.broadcast({ type: "questionClosed", result });
    this.broadcast({ type: "leaderboard", entries: engine.leaderboard() });
    await this.scheduleCleanup();
  }

  private async armDeadline(deadlineAt: number | null): Promise<void> {
    if (deadlineAt === null) { await this.scheduleCleanup(); return; }
    await this.ctx.storage.setAlarm(deadlineAt);
    this.kvSet("alarmKind", "deadline");
  }

  private async scheduleCleanup(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + CLEANUP_AFTER_MS);
    this.kvSet("alarmKind", "cleanup");
  }

  async alarm(): Promise<void> {
    const kind = this.kvGet("alarmKind");
    const engine = this.engine;
    if (kind === "deadline" && engine && engine.phase === "question" && engine.deadlineAt !== null) {
      await this.closeQuestion(Math.max(Date.now(), engine.deadlineAt));
      return;
    }
    if (kind === "cleanup") {
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(1001, "room expired"); } catch { /* ignore */ } }
      await this.ctx.storage.deleteAll();
      this.engine = null;
      this.gmToken = null;
    }
  }

  // ---- messaging ----
  private stateFor(attachment: Attachment): StateMessage {
    const engine = this.engine!;
    const me = attachment.role === "player" ? engine.getParticipant(attachment.participantId) : null;
    return {
      type: "state",
      role: attachment.role,
      serverTime: Date.now(),
      roomCode: engine.roomCode,
      phase: engine.phase,
      participants: engine.participants(),
      leaderboard: engine.leaderboard(),
      question: engine.currentQuestionView(),
      questionResult: engine.questionResult(),
      me: me ? { ...me, status: engine.myStatus(me.id) } : null,
      questionSetName: engine.questionSet?.name ?? null,
      correctCount: engine.correctCount(),
    };
  }

  private broadcastState(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      this.send(ws, this.stateFor(att));
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try { ws.send(JSON.stringify(msg)); } catch (e) { console.warn("send failed", e); }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(data); } catch (e) { console.warn("broadcast failed", e); }
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode, message: string): void {
    this.send(ws, { type: "error", code, message });
  }

  private errorText(code: ErrorCode): string {
    switch (code) {
      case "not_in_question": return "いまは回答できません";
      case "deadline_passed": return "時間切れです";
      case "already_correct": return "すでに正解しています";
      case "no_attempts_left": return "回答回数の上限に達しました";
      case "forbidden": return "権限がありません";
      case "question_set_not_found": return "問題セットが見つかりません";
      case "invalid_state": return "操作を実行できません";
      case "bad_message": return "メッセージを解釈できません";
    }
  }
}
