import type { BuzzerStatus } from "./types";

/** 表示済み文字数を求めるのに必要な情報。サーバーの BuzzerState とクライアントの BuzzerView の両方が満たす */
export interface RevealTimeline {
  status: BuzzerStatus;
  readingStartedAt: number | null;
  revealedChars: number;
  promptLength: number;
  charsPerSecond: number;
}

/** 文字数はコードポイント単位。サロゲートペア（絵文字など）を途中で切らない */
export function promptLength(prompt: string): number {
  return Array.from(prompt).length;
}

/**
 * 時刻 now に表示済みであるべき文字数。
 * reading: 区間の起点 + 経過秒 × 文字/秒（切り捨て）。ready / paused: 区間の起点のまま。
 * サーバーとクライアントが同じ式を使うので、押された瞬間の位置が全員で揃う
 */
export function revealedCount(t: RevealTimeline, now: number): number {
  const base = Math.min(t.revealedChars, t.promptLength);
  if (t.status !== "reading" || t.readingStartedAt === null) return base;
  const elapsed = Math.max(0, now - t.readingStartedAt);
  return Math.min(t.promptLength, base + Math.floor((elapsed * t.charsPerSecond) / 1000));
}
