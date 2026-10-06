import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Settings, Play, Presentation } from "lucide-react";
import { api } from "../lib/api";
import { storage } from "../lib/storage";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import type { QuestionSetSummary } from "../../shared/types";

export function GmTopPage() {
  const navigate = useNavigate();
  const [sets, setSets] = useState<QuestionSetSummary[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.listQuestionSets().then(setSets).catch(() => setSets([])); }, []);

  const createRoom = async () => {
    setBusy(true);
    try {
      const r = await api.createRoom();
      storage.setGmToken(r.roomCode, r.gmToken);
      navigate(`/gm/${r.roomCode}`);
    } finally { setBusy(false); }
  };

  return (
    <main className="min-h-full bg-slate-900 px-8 py-10 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-brand text-6xl font-black">QuizJam</h1>
        <p className="mt-2 text-slate-400">GM 画面</p>
        <div className="mt-8 flex gap-4">
          <Button variant="brand" size="lg" icon={Play} onClick={createRoom} disabled={busy}>新しいルームを作る</Button>
          <Link to="/admin"><Button variant="secondary" size="lg" icon={Settings}>問題セットを管理</Button></Link>
        </div>
        <Card tone="dark" title="問題セット" className="mt-8">
          {sets.length === 0 ? (
            <p className="text-slate-400">問題セットがありません。<Link className="underline" to="/admin">管理画面</Link>から作成してください。</p>
          ) : (
            <ul className="divide-y divide-slate-700">
              {sets.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-4 py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-700 text-slate-400">
                      {s.coverImageUrl ? <img src={s.coverImageUrl} alt="" className="h-full w-full object-cover" /> : <Presentation size={18} aria-hidden />}
                    </span>
                    <span className="truncate text-lg font-bold">{s.name}</span>
                  </span>
                  <span className="text-slate-400">{s.questionCount}問</span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/admin/new" className="mt-4 inline-flex items-center gap-1 text-sm text-slate-300 underline"><Plus size={16} aria-hidden />新しい問題セット</Link>
        </Card>
      </div>
    </main>
  );
}
