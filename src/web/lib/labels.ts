import type { TimerMode } from "../../shared/types";

export const TIMER_MODE_LABELS: Record<TimerMode, string> = {
  fixed: "固定カウントダウン",
  afterFirstCorrect: "正解者が出てからカウントダウン",
  none: "なし（GMが締切）",
};
