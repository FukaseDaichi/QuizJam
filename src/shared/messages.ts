import type { LeaderboardEntry, Participant, Phase } from "./types";

// ---- client -> server ----
export type ClientMessage =
  | { type: "answer"; text: string }
  | { type: "start"; questionSetId: string; carryOverScores: boolean }
  | { type: "close" }
  | { type: "next" }
  | { type: "endGame" };

const CLIENT_TYPES = new Set(["answer", "start", "close", "next", "endGame"]);

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
  return obj as ClientMessage;
}

// ---- server -> client ----
export interface QuestionView {
  index: number;
  total: number;
  prompt: string;
  hint?: string;
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
  results: { participantId: string; nickname: string; correctRank: number; points: number }[];
}

export interface StateMessage {
  type: "state";
  role: "gm" | "player";
  serverTime: number;
  roomCode: string;
  phase: Phase;
  participants: Participant[];
  leaderboard: LeaderboardEntry[];
  question: QuestionView | null;
  questionResult: QuestionResultView | null;
  me: (Participant & { status: MyAnswerStatus | null }) | null;
  questionSetName: string | null;
  correctCount: number; // 現在の問題の正解者数（出題中・結果表示中以外は 0）
}

export type ErrorCode =
  | "not_in_question"
  | "deadline_passed"
  | "already_correct"
  | "no_attempts_left"
  | "forbidden"
  | "invalid_state"
  | "question_set_not_found"
  | "bad_message";

export type ServerMessage =
  | StateMessage
  | { type: "participantJoined"; participant: Participant }
  | { type: "participantLeft"; participant: Participant }
  | { type: "questionStarted"; question: QuestionView }
  | { type: "deadlineSet"; deadlineAt: number }
  | { type: "answerResult"; correct: boolean; correctRank: number | null; remainingAttempts: number | null; points: number }
  | { type: "someoneCorrect"; participantId: string; nickname: string; correctRank: number; points: number }
  | { type: "leaderboard"; entries: LeaderboardEntry[] }
  | { type: "questionClosed"; result: QuestionResultView }
  | { type: "finalResult"; entries: LeaderboardEntry[] }
  | { type: "error"; code: ErrorCode; message: string };
