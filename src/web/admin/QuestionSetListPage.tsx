import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2, ArrowLeft, Presentation } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { AdminGate } from "./AdminGate";
import type { QuestionSetSummary } from "../../shared/types";

export function QuestionSetListPage() {
  return <AdminGate>{(pass) => <List passphrase={pass} />}</AdminGate>;
}

function List({ passphrase }: { passphrase: string }) {
  const [sets, setSets] = useState<QuestionSetSummary[]>([]);
  const reload = () => api.listQuestionSets().then(setSets);
  useEffect(() => { reload(); }, []);
  const remove = async (s: QuestionSetSummary) => {
    if (!confirm(`「${s.name}」を削除しますか？`)) return;
    await api.deleteQuestionSet(s.id, passphrase);
    reload();
  };
  return (
    <main className="min-h-full bg-slate-900 px-8 py-10 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-1 text-slate-400"><ArrowLeft size={16} aria-hidden />トップへ</Link>
        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-4xl font-black">企画一覧</h1>
          <Link to="/admin/new"><Button variant="brand" icon={Plus}>新規作成</Button></Link>
        </div>
        <Card tone="dark" className="mt-6">
          <ul className="divide-y divide-slate-700">
            {sets.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-4 py-3">
                <Link to={`/admin/${s.id}`} className="flex min-w-0 flex-1 items-center gap-4 hover:underline">
                  <span className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-700 text-slate-400">
                    {s.coverImageUrl ? <img src={s.coverImageUrl} alt="" className="h-full w-full object-cover" /> : <Presentation size={20} aria-hidden />}
                  </span>
                  <span className="truncate text-lg font-bold">{s.name}</span>
                </Link>
                <div className="flex items-center gap-4 text-slate-400">
                  <span>{s.questionCount}問</span>
                  <button onClick={() => remove(s)} className="rounded-lg p-2 hover:bg-slate-700" aria-label="削除"><Trash2 size={18} /></button>
                </div>
              </li>
            ))}
            {sets.length === 0 && <li className="py-3 text-slate-400">まだありません。「新規作成」から1問ずつスライドのように作れます</li>}
          </ul>
        </Card>
      </div>
    </main>
  );
}
