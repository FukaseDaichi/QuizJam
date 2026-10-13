import type { QuestionSetMode, TimerMode } from "../../shared/types";

export const TIMER_MODE_LABELS: Record<TimerMode, string> = {
  fixed: "固定カウントダウン",
  afterFirstCorrect: "正解者が出てからカウントダウン",
  none: "なし（GMが締切）",
};

export const MODE_LABELS: Record<QuestionSetMode, string> = {
  anagram: "アナグラム（文字で回答）",
  buzzer: "早押し（口頭で回答）",
};
