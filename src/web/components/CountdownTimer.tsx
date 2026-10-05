import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { remainingSeconds } from "../lib/time";

export function CountdownTimer({ deadlineAt, clockOffsetMs, size = "md" }: { deadlineAt: number | null; clockOffsetMs: number; size?: "md" | "lg" }) {
  const [sec, setSec] = useState(() => remainingSeconds(deadlineAt, clockOffsetMs));
  useEffect(() => {
    setSec(remainingSeconds(deadlineAt, clockOffsetMs));
    if (deadlineAt === null) return;
    const id = setInterval(() => setSec(remainingSeconds(deadlineAt, clockOffsetMs)), 200);
    return () => clearInterval(id);
  }, [deadlineAt, clockOffsetMs]);

  const text = sec === null ? "--" : `${sec}`;
  const urgent = sec !== null && sec <= 5;
  return (
    <div className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 font-black tabular-nums ${
      urgent ? "bg-orange-500 text-white" : "bg-amber-100 text-amber-900"
    } ${size === "lg" ? "text-5xl" : "text-2xl"}`} aria-live="polite">
      <Timer size={size === "lg" ? 36 : 22} aria-hidden />
      {text}
      {sec !== null && <span className={size === "lg" ? "text-2xl" : "text-base"}>秒</span>}
    </div>
  );
}
