import { Crown } from "lucide-react";
import type { LeaderboardEntry } from "../../shared/types";
import { specialtiesText } from "./GenreButtons";

/** specialties を渡すと名前の下に得意ジャンルを出す。showUnchosen なら未選択の人に「未選択」 */
export function Leaderboard({ entries, meId, tone = "light", compact = false, specialties, showUnchosen = false }: {
  entries: LeaderboardEntry[]; meId?: string; tone?: "light" | "dark"; compact?: boolean;
  specialties?: Record<string, string[] | undefined>; showUnchosen?: boolean;
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
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${compact ? "text-base" : "text-lg"}`}>{e.nickname}</span>
              {specialties && (specialties[e.participantId]?.length || showUnchosen) ? <span className="block truncate text-xs font-normal opacity-70">{specialtiesText(specialties[e.participantId])}</span> : null}
            </span>
            <span className={`tabular-nums font-bold ${compact ? "text-base" : "text-lg"}`}>{e.score}点</span>
          </li>
        );
      })}
    </ol>
  );
}
