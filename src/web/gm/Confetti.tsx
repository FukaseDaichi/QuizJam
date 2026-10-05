import { useMemo } from "react";

const COLORS = ["#2563eb", "#7c3aed", "#ec4899", "#fb923c", "#22c55e"];

export function Confetti({ seed }: { seed: number }) {
  const pieces = useMemo(() => Array.from({ length: 40 }, (_, i) => ({
    left: `${(i * 37 + seed * 11) % 100}%`, delay: `${(i % 10) * 60}ms`, color: COLORS[i % COLORS.length],
  })), [seed]);
  return <>{pieces.map((p, i) => <span key={i} className="qj-confetti" style={{ left: p.left, animationDelay: p.delay, background: p.color }} aria-hidden />)}</>;
}
