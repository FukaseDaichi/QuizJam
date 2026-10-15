import type { BuzzerView } from "../../shared/messages";
import { playbackPositionMs } from "../../shared/buzzer";

/**
 * 問読み音声をどこから流すか (ms)。流さないなら null。
 * 読み上げ中なら、サーバーの時刻 now の再生位置から流す。位置が音声の長さ durationMs に達していれば流さない。
 * 全文が出ていても止めない（最後の文字は読み始めに出るので、その音はまだ残っている）。
 * outputLatencyMs（音がスピーカーから出るまでの遅れ）の分だけ先から流し、会場で聞こえる位置を文字に揃える。
 * 止める・再開・再接続はすべてこの値の変化だけで決まる
 */
export function audioStartMs(buzzer: BuzzerView | null, now: number, outputLatencyMs = 0, durationMs = Infinity): number | null {
  if (!buzzer || buzzer.status !== "reading" || buzzer.readingStartedAt === null) return null;
  const startMs = playbackPositionMs(buzzer, now) + outputLatencyMs;
  return startMs < durationMs ? startMs : null;
}
