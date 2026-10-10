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
  prompt: string;              // 画像に問題の文字が描かれている場合は空にできる
  answers: string[];
  hint?: string;
  imageUrl?: string;           // /api/images/<key>（R2 に保存した問題画像）
  overrides?: Partial<QuestionSettings>;
}

export interface QuestionSet {
  id: string;
  name: string;                // 企画名
  coverImageUrl?: string;      // タイトルスライドの画像
  slideBackground?: string;    // 問題スライドの背景色（#rrggbb）。画像の地の色に合わせる用途
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
  coverImageUrl?: string;
  questionCount: number;
  updatedAt: number;
}
