import type { BuzzerStatus } from "./types";

/** 表示済み文字数を求めるのに必要な情報。サーバーの BuzzerState とクライアントの BuzzerView の両方が満たす */
export interface RevealTimeline {
  status: BuzzerStatus;
  readingStartedAt: number | null;
  revealedChars: number;
  positionMs: number;
  promptLength: number;
  charsPerSecond: number;
  /** 音声付きの問題だけ。各文字を出す再生位置 (ms)。あれば charsPerSecond の代わりに使う */
  revealAtMs?: number[];
}

/** 文字数はコードポイント単位。サロゲートペア（絵文字など）を途中で切らない */
export function promptLength(prompt: string): number {
  return Array.from(prompt).length;
}

/** 時刻 now の音声の再生位置 (ms)。reading: 区間の起点 + 経過。ready / paused: 区間の起点のまま */
export function playbackPositionMs(t: RevealTimeline, now: number): number {
  if (t.status !== "reading" || t.readingStartedAt === null) return t.positionMs;
  return t.positionMs + Math.max(0, now - t.readingStartedAt);
}

/**
 * 時刻 now に表示済みであるべき文字数。
 * reading: 音声付きなら再生位置までに表示時刻が来た文字の数、それ以外は区間の起点 + 経過秒 × 文字/秒（切り捨て）。
 * ready / paused: 区間の起点のまま。
 * サーバーとクライアントが同じ式を使うので、押された瞬間の位置が全員で揃う
 */
export function revealedCount(t: RevealTimeline, now: number): number {
  const base = Math.min(t.revealedChars, t.promptLength);
  if (t.status !== "reading" || t.readingStartedAt === null) return base;
  if (t.revealAtMs) {
    const pos = playbackPositionMs(t, now);
    let n = 0;
    while (n < t.revealAtMs.length && t.revealAtMs[n] <= pos) n++;
    // 再開で再生位置を文字の頭まで戻しても、出ていた文字は消さない
    return Math.min(t.promptLength, Math.max(base, n));
  }
  const elapsed = Math.max(0, now - t.readingStartedAt);
  return Math.min(t.promptLength, base + Math.floor((elapsed * t.charsPerSecond) / 1000));
}
