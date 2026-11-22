import { useEffect } from "react";
import { Crown } from "lucide-react";

export function CorrectPopup({ id, nickname, correctRank, points, multiplier, onDone }: {
  id: number; nickname: string; correctRank: number; points: number; multiplier?: number; onDone: (id: number) => void;
}) {
  useEffect(() => { const t = setTimeout(() => onDone(id), 3000); return () => clearTimeout(t); }, [id, onDone]);
  return (
    <div className="qj-pop flex items-center gap-4 rounded-2xl bg-green-500 px-6 py-4 text-white shadow-xl" role="status">
      <Crown size={32} aria-hidden />
      <div>
        <p className="text-2xl font-black">{nickname}さんが正解しました！</p>
        <p className="text-base font-bold opacity-90">{correctRank}番目 / +{points}点{multiplier === 2 && " ×2"}</p>
      </div>
    </div>
  );
}
