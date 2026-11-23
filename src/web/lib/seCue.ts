import type { BuzzerView } from "../../shared/messages";

export type SeName = "buzz" | "correct" | "incorrect";

/**
 * 早押しの状態の変化から、鳴らす効果音を決める。鳴らさないなら null。
 * 待ち行列が伸びた = 誰かが押した、お手付きの人が増えた = 不正解。
 * 正解は問題が閉じて状態が消えるので、ここでは扱わない（someoneCorrect で鳴らす）。
 * prev が null（問題の開始直後・再接続）のときは鳴らさない
 */
export function buzzerSe(prev: BuzzerView | null, next: BuzzerView | null): SeName | null {
  if (!prev || !next) return null;
  if (next.lockedOut.length > prev.lockedOut.length) return "incorrect";
  if (next.queue.length > prev.queue.length) return "buzz";
  return null;
}
