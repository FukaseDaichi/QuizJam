import { Star } from "lucide-react";
import type { GenreCount } from "../../shared/genre";

/** 得意ジャンルを「動物・天気」の形にする。未選択（なし・空）は「未選択」 */
export function specialtiesText(specialties: string[] | undefined): string {
  return specialties && specialties.length > 0 ? specialties.join("・") : "未選択";
}

/**
 * ジャンルのボタン群。remaining が 0 のものと disabled のときは押せない。
 * tone="dark" は GM 画面（大きめ）、"light" はスマホ（高さ 48px 以上）
 */
export function GenreButtons({ genres, tone, selected = [], marked = [], showRemaining = true, disabled = false, onPick }: {
  genres: GenreCount[];
  tone: "light" | "dark";
  selected?: string[];
  marked?: string[];
  showRemaining?: boolean;
  disabled?: boolean;
  onPick?: (genre: string) => void;
}) {
  const dark = tone === "dark";
  return (
    <div className={`grid gap-3 ${dark ? "grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]" : "grid-cols-2"}`}>
      {genres.map((g) => {
        const on = selected.includes(g.genre);
        const empty = showRemaining && g.remaining === 0;
        const style = on
          ? "bg-brand border-transparent text-white shadow-lg shadow-purple-500/20"
          : dark ? "border-slate-600 bg-slate-700 text-slate-100 hover:bg-slate-600" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50";
        return (
          <button
            key={g.genre} type="button" disabled={disabled || empty} aria-pressed={selected.length > 0 ? on : undefined}
            onClick={() => onPick?.(g.genre)}
            className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-3 font-bold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 ${dark ? "min-h-20 py-3 text-xl" : "min-h-14 py-2 text-base"} ${style}`}
          >
            <span className="max-w-full break-words">{g.genre}</span>
            {showRemaining && <span className={`text-sm tabular-nums ${on ? "text-white/90" : dark ? "text-slate-300" : "text-slate-500"}`}>残り {g.remaining} 問</span>}
            {marked.includes(g.genre) && (
              <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-lg bg-amber-400 px-1.5 py-0.5 text-xs font-black text-amber-950"><Star size={12} aria-hidden />得意</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
