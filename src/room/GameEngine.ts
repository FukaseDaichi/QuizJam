import type { Answer, LeaderboardEntry, Participant, Phase, QuestionSet, QuestionSettings } from "../shared/types";
import { resolveSettings } from "../shared/defaults";
import { isCorrect } from "../shared/normalize";
import type { ErrorCode, MyAnswerStatus, QuestionResultView, QuestionView } from "../shared/messages";

export interface EngineState {
  roomCode: string;
  phase: Phase;
  questionSet: QuestionSet | null;
  currentIndex: number;
  carryOverScores: boolean;
  questionStartedAt: number | null;
  deadlineAt: number | null;
  participants: Record<string, Participant>;
  answers: Answer[];
}

export type AnswerOutcome =
  | { kind: "correct"; correctRank: number; points: number; deadlineAt: number | null; deadlineJustSet: boolean }
  | { kind: "wrong"; remainingAttempts: number | null; points: number }
  | { kind: "rejected"; code: ErrorCode };

export class GameEngine {
  private constructor(private s: EngineState) {}

  static create(roomCode: string): GameEngine {
    return new GameEngine({
      roomCode,
      phase: "lobby",
      questionSet: null,
      currentIndex: 0,
      carryOverScores: false,
      questionStartedAt: null,
      deadlineAt: null,
      participants: {},
      answers: [],
    });
  }

  static fromSnapshot(state: EngineState): GameEngine {
    return new GameEngine(structuredClone(state));
  }

  snapshot(): EngineState {
    return structuredClone(this.s);
  }

  get phase(): Phase { return this.s.phase; }
  get deadlineAt(): number | null { return this.s.deadlineAt; }
  get roomCode(): string { return this.s.roomCode; }
  get questionSet(): QuestionSet | null { return this.s.questionSet; }
  get currentIndex(): number { return this.s.currentIndex; }

  // ---- participants ----
  addParticipant(id: string, nickname: string): Participant {
    const existing = this.s.participants[id];
    const p: Participant = existing
      ? { ...existing, nickname, connected: true }
      : { id, nickname, score: 0, connected: true };
    this.s.participants[id] = p;
    return { ...p };
  }

  setConnected(id: string, connected: boolean): Participant | null {
    const p = this.s.participants[id];
    if (!p) return null;
    p.connected = connected;
    return { ...p };
  }

  getParticipant(id: string): Participant | null {
    const p = this.s.participants[id];
    return p ? { ...p } : null;
  }

  participants(): Participant[] {
    return Object.values(this.s.participants).map((p) => ({ ...p }));
  }

  // ---- game flow ----
  start(set: QuestionSet, carryOverScores: boolean, now: number): QuestionView {
    if (set.questions.length === 0) throw new Error("question set is empty");
    this.s.questionSet = structuredClone(set);
    this.s.carryOverScores = carryOverScores;
    this.s.answers = [];
    if (!carryOverScores) {
      for (const p of Object.values(this.s.participants)) p.score = 0;
    }
    this.openQuestion(0, now);
    return this.currentQuestionView()!;
  }

  protected openQuestion(index: number, now: number): void {
    const settings = this.settings(index);
    this.s.currentIndex = index;
    this.s.phase = "question";
    this.s.questionStartedAt = now;
    this.s.deadlineAt = settings.timerMode === "fixed" ? now + settings.timerSeconds * 1000 : null;
  }

  settings(index = this.s.currentIndex): QuestionSettings {
    if (!this.s.questionSet) throw new Error("no question set");
    return resolveSettings(this.s.questionSet, index);
  }

  currentQuestionView(): QuestionView | null {
    const set = this.s.questionSet;
    if (!set || (this.s.phase !== "question" && this.s.phase !== "questionResult")) return null;
    const q = set.questions[this.s.currentIndex];
    return {
      index: this.s.currentIndex,
      total: set.questions.length,
      prompt: q.prompt,
      hint: q.hint,
      imageUrl: q.imageUrl,
      deadlineAt: this.s.deadlineAt,
      maxAttempts: this.settings().maxAttempts,
    };
  }

  private answersFor(index: number): Answer[] {
    return this.s.answers.filter((a) => a.questionIndex === index);
  }

  myStatus(participantId: string): MyAnswerStatus | null {
    if (!this.s.questionSet || this.s.phase === "lobby" || this.s.phase === "finalResult") return null;
    const mine = this.answersFor(this.s.currentIndex).filter((a) => a.participantId === participantId);
    const correct = mine.find((a) => a.correct);
    return { attemptsUsed: mine.length, correct: !!correct, correctRank: correct?.correctRank ?? null };
  }

  submitAnswer(participantId: string, text: string, now: number): AnswerOutcome {
    if (this.s.phase !== "question" || !this.s.questionSet) return { kind: "rejected", code: "not_in_question" };
    const p = this.s.participants[participantId];
    if (!p) return { kind: "rejected", code: "forbidden" };
    if (this.s.deadlineAt !== null && now >= this.s.deadlineAt) return { kind: "rejected", code: "deadline_passed" };

    const idx = this.s.currentIndex;
    const settings = this.settings(idx);
    const current = this.answersFor(idx);
    const mine = current.filter((a) => a.participantId === participantId);
    if (mine.some((a) => a.correct)) return { kind: "rejected", code: "already_correct" };
    if (settings.maxAttempts !== null && mine.length >= settings.maxAttempts) {
      return { kind: "rejected", code: "no_attempts_left" };
    }

    const q = this.s.questionSet.questions[idx];
    const correct = isCorrect(text, q.answers);
    if (correct) {
      const correctRank = current.filter((a) => a.correct).length + 1;
      const points = settings.basePoints + (settings.rankBonus[correctRank - 1] ?? 0);
      p.score += points;
      this.s.answers.push({ questionIndex: idx, participantId, text, correct: true, submittedAt: now, correctRank });
      let deadlineJustSet = false;
      if (settings.timerMode === "afterFirstCorrect" && this.s.deadlineAt === null) {
        this.s.deadlineAt = now + settings.timerSeconds * 1000;
        deadlineJustSet = true;
      }
      return { kind: "correct", correctRank, points, deadlineAt: this.s.deadlineAt, deadlineJustSet };
    }

    const points = settings.wrongPenalty === 0 ? 0 : -settings.wrongPenalty;
    p.score += points;
    this.s.answers.push({ questionIndex: idx, participantId, text, correct: false, submittedAt: now, correctRank: null });
    const remainingAttempts = settings.maxAttempts === null ? null : settings.maxAttempts - (mine.length + 1);
    return { kind: "wrong", remainingAttempts, points };
  }

  closeQuestion(now: number): QuestionResultView {
    if (this.s.phase !== "question") throw new Error("not in question phase");
    this.s.phase = "questionResult";
    if (this.s.deadlineAt === null || this.s.deadlineAt > now) this.s.deadlineAt = now;
    return this.questionResult()!;
  }

  questionResult(): QuestionResultView | null {
    if (this.s.phase !== "questionResult" || !this.s.questionSet) return null;
    const idx = this.s.currentIndex;
    const settings = this.settings(idx);
    const q = this.s.questionSet.questions[idx];
    const results = this.answersFor(idx)
      .filter((a) => a.correct)
      .sort((a, b) => a.correctRank! - b.correctRank!)
      .map((a) => ({
        participantId: a.participantId,
        nickname: this.s.participants[a.participantId]?.nickname ?? "?",
        correctRank: a.correctRank!,
        points: settings.basePoints + (settings.rankBonus[a.correctRank! - 1] ?? 0),
      }));
    return { answers: [...q.answers], results };
  }

  next(now: number): { kind: "question"; question: QuestionView } | { kind: "final"; entries: LeaderboardEntry[] } {
    if (this.s.phase !== "questionResult" || !this.s.questionSet) throw new Error("not in questionResult phase");
    const nextIndex = this.s.currentIndex + 1;
    if (nextIndex >= this.s.questionSet.questions.length) {
      this.s.phase = "finalResult";
      this.s.deadlineAt = null;
      this.s.questionStartedAt = null;
      return { kind: "final", entries: this.leaderboard() };
    }
    this.openQuestion(nextIndex, now);
    return { kind: "question", question: this.currentQuestionView()! };
  }

  endGame(): void {
    this.s.phase = "lobby";
    this.s.deadlineAt = null;
    this.s.questionStartedAt = null;
    this.s.currentIndex = 0;
  }

  correctCount(): number {
    if (this.s.phase !== "question" && this.s.phase !== "questionResult") return 0;
    return this.answersFor(this.s.currentIndex).filter((a) => a.correct).length;
  }

  allParticipantsDone(): boolean {
    if (this.s.phase !== "question") return false;
    const settings = this.settings();
    const active = Object.values(this.s.participants).filter((p) => p.connected);
    if (active.length === 0) return false;
    return active.every((p) => {
      const st = this.myStatus(p.id)!;
      if (st.correct) return true;
      return settings.maxAttempts !== null && st.attemptsUsed >= settings.maxAttempts;
    });
  }

  leaderboard(): LeaderboardEntry[] {
    // Array.prototype.sort は安定ソートなので、同点は入室順（挿入順）を保つ
    const sorted = Object.values(this.s.participants).sort((a, b) => b.score - a.score);
    const out: LeaderboardEntry[] = [];
    let rank = 0;
    let prevScore: number | null = null;
    sorted.forEach((p, i) => {
      if (p.score !== prevScore) { rank = i + 1; prevScore = p.score; }
      out.push({ participantId: p.id, nickname: p.nickname, score: p.score, rank });
    });
    return out;
  }
}
