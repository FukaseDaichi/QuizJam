import { useState } from "react";
import { Check, Star } from "lucide-react";
import type { GenreCount } from "../../shared/genre";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { GenreButtons } from "../components/GenreButtons";

/** 得意ジャンルの選択。need 個そろうと「決定」が押せる */
export function SpecialtyPicker({ genres, need, onDecide }: { genres: GenreCount[]; need: number; onDecide: (genres: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  // 選んだあとに問題が尽きたジャンルは数えない
  const chosen = picked.filter((g) => genres.some((x) => x.genre === g && x.remaining > 0));
  const toggle = (genre: string) => setPicked((cur) => {
    if (cur.includes(genre)) return cur.filter((g) => g !== genre);
    return cur.length >= need ? cur : [...cur, genre];   // need 個を超える選択は無視する
  });
  return (
    <Card icon={Star} title="得意ジャンル">
      <h2 className="text-2xl font-black leading-tight">{need > 0 ? `得意ジャンルを${need}つ選んでください` : "選べるジャンルが残っていません"}</h2>
      <p className="mb-4 mt-1 text-sm text-slate-600">得意ジャンル以外で正解すると 2倍</p>
      {need > 0 && <GenreButtons genres={genres} tone="light" selected={chosen} showRemaining={false} onPick={toggle} />}
      <Button type="button" variant="brand" size="lg" icon={Check} className="mt-4 w-full" disabled={chosen.length !== need} onClick={() => onDecide(chosen)}>決定</Button>
    </Card>
  );
}
