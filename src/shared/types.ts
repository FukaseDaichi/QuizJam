export type TimerMode = "fixed" | "afterFirstCorrect" | "none";

export interface QuestionSettings {
  timerMode: TimerMode;
  timerSeconds: number;
  basePoints: number;
  rankBonus: number[];
  wrongPenalty: number;
  maxAttempts: number | null;
}

export interface Question {
  id: string;
  type: "anagram";
  prompt: string;
  answers: string[];
  hint?: string;
  overrides?: Partial<QuestionSettings>;
}

export interface QuestionSet {
  id: string;
  name: string;
  settings: QuestionSettings;
  questions: Question[];
}

export type Phase = "lobby" | "question" | "questionResult" | "finalResult";

export interface Participant {
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
}

export interface Answer {
  questionIndex: number;
  participantId: string;
  text: string;
  correct: boolean;
  submittedAt: number;
  correctRank: number | null;
}

export interface LeaderboardEntry {
  participantId: string;
  nickname: string;
  score: number;
  rank: number;
}

export interface QuestionSetSummary {
  id: string;
  name: string;
  questionCount: number;
  updatedAt: number;
}
