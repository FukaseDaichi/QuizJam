import type { ErrorCode, IntroView, MyAnswerStatus, QuestionResultView, QuestionView, ServerMessage, SettingsView } from "../../shared/messages";
import type { LeaderboardEntry, Participant, Phase } from "../../shared/types";

export interface ClientState {
  connected: boolean;
  ready: boolean;
  role: "gm" | "player" | null;
  roomCode: string;
  phase: Phase;
  participants: Participant[];
  leaderboard: LeaderboardEntry[];
  intro: IntroView | null;
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
  settings: SettingsView;
  kicked: boolean; // GM に退出させられた（参加者のみ）
}

export const initialClientState: ClientState = {
  connected: false, ready: false, role: null, roomCode: "", phase: "lobby",
  participants: [], leaderboard: [], intro: null, question: null, questionResult: null, me: null,
  questionSetName: null, lastAnswerResult: null, popups: [], finalEntries: null, lastError: null, clockOffsetMs: 0,
  correctCountThisQuestion: 0,
  settings: { override: {}, effective: null },
  kicked: false,
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
        participants: msg.participants, leaderboard: msg.leaderboard, intro: msg.intro, question: msg.question,
        questionResult: msg.questionResult, me: msg.me, questionSetName: msg.questionSetName,
        finalEntries: msg.phase === "finalResult" ? msg.leaderboard : null,
        lastAnswerResult: null, clockOffsetMs: msg.serverTime - nowMs,
        correctCountThisQuestion: msg.correctCount,
        settings: msg.settings,
      };
    case "participantJoined":
    case "participantLeft":
      return { ...s, participants: upsertParticipant(s.participants, msg.participant) };
    case "participantRemoved":
      return { ...s, participants: s.participants.filter((p) => p.id !== msg.participant.id) };
    case "kicked":
      return { ...s, kicked: true };
    case "settingsUpdated": {
      // お手付き上限は今の問題にも効くので、残り回答回数の表示元も更新する
      const eff = msg.settings.effective;
      const question = s.question && eff ? { ...s.question, maxAttempts: eff.maxAttempts } : s.question;
      return { ...s, settings: msg.settings, question };
    }
    case "introStarted":
      return {
        ...s, phase: "intro", intro: msg.intro, question: null, questionResult: null, lastAnswerResult: null, finalEntries: null,
        correctCountThisQuestion: 0,
        // タイトルスライドが企画名を運ぶ。再接続せずに開始を見た接続でも名前が分かる
        questionSetName: msg.intro.slide.kind === "title" ? msg.intro.slide.name : s.questionSetName,
      };
    case "questionStarted":
      return {
        ...s, phase: "question", intro: null, question: msg.question, questionResult: null, lastAnswerResult: null, finalEntries: null,
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
      const scores = new Map(msg.entries.map((e) => [e.participantId, e.score]));
      const mine = s.me ? scores.get(s.me.id) : undefined;
      return {
        ...s, leaderboard: msg.entries,
        participants: s.participants.map((p) => (scores.has(p.id) ? { ...p, score: scores.get(p.id)! } : p)),
        me: s.me && mine !== undefined ? { ...s.me, score: mine } : s.me,
      };
    }
    case "questionClosed":
      return { ...s, phase: "questionResult", questionResult: msg.result };
    case "finalResult":
      return { ...s, phase: "finalResult", finalEntries: msg.entries, leaderboard: msg.entries, question: null, questionResult: null };
    case "error":
      return { ...s, lastError: { code: msg.code, message: msg.message, at: nowMs } };
  }
}
