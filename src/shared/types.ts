export type TimerMode = "fixed" | "afterFirstCorrect" | "none";

export interface QuestionSettings {
  timerMode: TimerMode;
  timerSeconds: number;
  basePoints: number;
  rankBonus: number[];
  wrongPenalty: number;
  maxAttempts: number | null;
  charsPerSecond: number;      // 早押しモードの文字送り（文字/秒）。既定 6。それ以外のモードでは使わない
}

/** 問題セット全体の出題形式。早押しなら全問が早押し */
export type QuestionSetMode = "anagram" | "buzzer";

/** GM がゲーム中に上書きできる設定。問題セットや問題ごとの設定より優先する */
/** GM がゲーム中に上書きできる設定。全問共通の設定と同じ項目 */
export type LiveSettings = QuestionSettings;

export interface Question {
  id: string;
  type: "anagram";
  prompt: string;              // 画像に問題の文字が描かれている場合は空にできる
  answers: string[];
  hint?: string;
  imageUrl?: string;           // /api/images/<key>（R2 に保存した問題画像）
  explanationImageUrl?: string; // 問題結果画面に映す解説画像。出題中は参加者に送らない
  overrides?: Partial<QuestionSettings>;
  audio?: QuestionAudio;       // 早押しの問読み音声。早押しモードでだけ使う
}

/** 問読み音声と、問題文の各文字を出す時刻（quiz-tts の align・publish が作る） */
export interface QuestionAudio {
  url: string;                 // /api/audio/<key>（R2 に保存した mp3）か https
  revealAtMs: number[];        // 問題文の各文字（コードポイント）を出す時刻。音声の頭からの ms。前の要素以上
}

/** ゲーム冒頭、タイトルの後に映す説明スライド。見出し・本文・画像のどれか1つは必須 */
export interface IntroSlide {
  id: string;
  heading?: string;            // 100文字まで
  body?: string;               // 複数行可。1000文字まで
  imageUrl?: string;           // /api/images/<key> か https://
}

export interface QuestionSet {
  id: string;
  name: string;                // 企画名
  mode?: QuestionSetMode;      // 省略時 "anagram"
  coverImageUrl?: string;      // タイトルスライドの画像
  slideBackground?: string;    // 問題スライドの背景色（#rrggbb）。画像の地の色に合わせる用途
  introSlides?: IntroSlide[];  // 省略時は無し。20枚まで
  settings: QuestionSettings;
  questions: Question[];
}

export type Phase = "lobby" | "intro" | "question" | "questionResult" | "finalResult";

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
  /** この回答で実際に加減した点数。設定をゲーム中に変えても結果表示が変わらないよう保持する（旧データには無い） */
  points?: number;
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

export type BuzzerStatus = "ready" | "reading" | "paused";

/** 早押しモードで出題中にだけ持つ状態。表示済み文字数は revealedCount()（shared/buzzer.ts）で求める */
export interface BuzzerState {
  status: BuzzerStatus;
  readingStartedAt: number | null;  // reading のとき、今の区間を読み始めたサーバー時刻 (UNIX ms)
  revealedChars: number;            // 区間の起点。止めたときまでに表示済みの文字数
  positionMs: number;               // 区間の起点での音声の再生位置 (ms)。音声付きの問題でだけ使う
  queue: string[];                 // 早押しキュー（参加者 ID、サーバー受信順）。先頭が回答中
  lockedOut: string[];              // この問題で不正解になり、押せなくなった参加者 ID
}
