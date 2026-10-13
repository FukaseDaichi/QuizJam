import { useEffect, useState } from "react";
import type { BuzzerView } from "../../shared/messages";
import { revealedCount } from "../../shared/buzzer";

/**
 * 今表示すべき文字数。サーバーの時刻に補正した「今」で共有の式を評価する。
 * 読み上げ中は 100ms ごとに再計算し、全文表示に達したら止める。
 * buzzerUpdated で区間の起点が置き換わると、押された位置でぴたりと揃う
 */
export function useRevealedCount(buzzer: BuzzerView | null, clockOffsetMs: number): number {
  const compute = () => (buzzer ? revealedCount(buzzer, Date.now() + clockOffsetMs) : 0);
  const [count, setCount] = useState(compute);
  useEffect(() => {
    setCount(compute());
    if (!buzzer || buzzer.status !== "reading") return;
    const id = setInterval(() => {
      const n = compute();
      setCount(n);
      if (n >= buzzer.promptLength) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buzzer, clockOffsetMs]);
  return count;
}
