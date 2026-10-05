import type { ErrorCode, MyAnswerStatus, QuestionResultView, QuestionView, ServerMessage } from "../../shared/messages";
import type { LeaderboardEntry, Participant, Phase } from "../../shared/types";

export interface ClientState {
  connected: boolean;
  ready: boolean;
  role: "gm" | "player" | null;
  roomCode: string;
  phase: Phase;
  participants: Participant[];
  leaderboard: LeaderboardEntry[];
  question: QuestionView | null;
  questionResult: QuestionResultView | null;
  me: (Participant & { status: MyAnswerStatus | null }) | null;
  questionSetName: string | null;
  lastAnswerResult: Extract<ServerMessage, { type: "answerResult" }> | null;
  popups: { id: number; nickname: string; correctRank: number; points: number; at: number }[];
  finalEntries: LeaderboardEntry[] | null;
  lastError: { code: ErrorCode; message: string; at: number } | null;
  clockOffsetMs: number;
  correctCountThisQuestion: number;
}

export const initialClientState: ClientState = {
  connected: false, ready: false, role: null, roomCode: "", phase: "lobby",
  participants: [], leaderboard: [], question: null, questionResult: null, me: null,
  questionSetName: null, lastAnswerResult: null, popups: [], finalEntries: null, lastError: null, clockOffsetMs: 0,
  correctCountThisQuestion: 0,
};

let popupSeq = 0;

export function setConnected(s: ClientState, connected: boolean): ClientState {
  return { ...s, connected };
}

function upsertParticipant(list: Participant[], p: Participant): Participant[] {
  const i = list.findIndex((x) => x.id === p.id);
  if (i === -1) return [...list, p];
  const next = [...list];
  next[i] = p;
  return next;
}

export function applyServerMessage(s: ClientState, msg: ServerMessage, nowMs: number): ClientState {
  switch (msg.type) {
    case "state":
      return {
        ...s, ready: true, role: msg.role, roomCode: msg.roomCode, phase: msg.phase,
        participants: msg.participants, leaderboard: msg.leaderboard, question: msg.question,
        questionResult: msg.questionResult, me: msg.me, questionSetName: msg.questionSetName,
        finalEntries: msg.phase === "finalResult" ? msg.leaderboard : null,
        lastAnswerResult: null, clockOffsetMs: msg.serverTime - nowMs,
        correctCountThisQuestion: msg.correctCount,
      };
    case "participantJoined":
    case "participantLeft":
      return { ...s, participants: upsertParticipant(s.participants, msg.participant) };
    case "questionStarted":
      return {
        ...s, phase: "question", question: msg.question, questionResult: null, lastAnswerResult: null, finalEntries: null,
        correctCountThisQuestion: 0,
        me: s.me ? { ...s.me, status: { attemptsUsed: 0, correct: false, correctRank: null } } : null,
      };
    case "deadlineSet":
      return s.question ? { ...s, question: { ...s.question, deadlineAt: msg.deadlineAt } } : s;
    case "answerResult": {
      const prev = s.me?.status ?? { attemptsUsed: 0, correct: false, correctRank: null };
      const status: MyAnswerStatus = {
        attemptsUsed: prev.attemptsUsed + 1,
        correct: prev.correct || msg.correct,
        correctRank: msg.correct ? msg.correctRank : prev.correctRank,
      };
      return { ...s, lastAnswerResult: msg, me: s.me ? { ...s.me, status } : null };
    }
    case "someoneCorrect": {
      const popup = { id: ++popupSeq, nickname: msg.nickname, correctRank: msg.correctRank, points: msg.points, at: nowMs };
      return { ...s, popups: [...s.popups, popup].slice(-5), correctCountThisQuestion: s.correctCountThisQuestion + 1 };
    }
    case "leaderboard": {
      const mine = s.me ? msg.entries.find((e) => e.participantId === s.me!.id) : undefined;
      return { ...s, leaderboard: msg.entries, me: s.me && mine ? { ...s.me, score: mine.score } : s.me };
    }
    case "questionClosed":
      return { ...s, phase: "questionResult", questionResult: msg.result };
    case "finalResult":
      return { ...s, phase: "finalResult", finalEntries: msg.entries, leaderboard: msg.entries, question: null, questionResult: null };
    case "error":
      return { ...s, lastError: { code: msg.code, message: msg.message, at: nowMs } };
  }
}
