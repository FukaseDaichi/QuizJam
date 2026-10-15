import type { BuzzerStatus, LeaderboardEntry, LiveSettings, Participant, Phase, QuestionSetMode, QuestionSettings, TimerMode } from "./types";
import { isValidCharsPerSecond } from "./validateQuestionSet";

// ---- client -> server ----
export type ClientMessage =
  | { type: "answer"; text: string }
  | { type: "start"; questionSetId: string; carryOverScores: boolean }
  | { type: "close" }
  | { type: "next" }
  | { type: "endGame" }
  // GM がゲーム中にも使える操作
  | { type: "updateSettings"; settings: Partial<LiveSettings> }
  | { type: "adjustScore"; participantId: string; delta: number }
  | { type: "kick"; participantId: string }
  // 早押しモード
  | { type: "startReading" }                  // GM: 読み上げ（文字送り）開始
  | { type: "buzz" }                          // 参加者: 早押し
  | { type: "judge"; participantId: string; correct: boolean };   // GM: 回答中の参加者を判定。participantId が回答中の人と違えば拒否

const CLIENT_TYPES = new Set(["answer", "start", "close", "next", "endGame", "updateSettings", "adjustScore", "kick", "startReading", "buzz", "judge"]);

const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isNonNegativeInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

const TIMER_MODES = new Set<TimerMode>(["fixed", "afterFirstCorrect", "none"]);

/** updateSettings の settings を検証し、許可されたキーだけを残して返す。不正なら null */
function parseLiveSettings(v: unknown): Partial<LiveSettings> | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: Partial<LiveSettings> = {};
  for (const key of Object.keys(o)) {
    const val = o[key];
    if (key === "timerMode") { if (!TIMER_MODES.has(val as TimerMode)) return null; out.timerMode = val as TimerMode; }
    else if (key === "timerSeconds") { if (!isPositiveInt(val)) return null; out.timerSeconds = val; }
    else if (key === "maxAttempts") { if (val !== null && !isPositiveInt(val)) return null; out.maxAttempts = val as number | null; }
    else if (key === "basePoints") { if (!isNonNegativeInt(val)) return null; out.basePoints = val; }
    else if (key === "wrongPenalty") { if (!isNonNegativeInt(val)) return null; out.wrongPenalty = val; }
    else if (key === "rankBonus") { if (!Array.isArray(val) || val.length > 20 || !val.every(isNonNegativeInt)) return null; out.rankBonus = val; }
    else if (key === "charsPerSecond") { if (!isValidCharsPerSecond(val)) return null; out.charsPerSecond = val; }
    else return null;
  }
  return out;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const t = (obj as { type?: unknown }).type;
  if (typeof t !== "string" || !CLIENT_TYPES.has(t)) return null;
  if (t === "answer" && typeof (obj as { text?: unknown }).text !== "string") return null;
  if (t === "start") {
    const o = obj as { questionSetId?: unknown; carryOverScores?: unknown };
    if (typeof o.questionSetId !== "string" || typeof o.carryOverScores !== "boolean") return null;
  }
  if (t === "updateSettings") {
    const settings = parseLiveSettings((obj as { settings?: unknown }).settings);
    if (!settings) return null;
    return { type: "updateSettings", settings };
  }
  if (t === "adjustScore") {
    const o = obj as { participantId?: unknown; delta?: unknown };
    if (typeof o.participantId !== "string" || !Number.isInteger(o.delta)) return null;
  }
  if (t === "kick" && typeof (obj as { participantId?: unknown }).participantId !== "string") return null;
  if (t === "judge") {
    const o = obj as { participantId?: unknown; correct?: unknown };
    if (typeof o.participantId !== "string" || typeof o.correct !== "boolean") return null;
  }
  return obj as ClientMessage;
}

// ---- server -> client ----
/** ゲーム冒頭に GM 画面へ映すスライド。index 0 がタイトル、以降が問題セットの introSlides */
export type IntroSlideView =
  | { kind: "title"; name: string; coverImageUrl?: string; questionCount: number; settings: QuestionSettings; mode: QuestionSetMode }
  | { kind: "slide"; heading?: string; body?: string; imageUrl?: string };

export interface IntroView {
  index: number;
  total: number;          // 1 + introSlides.length
  slide: IntroSlideView;
}

export interface QuestionView {
  index: number;
  total: number;
  mode: QuestionSetMode;          // 画面の出し分け。buzzer では参加者の prompt / hint は空
  prompt: string;
  hint?: string;
  imageUrl?: string;
  background?: string;
  deadlineAt: number | null;
  maxAttempts: number | null;
}

export interface MyAnswerStatus {
  attemptsUsed: number;
  correct: boolean;
  correctRank: number | null;
}

export interface QuestionResultView {
  answers: string[];
  explanationImageUrl?: string;   // 問題に解説画像があれば。結果表示中にだけ届く
  results: { participantId: string; nickname: string; correctRank: number; points: number }[];
}

/** 早押しモードの出題中の状態。表示済み文字数は revealedCount()（shared/buzzer.ts）で求める */
export interface BuzzerView {
  status: BuzzerStatus;
  readingStartedAt: number | null;
  revealedChars: number;
  positionMs: number;                                    // 区間の起点での音声の再生位置 (ms)。音声付きの問題でだけ使う
  promptLength: number;                                  // 参加者は本文を受け取らないので長さだけ
  charsPerSecond: number;                                // 今効いている速さ
  queue: { participantId: string; nickname: string }[];  // 先頭が回答中
  lockedOut: string[];
}

/** GM が上書きした設定と、問題セット読み込み後に実際に効く設定 */
export interface SettingsView {
  override: Partial<LiveSettings>;
  effective: LiveSettings | null;
  mode: QuestionSetMode | null;   // 読み込み中の問題セットの出題形式。管理パネルの欄の出し分けに使う
}

export interface StateMessage {
  type: "state";
  role: "gm" | "player";
  serverTime: number;
  roomCode: string;
  phase: Phase;
  participants: Participant[];
  leaderboard: LeaderboardEntry[];
  intro: IntroView | null;               // intro フェーズのみ
  question: QuestionView | null;
  questionResult: QuestionResultView | null;
  me: (Participant & { status: MyAnswerStatus | null }) | null;
  questionSetName: string | null;
  correctCount: number; // 現在の問題の正解者数（出題中・結果表示中以外は 0）
  settings: SettingsView;
  buzzer: BuzzerView | null;       // 早押しモードで出題中のみ
}

export type ErrorCode =
  | "not_in_question"
  | "deadline_passed"
  | "already_correct"
  | "no_attempts_left"
  | "forbidden"
  | "invalid_state"
  | "question_set_not_found"
  | "participant_not_found"
  | "bad_message"
  | "not_reading"
  | "locked_out"
  | "already_buzzed";

const SERVER_TYPES = new Set<ServerMessage["type"]>([
  "state", "participantJoined", "participantLeft", "participantRemoved", "kicked", "settingsUpdated",
  "introStarted", "questionStarted", "deadlineSet", "answerResult", "someoneCorrect", "leaderboard",
  "questionClosed", "finalResult", "buzzerUpdated", "error",
]);

/**
 * このビルドのクライアントが知っている type か。
 * デプロイ後も開きっぱなしのブラウザは新しいサーバーから未知の type を受け取りうる。
 * その場合はクライアントが古いので、無視するか再読み込みする
 */
export function isKnownServerMessage(x: unknown): x is ServerMessage {
  return typeof x === "object" && x !== null && SERVER_TYPES.has((x as { type?: unknown }).type as ServerMessage["type"]);
}

export type ServerMessage =
  | StateMessage
  | { type: "participantJoined"; participant: Participant }
  | { type: "participantLeft"; participant: Participant }
  | { type: "participantRemoved"; participant: Participant }
  | { type: "kicked" }
  | { type: "settingsUpdated"; settings: SettingsView }
  | { type: "introStarted"; intro: IntroView }
  | { type: "questionStarted"; question: QuestionView }
  | { type: "deadlineSet"; deadlineAt: number | null }
  | { type: "answerResult"; correct: boolean; correctRank: number | null; remainingAttempts: number | null; points: number }
  | { type: "someoneCorrect"; participantId: string; nickname: string; correctRank: number; points: number }
  | { type: "leaderboard"; entries: LeaderboardEntry[] }
  | { type: "questionClosed"; result: QuestionResultView }
  | { type: "finalResult"; entries: LeaderboardEntry[] }
  | { type: "buzzerUpdated"; buzzer: BuzzerView }
  | { type: "error"; code: ErrorCode; message: string };
