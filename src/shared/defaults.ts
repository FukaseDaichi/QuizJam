import type { QuestionSet, QuestionSettings } from "./types";

export const DEFAULT_SETTINGS: QuestionSettings = {
  timerMode: "fixed",
  timerSeconds: 30,
  basePoints: 100,
  rankBonus: [50, 30, 10],
  wrongPenalty: 0,
  maxAttempts: 3,
};

export function resolveSettings(set: QuestionSet, index: number): QuestionSettings {
  const q = set.questions[index];
  return { ...DEFAULT_SETTINGS, ...set.settings, ...(q?.overrides ?? {}) };
}
