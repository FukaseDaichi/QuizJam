import type { Answer, BuzzerState, LeaderboardEntry, LiveSettings, Participant, Phase, QuestionSet, QuestionSetMode, QuestionSettings } from "../shared/types";
import { resolveSettings } from "../shared/defaults";
import { isCorrect } from "../shared/normalize";
import { promptLength, revealedCount, type RevealTimeline } from "../shared/buzzer";
import type { BuzzerView, ErrorCode, IntroSlideView, IntroView, MyAnswerStatus, QuestionResultView, QuestionView } from "../shared/messages";

export interface EngineState {
  roomCode: string;
  phase: Phase;
  questionSet: QuestionSet | null;
  currentIndex: number;
  /** intro フェーズで映しているスライド。0 がタイトル、1..n が introSlides[n-1] */
  introIndex: number;
  carryOverScores: boolean;
  questionStartedAt: number | null;
  deadlineAt: number | null;
  participants: Record<string, Participant>;
  answers: Answer[];
  /** GM による設定の上書き。ゲームをまたいで保持する */
  settingsOverride: Partial<LiveSettings>;
  /** 早押しモードで出題中にだけ持つ。それ以外は null */
  buzzer: BuzzerState | null;
}

export type AnswerOutcome =
  | { kind: "correct"; correctRank: number; points: number; deadlineAt: number | null; deadlineJustSet: boolean }
  | { kind: "wrong"; remainingAttempts: number | null; points: number }
  | { kind: "rejected"; code: ErrorCode };

export type NextOutcome =
  | { kind: "intro"; intro: IntroView }
  | { kind: "question"; question: QuestionView }
  | { kind: "final"; entries: LeaderboardEntry[] };

export type BuzzOutcome =
  | { kind: "accepted"; position: number }          // キュー内の順番（1 が回答中）
  | { kind: "rejected"; code: ErrorCode };

export type JudgeOutcome =
  | { kind: "correct"; participantId: string; points: number; result: QuestionResultView }
  | { kind: "wrong"; participantId: string; points: number }
  | { kind: "rejected"; code: ErrorCode };   // 判定対象が回答中の人と違う（二度押しなど）

export class GameEngine {
  private constructor(private s: EngineState) {}

  static create(roomCode: string): GameEngine {
    return new GameEngine({
      roomCode,
      phase: "lobby",
      questionSet: null,
      currentIndex: 0,
      introIndex: 0,
      carryOverScores: false,
      questionStartedAt: null,
      deadlineAt: null,
      participants: {},
      answers: [],
      settingsOverride: {},
      buzzer: null,
    });
  }

  static fromSnapshot(state: EngineState): GameEngine {
    // 旧スナップショットには settingsOverride / introIndex / buzzer が無い
    return new GameEngine({
      ...structuredClone(state),
      settingsOverride: structuredClone(state.settingsOverride ?? {}),
      introIndex: state.introIndex ?? 0,
      buzzer: structuredClone(state.buzzer ?? null),
    });
  }

  snapshot(): EngineState {
    return structuredClone(this.s);
  }

  get phase(): Phase { return this.s.phase; }
  get deadlineAt(): number | null { return this.s.deadlineAt; }
  get roomCode(): string { return this.s.roomCode; }
  get questionSet(): QuestionSet | null { return this.s.questionSet; }
  get currentIndex(): number { return this.s.currentIndex; }
  get introIndex(): number { return this.s.introIndex; }
  get mode(): QuestionSetMode { return this.s.questionSet?.mode ?? "anagram"; }
  private get isBuzzer(): boolean { return this.mode === "buzzer"; }

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

  // ---- GM live controls ----
  adjustScore(id: string, delta: number): Participant | null {
    const p = this.s.participants[id];
    if (!p) return null;
    p.score += delta;
    return { ...p };
  }

  removeParticipant(id: string, now: number): Participant | null {
    const p = this.s.participants[id];
    if (!p) return null;
    delete this.s.participants[id];
    this.s.answers = this.s.answers.filter((a) => a.participantId !== id);
    const b = this.s.buzzer;
    if (b) {
      const wasAnswering = b.status === "paused" && b.queue[0] === id;
      b.queue = b.queue.filter((x) => x !== id);
      b.lockedOut = b.lockedOut.filter((x) => x !== id);
      // 回答中の人が消えたら不正解と同じように次へ回す（減点はしない）
      if (wasAnswering) this.resumeIfQueueEmpty(now);
    }
    return { ...p };
  }

  settingsOverride(): Partial<LiveSettings> {
    return { ...this.s.settingsOverride };
  }

  /** ライブ設定を丸ごと置き換える。送られなかったキーは上書きが解除される */
  setSettingsOverride(override: Partial<LiveSettings>): Partial<LiveSettings> {
    this.s.settingsOverride = { ...override };
    return this.settingsOverride();
  }

  /**
   * 出題中にライブ設定が変わったとき、現在の問題の締切を新しいタイマーモードに合わせ直す。
   * - none: 締切を消す
   * - fixed: 締切が無ければ「今＋秒数」で開始。すでに動いている締切は動かさない
   * - afterFirstCorrect: 締切が無く、すでに正解者がいれば「今＋秒数」で開始。正解者がいなければ最初の正解を待つ
   */
  reconcileDeadline(now: number): { changed: boolean; deadlineAt: number | null } {
    const before = this.s.deadlineAt;
    if (this.s.phase !== "question" || !this.s.questionSet || this.isBuzzer) return { changed: false, deadlineAt: before };
    const settings = this.settings();
    let after: number | null;
    if (settings.timerMode === "none") after = null;
    else if (settings.timerMode === "fixed") after = before ?? now + settings.timerSeconds * 1000;
    else after = before ?? (this.correctCount() > 0 ? now + settings.timerSeconds * 1000 : null);
    this.s.deadlineAt = after;
    return { changed: after !== before, deadlineAt: after };
  }

  // ---- game flow ----
  /** 問題セットを読み込み、タイトルスライド（intro フェーズ）から始める。第1問は next() で開く */
  start(set: QuestionSet, carryOverScores: boolean): IntroView {
    if (set.questions.length === 0) throw new Error("question set is empty");
    this.s.questionSet = structuredClone(set);
    this.s.carryOverScores = carryOverScores;
    this.s.answers = [];
    if (!carryOverScores) {
      for (const p of Object.values(this.s.participants)) p.score = 0;
    }
    this.s.phase = "intro";
    this.s.introIndex = 0;
    this.s.currentIndex = 0;
    this.s.questionStartedAt = null;
    this.s.deadlineAt = null;
    return this.introView()!;
  }

  introView(): IntroView | null {
    const set = this.s.questionSet;
    if (!set || this.s.phase !== "intro") return null;
    const slides = set.introSlides ?? [];
    const i = this.s.introIndex;
    const slide: IntroSlideView = i === 0
      ? { kind: "title", name: set.name, coverImageUrl: set.coverImageUrl, questionCount: set.questions.length, settings: this.settings(0), mode: this.mode }
      : { kind: "slide", heading: slides[i - 1].heading, body: slides[i - 1].body, imageUrl: slides[i - 1].imageUrl };
    return { index: i, total: 1 + slides.length, slide };
  }

  protected openQuestion(index: number, now: number): void {
    const settings = this.settings(index);
    this.s.currentIndex = index;
    this.s.phase = "question";
    this.s.questionStartedAt = now;
    if (this.isBuzzer) {
      // 早押しは締切を持たず、GM の「読み上げ開始」を待つ
      this.s.deadlineAt = null;
      this.s.buzzer = { status: "ready", readingStartedAt: null, revealedChars: 0, queue: [], lockedOut: [] };
    } else {
      this.s.deadlineAt = settings.timerMode === "fixed" ? now + settings.timerSeconds * 1000 : null;
      this.s.buzzer = null;
    }
  }

  settings(index = this.s.currentIndex): QuestionSettings {
    if (!this.s.questionSet) throw new Error("no question set");
    return { ...resolveSettings(this.s.questionSet, index), ...this.s.settingsOverride };
  }

  /** 早押しモードでは参加者に問題文とヒントを渡さない（スマホはボタン専用機） */
  currentQuestionView(role: "gm" | "player" = "gm"): QuestionView | null {
    const set = this.s.questionSet;
    if (!set || (this.s.phase !== "question" && this.s.phase !== "questionResult")) return null;
    const q = set.questions[this.s.currentIndex];
    const hidden = this.isBuzzer && role === "player";
    return {
      index: this.s.currentIndex,
      total: set.questions.length,
      mode: this.mode,
      prompt: hidden ? "" : q.prompt,
      hint: hidden ? undefined : q.hint,
      imageUrl: q.imageUrl,
      background: set.slideBackground,
      deadlineAt: this.s.deadlineAt,
      maxAttempts: this.settings().maxAttempts,
    };
  }

  private answersFor(index: number): Answer[] {
    return this.s.answers.filter((a) => a.questionIndex === index);
  }

  myStatus(participantId: string): MyAnswerStatus | null {
    if (!this.s.questionSet || this.s.phase === "lobby" || this.s.phase === "intro" || this.s.phase === "finalResult") return null;
    const mine = this.answersFor(this.s.currentIndex).filter((a) => a.participantId === participantId);
    const correct = mine.find((a) => a.correct);
    return { attemptsUsed: mine.length, correct: !!correct, correctRank: correct?.correctRank ?? null };
  }

  submitAnswer(participantId: string, text: string, now: number): AnswerOutcome {
    if (this.s.phase !== "question" || !this.s.questionSet) return { kind: "rejected", code: "not_in_question" };
    if (this.isBuzzer) return { kind: "rejected", code: "not_in_question" };
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
      this.s.answers.push({ questionIndex: idx, participantId, text, correct: true, submittedAt: now, correctRank, points });
      let deadlineJustSet = false;
      if (settings.timerMode === "afterFirstCorrect" && this.s.deadlineAt === null) {
        this.s.deadlineAt = now + settings.timerSeconds * 1000;
        deadlineJustSet = true;
      }
      return { kind: "correct", correctRank, points, deadlineAt: this.s.deadlineAt, deadlineJustSet };
    }

    const points = settings.wrongPenalty === 0 ? 0 : -settings.wrongPenalty;
    p.score += points;
    this.s.answers.push({ questionIndex: idx, participantId, text, correct: false, submittedAt: now, correctRank: null, points });
    const remainingAttempts = settings.maxAttempts === null ? null : settings.maxAttempts - (mine.length + 1);
    return { kind: "wrong", remainingAttempts, points };
  }

  closeQuestion(now: number): QuestionResultView {
    if (this.s.phase !== "question") throw new Error("not in question phase");
    this.s.phase = "questionResult";
    this.s.buzzer = null;
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
        points: a.points ?? settings.basePoints + (settings.rankBonus[a.correctRank! - 1] ?? 0),
      }));
    return { answers: [...q.answers], explanationImageUrl: q.explanationImageUrl, results };
  }

  next(now: number): NextOutcome {
    if (!this.s.questionSet) throw new Error("no question set");
    if (this.s.phase === "intro") {
      const slideCount = (this.s.questionSet.introSlides ?? []).length;
      if (this.s.introIndex < slideCount) {
        this.s.introIndex += 1;
        return { kind: "intro", intro: this.introView()! };
      }
      this.openQuestion(0, now);
      return { kind: "question", question: this.currentQuestionView()! };
    }
    if (this.s.phase !== "questionResult") throw new Error("not in intro or questionResult phase");
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
    this.s.buzzer = null;
    this.s.introIndex = 0;
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
    const active = Object.values(this.s.participants).filter((p) => p.connected);
    if (active.length === 0) return false;
    const b = this.s.buzzer;
    if (b) return b.queue.length === 0 && active.every((p) => b.lockedOut.includes(p.id));
    const settings = this.settings();
    return active.every((p) => {
      const st = this.myStatus(p.id)!;
      if (st.correct) return true;
      return settings.maxAttempts !== null && st.attemptsUsed >= settings.maxAttempts;
    });
  }

  // ---- buzzer mode ----
  private timeline(b: BuzzerState): RevealTimeline {
    const q = this.s.questionSet!.questions[this.s.currentIndex];
    return { status: b.status, readingStartedAt: b.readingStartedAt, revealedChars: b.revealedChars, promptLength: promptLength(q.prompt), charsPerSecond: this.settings().charsPerSecond };
  }

  buzzerView(): BuzzerView | null {
    const b = this.s.buzzer;
    if (!b || this.s.phase !== "question" || !this.s.questionSet) return null;
    const t = this.timeline(b);
    return {
      status: t.status, readingStartedAt: t.readingStartedAt, revealedChars: t.revealedChars, promptLength: t.promptLength, charsPerSecond: t.charsPerSecond,
      queue: b.queue.map((id) => ({ participantId: id, nickname: this.s.participants[id]?.nickname ?? "?" })),
      lockedOut: [...b.lockedOut],
    };
  }

  /** GM の「読み上げ開始」。ready のときだけ */
  startReading(now: number): BuzzerView {
    const b = this.s.buzzer;
    if (!b || this.s.phase !== "question" || b.status !== "ready") throw new Error("not ready to read");
    b.status = "reading";
    b.readingStartedAt = now;
    return this.buzzerView()!;
  }

  /** 読み上げ中なら区間の起点を今に取り直す。charsPerSecond を変える直前に呼び、表示済みの位置が飛ばないようにする */
  rebaseReading(now: number): void {
    const b = this.s.buzzer;
    if (!b || this.s.phase !== "question" || b.status !== "reading") return;
    b.revealedChars = revealedCount(this.timeline(b), now);
    b.readingStartedAt = now;
  }

  /** 参加者の早押し。受信順にキューへ。最初の1人で読み上げが止まる */
  buzz(participantId: string, now: number): BuzzOutcome {
    const b = this.s.buzzer;
    if (!b || this.s.phase !== "question") return { kind: "rejected", code: "not_in_question" };
    if (!this.s.participants[participantId]) return { kind: "rejected", code: "forbidden" };
    if (b.status === "ready") return { kind: "rejected", code: "not_reading" };
    if (b.lockedOut.includes(participantId)) return { kind: "rejected", code: "locked_out" };
    if (b.queue.includes(participantId)) return { kind: "rejected", code: "already_buzzed" };
    if (b.status === "reading") {
      b.revealedChars = revealedCount(this.timeline(b), now);
      b.readingStartedAt = null;
      b.status = "paused";
    }
    b.queue.push(participantId);
    return { kind: "accepted", position: b.queue.length };
  }

  /**
   * GM の判定。回答中（paused かつキューの先頭）の参加者に対して行う。
   * participantId が回答中の人と違えば拒否する（ボタンの二度押しで次の人まで判定されないため）
   */
  judge(participantId: string, correct: boolean, now: number): JudgeOutcome {
    const b = this.s.buzzer;
    if (!b || this.s.phase !== "question" || b.status !== "paused" || b.queue.length === 0) throw new Error("nobody is answering");
    if (b.queue[0] !== participantId) return { kind: "rejected", code: "invalid_state" };
    const p = this.s.participants[participantId];
    const idx = this.s.currentIndex;
    const settings = this.settings(idx);
    if (correct) {
      const points = settings.basePoints;
      if (p) p.score += points;
      this.s.answers.push({ questionIndex: idx, participantId, text: "", correct: true, submittedAt: now, correctRank: 1, points });
      const result = this.closeQuestion(now);
      return { kind: "correct", participantId, points, result };
    }
    const points = settings.wrongPenalty === 0 ? 0 : -settings.wrongPenalty;
    if (p) p.score += points;
    this.s.answers.push({ questionIndex: idx, participantId, text: "", correct: false, submittedAt: now, correctRank: null, points });
    b.queue.shift();
    b.lockedOut.push(participantId);
    this.resumeIfQueueEmpty(now);
    return { kind: "wrong", participantId, points };
  }

  /** 回答者が居なくなったら続きから読み上げを再開する。残っていれば次の人が回答中のまま */
  private resumeIfQueueEmpty(now: number): void {
    const b = this.s.buzzer;
    if (!b || b.status !== "paused" || b.queue.length > 0) return;
    b.status = "reading";
    b.readingStartedAt = now;
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
