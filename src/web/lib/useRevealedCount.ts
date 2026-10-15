import { useEffect, useState } from "react";
import type { BuzzerView } from "../../shared/messages";
import { revealedCount } from "../../shared/buzzer";

/**
 * 今表示すべき文字数。サーバーの時刻に補正した「今」で共有の式を評価する。
 * revealAtMs（問読み音声のタイミング表）があれば文字/秒の代わりに使う。
 * 読み上げ中は毎フレーム再計算し（音声と 1 フレーム以内で揃える）、全文表示に達したら止める。
 * buzzerUpdated で区間の起点が置き換わると、押された位置でぴたりと揃う
 */
export function useRevealedCount(buzzer: BuzzerView | null, revealAtMs: number[] | undefined, clockOffsetMs: number): number {
  const compute = () => (buzzer ? revealedCount({ ...buzzer, revealAtMs }, Date.now() + clockOffsetMs) : 0);
  const [count, setCount] = useState(compute);
  useEffect(() => {
    setCount(compute());
    if (!buzzer || buzzer.status !== "reading") return;
    let id = 0;
    const tick = () => {
      const n = compute();
      setCount(n);
      if (n < buzzer.promptLength) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzzer, revealAtMs, clockOffsetMs]);
  return count;
}
