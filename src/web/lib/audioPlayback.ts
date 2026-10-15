import type { BuzzerView } from "../../shared/messages";
import { playbackPositionMs } from "../../shared/buzzer";

/**
 * 問読み音声をどこから流すか (ms)。流さないなら null。
 * 読み上げ中で、区間の起点で全文が出ていなければ、サーバーの時刻 now の再生位置から流す。
 * 止める・再開・再接続はすべてこの値の変化だけで決まる
 */
export function audioStartMs(buzzer: BuzzerView | null, now: number): number | null {
  if (!buzzer || buzzer.status !== "reading" || buzzer.readingStartedAt === null) return null;
  if (buzzer.revealedChars >= buzzer.promptLength) return null;
  return playbackPositionMs(buzzer, now);
}
