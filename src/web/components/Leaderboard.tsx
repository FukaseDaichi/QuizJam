import { Crown } from "lucide-react";
import type { LeaderboardEntry } from "../../shared/types";

export function Leaderboard({ entries, meId, tone = "light", compact = false }: {
  entries: LeaderboardEntry[]; meId?: string; tone?: "light" | "dark"; compact?: boolean;
}) {
  const rankColor = (rank: number) =>
    rank === 1 ? "text-amber-400" : rank === 2 ? "text-slate-400" : rank === 3 ? "text-orange-400" : "opacity-60";
  return (
    <ol className="space-y-2">
      {entries.map((e) => {
        const me = e.participantId === meId;
        return (
          <li
            key={e.participantId}
            className={`flex items-center gap-3 rounded-xl px-3 transition-all duration-300 ${compact ? "py-1.5" : "py-2.5"} ${
              me ? "bg-brand text-white font-bold" : tone === "dark" ? "bg-slate-700/60" : "bg-slate-100"
            }`}
          >
            <span className={`w-8 text-right text-xl font-black tabular-nums ${me ? "" : rankColor(e.rank)}`}>{e.rank}</span>
            {e.rank === 1 ? <Crown size={20} className={me ? "" : "text-amber-400"} aria-label="1位" /> : <span className="w-5" />}
            <span className={`flex-1 truncate ${compact ? "text-base" : "text-lg"}`}>{e.nickname}</span>
            <span className={`tabular-nums font-bold ${compact ? "text-base" : "text-lg"}`}>{e.score}点</span>
          </li>
        );
      })}
    </ol>
  );
}
