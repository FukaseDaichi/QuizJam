import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Download, Plus, Save, Shuffle, Trash2, Upload } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { AdminGate } from "./AdminGate";
import { DEFAULT_SETTINGS } from "../../shared/defaults";
import { shuffleAnagram } from "../../shared/anagram";
import { validateQuestionSetInput, type QuestionSetInput } from "../../shared/validateQuestionSet";
import type { Question, QuestionSettings } from "../../shared/types";

export function QuestionSetEditPage() {
  return <AdminGate>{(pass) => <Editor passphrase={pass} />}</AdminGate>;
}

function newQuestion(): Question {
  return { id: crypto.randomUUID(), type: "anagram", prompt: "", answers: [""] };
}

const fieldClass = "mt-1 h-12 w-full rounded-xl bg-slate-700 px-3 text-base text-slate-100";

function Editor({ passphrase }: { passphrase: string }) {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const isNew = id === "new";
  const [name, setName] = useState("");
  const [settings, setSettings] = useState<QuestionSettings>(DEFAULT_SETTINGS);
  const [questions, setQuestions] = useState<Question[]>([newQuestion()]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNew) return;
    api.getQuestionSet(id).then((s) => { setName(s.name); setSettings({ ...DEFAULT_SETTINGS, ...s.settings }); setQuestions(s.questions); });
  }, [id, isNew]);

  const input = (): QuestionSetInput | { error: string } =>
    validateQuestionSetInput({ name, settings, questions: questions.map((q) => ({ ...q, answers: q.answers.map((a) => a.trim()).filter(Boolean) })) });

  const save = async () => {
    const v = input();
    if ("error" in v) { setError(v.error); return; }
    setSaving(true); setError(null); setSaved(false);
    try {
      if (isNew) { const created = await api.createQuestionSet(v, passphrase); navigate(`/admin/${created.id}`, { replace: true }); }
      else await api.updateQuestionSet(id, v, passphrase);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { setError("保存に失敗しました"); } finally { setSaving(false); }
  };

  const update = (i: number, patch: Partial<Question>) => setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) => setQuestions((qs) => {
    const n = [...qs]; const j = i + d;
    if (j < 0 || j >= n.length) return qs;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ name, settings, questions }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name || "question-set"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (file: File) => {
    try {
      const v = validateQuestionSetInput(JSON.parse(await file.text()));
      if ("error" in v) { setError(`インポート失敗: ${v.error}`); return; }
      setName(v.name); setSettings(v.settings); setQuestions(v.questions); setError(null);
    } catch { setError("JSONを読み込めません"); }
  };

  const num = (v: string) => (v === "" ? 0 : Number(v));

  return (
    <main className="min-h-full bg-slate-900 px-8 py-10 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <Link to="/admin" className="inline-flex items-center gap-1 text-slate-400"><ArrowLeft size={16} aria-hidden />一覧へ</Link>
        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-4xl font-black">{isNew ? "新しい問題セット" : "問題セットを編集"}</h1>
          <div className="flex gap-2">
            <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>JSONインポート</Button>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
            <Button variant="secondary" icon={Download} onClick={exportJson}>JSONエクスポート</Button>
            <Button variant="brand" icon={Save} onClick={save} disabled={saving}>保存</Button>
          </div>
        </div>
        {error && <p className="mt-3 rounded-xl bg-red-600/20 px-4 py-2 font-bold text-red-300">{error}</p>}
        {saved && <p className="qj-slide-in mt-3 rounded-xl bg-green-600/20 px-4 py-2 font-bold text-green-300">保存しました</p>}

        <Card tone="dark" title="基本設定" className="mt-6">
          <label className="block text-sm text-slate-400" htmlFor="set-name">セット名</label>
          <input id="set-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-12 w-full rounded-xl bg-slate-700 px-3 text-lg" />
          <div className="mt-4 grid grid-cols-3 gap-4">
            <label className="text-sm text-slate-400">制限時間モード
              <select value={settings.timerMode} onChange={(e) => setSettings({ ...settings, timerMode: e.target.value as QuestionSettings["timerMode"] })} className={fieldClass}>
                <option value="fixed">固定カウントダウン</option>
                <option value="afterFirstCorrect">正解者が出てからカウントダウン</option>
                <option value="none">なし（GMが締切）</option>
              </select>
            </label>
            <label className="text-sm text-slate-400">秒数
              <input type="number" min={0} value={settings.timerSeconds} onChange={(e) => setSettings({ ...settings, timerSeconds: num(e.target.value) })} className={fieldClass} disabled={settings.timerMode === "none"} />
            </label>
            <label className="text-sm text-slate-400">お手付き上限（空で無制限）
              <input type="number" min={1} value={settings.maxAttempts ?? ""} onChange={(e) => setSettings({ ...settings, maxAttempts: e.target.value === "" ? null : Number(e.target.value) })} className={fieldClass} />
            </label>
            <label className="text-sm text-slate-400">基本点
              <input type="number" value={settings.basePoints} onChange={(e) => setSettings({ ...settings, basePoints: num(e.target.value) })} className={fieldClass} />
            </label>
            <label className="text-sm text-slate-400">正解順ボーナス（カンマ区切り）
              <input value={settings.rankBonus.join(",")} onChange={(e) => setSettings({ ...settings, rankBonus: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)) })} className={fieldClass} />
            </label>
            <label className="text-sm text-slate-400">不正解ペナルティ
              <input type="number" min={0} value={settings.wrongPenalty} onChange={(e) => setSettings({ ...settings, wrongPenalty: num(e.target.value) })} className={fieldClass} />
            </label>
          </div>
        </Card>

        <Card tone="dark" title={`問題（${questions.length}問）`} className="mt-6">
          <ol className="space-y-4">
            {questions.map((q, i) => (
              <li key={q.id} className="rounded-xl bg-slate-700/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold">第{i + 1}問</span>
                  <div className="flex gap-1">
                    <button onClick={() => move(i, -1)} className="rounded-lg p-2 hover:bg-slate-600" aria-label="上へ"><ArrowUp size={16} /></button>
                    <button onClick={() => move(i, 1)} className="rounded-lg p-2 hover:bg-slate-600" aria-label="下へ"><ArrowDown size={16} /></button>
                    <button onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))} className="rounded-lg p-2 hover:bg-slate-600" aria-label="削除"><Trash2 size={16} /></button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-sm text-slate-400">正解（複数は「/」区切り）
                    <input value={q.answers.join("/")} onChange={(e) => update(i, { answers: e.target.value.split("/") })} placeholder="りんご/林檎" className={fieldClass} />
                  </label>
                  <label className="text-sm text-slate-400">出題文（シャッフル済み文字列）
                    <div className="mt-1 flex gap-2">
                      <input value={q.prompt} onChange={(e) => update(i, { prompt: e.target.value })} className="h-12 flex-1 rounded-xl bg-slate-700 px-3 text-base text-slate-100" />
                      <Button type="button" variant="secondary" icon={Shuffle} onClick={() => q.answers[0]?.trim() && update(i, { prompt: shuffleAnagram(q.answers[0].trim()) })} aria-label="正解からシャッフル生成">生成</Button>
                    </div>
                  </label>
                  <label className="col-span-2 text-sm text-slate-400">ヒント（任意）
                    <input value={q.hint ?? ""} onChange={(e) => update(i, { hint: e.target.value || undefined })} className={fieldClass} />
                  </label>
                </div>
              </li>
            ))}
          </ol>
          <Button type="button" variant="secondary" icon={Plus} className="mt-4" onClick={() => setQuestions((qs) => [...qs, newQuestion()])}>問題を追加</Button>
        </Card>
      </div>
    </main>
  );
}
