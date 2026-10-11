import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, Download, Plus, Presentation, Save, Trash2, Upload,
} from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/Button";
import { AdminGate } from "./AdminGate";
import { DEFAULT_SETTINGS, resolveSettings } from "../../shared/defaults";
import { validateQuestionSetInput, type QuestionSetInput } from "../../shared/validateQuestionSet";
import type { IntroSlide, Question, QuestionSet, QuestionSettings } from "../../shared/types";
import { IntroSlidePreview, QuestionSlidePreview, TitleSlidePreview } from "../components/Slides";
import { IntroInspector, QuestionInspector, TitleInspector } from "./SlideInspector";

export function QuestionSetEditPage() {
  return <AdminGate>{(pass) => <Editor passphrase={pass} />}</AdminGate>;
}

/** 選択中のスライド。"title" がタイトル、{ intro } が説明スライド、数値が問題のインデックス */
type Selection = "title" | number | { intro: number };

const isIntroSel = (s: Selection): s is { intro: number } => typeof s === "object";

function newQuestion(): Question {
  return { id: crypto.randomUUID(), type: "anagram", prompt: "", answers: [""] };
}
function newIntroSlide(): IntroSlide {
  return { id: crypto.randomUUID() };
}

interface Draft { name: string; coverImageUrl?: string; slideBackground?: string; introSlides: IntroSlide[]; settings: QuestionSettings; questions: Question[] }

const EMPTY_DRAFT: Draft = { name: "", introSlides: [], settings: DEFAULT_SETTINGS, questions: [newQuestion()] };

function introEmpty(s: IntroSlide): boolean {
  return !s.heading?.trim() && !s.body?.trim() && !s.imageUrl;
}

/** 保存前チェック。問題のある最初のスライドを返す */
function findProblem(d: Draft): { slide: Selection; message: string } | null {
  if (!d.name.trim()) return { slide: "title", message: "企画名を入力してください" };
  if (d.questions.length === 0) return { slide: "title", message: "問題を1問以上追加してください" };
  for (const [i, s] of d.introSlides.entries()) {
    if (introEmpty(s)) return { slide: { intro: i }, message: `説明スライド${i + 1}に見出し・本文・画像のどれかを入れてください` };
  }
  for (const [i, q] of d.questions.entries()) {
    if (!q.answers.some((a) => a.trim())) return { slide: i, message: `第${i + 1}問の正解を入力してください` };
    if (!q.prompt.trim() && !q.imageUrl) return { slide: i, message: `第${i + 1}問の出題文か画像を入れてください（出題文は「生成」で正解から作れます）` };
  }
  return null;
}

function questionIncomplete(q: Question): boolean {
  return (!q.prompt.trim() && !q.imageUrl) || !q.answers.some((a) => a.trim());
}

function toInput(d: Draft): QuestionSetInput | { error: string } {
  return validateQuestionSetInput({
    ...d,
    name: d.name.trim(),
    introSlides: d.introSlides.map((s) => ({ ...s, heading: s.heading?.trim() || undefined, body: s.body?.trim() || undefined })),
    questions: d.questions.map((q) => ({ ...q, prompt: q.prompt.trim(), answers: q.answers.map((a) => a.trim()).filter(Boolean) })),
  });
}

function fromSet(s: QuestionSet | QuestionSetInput): Draft {
  return {
    name: s.name, coverImageUrl: s.coverImageUrl, slideBackground: s.slideBackground,
    introSlides: s.introSlides ?? [],
    settings: { ...DEFAULT_SETTINGS, ...s.settings },
    questions: s.questions.length ? s.questions : [newQuestion()],
  };
}

function Editor({ passphrase }: { passphrase: string }) {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const isNew = id === "new";
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [savedJson, setSavedJson] = useState<string>(() => JSON.stringify(EMPTY_DRAFT));
  const [loading, setLoading] = useState(!isNew);
  const [selected, setSelected] = useState<Selection>("title");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const thumbRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    if (isNew) return;
    api.getQuestionSet(id).then((s) => { const d = fromSet(s); setDraft(d); setSavedJson(JSON.stringify(d)); })
      .catch(() => setError("問題セットを読み込めませんでした")).finally(() => setLoading(false));
  }, [id, isNew]);

  const dirty = useMemo(() => JSON.stringify(draft) !== savedJson, [draft, savedJson]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const { questions, settings, introSlides } = draft;
  const total = questions.length;
  const introCount = introSlides.length;
  const current = typeof selected === "number" ? questions[selected] : undefined;
  const currentIntro = isIntroSel(selected) ? introSlides[selected.intro] : undefined;
  // 削除などで選択位置が範囲外になったら手前に寄せる
  useEffect(() => {
    if (typeof selected === "number" && selected >= total) setSelected(total ? total - 1 : "title");
    if (isIntroSel(selected) && selected.intro >= introCount) setSelected(introCount ? { intro: introCount - 1 } : "title");
  }, [selected, total, introCount]);

  // 選択したスライドのサムネイルを見える位置へ
  useEffect(() => {
    const key = selected === "title" ? "title" : isIntroSel(selected) ? introSlides[selected.intro]?.id : questions[selected]?.id;
    if (key) thumbRefs.current.get(key)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected, questions, introSlides]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const updateQuestion = (i: number, p: Partial<Question>) => setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, ...p } : q)) }));
  const updateIntro = (i: number, p: Partial<IntroSlide>) => setDraft((d) => ({ ...d, introSlides: d.introSlides.map((s, j) => (j === i ? { ...s, ...p } : s)) }));

  const addQuestion = (after: number = total - 1) => {
    const q = newQuestion();
    setDraft((d) => { const qs = [...d.questions]; qs.splice(after + 1, 0, q); return { ...d, questions: qs }; });
    setSelected(after + 1);
  };
  const duplicateQuestion = (i: number) => {
    setDraft((d) => { const qs = [...d.questions]; qs.splice(i + 1, 0, { ...structuredClone(d.questions[i]), id: crypto.randomUUID() }); return { ...d, questions: qs }; });
    setSelected(i + 1);
  };
  const removeQuestion = (i: number) => {
    const q = questions[i];
    if (!questionIncomplete(q) && !confirm(`第${i + 1}問「${q.answers[0] || q.prompt}」を削除しますか？`)) return;
    setDraft((d) => ({ ...d, questions: d.questions.filter((_, j) => j !== i) }));
    setSelected(i > 0 ? i - 1 : total > 1 ? 0 : "title");
  };
  const moveQuestion = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= total) return;
    setDraft((d) => { const qs = [...d.questions]; [qs[i], qs[j]] = [qs[j], qs[i]]; return { ...d, questions: qs }; });
    setSelected(j);
  };

  // 説明スライドは末尾（最後の説明スライドの後ろ）に追加する
  const addIntro = () => {
    const s = newIntroSlide();
    setDraft((d) => ({ ...d, introSlides: [...d.introSlides, s] }));
    setSelected({ intro: introCount });
  };
  const duplicateIntro = (i: number) => {
    setDraft((d) => { const ss = [...d.introSlides]; ss.splice(i + 1, 0, { ...structuredClone(d.introSlides[i]), id: crypto.randomUUID() }); return { ...d, introSlides: ss }; });
    setSelected({ intro: i + 1 });
  };
  const removeIntro = (i: number) => {
    const s = introSlides[i];
    if (!introEmpty(s) && !confirm(`説明スライド${i + 1}「${s.heading || s.body?.split("\n")[0] || "画像"}」を削除しますか？`)) return;
    setDraft((d) => ({ ...d, introSlides: d.introSlides.filter((_, j) => j !== i) }));
    setSelected(i > 0 ? { intro: i - 1 } : "title");
  };
  const moveIntro = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= introCount) return;
    setDraft((d) => { const ss = [...d.introSlides]; [ss[i], ss[j]] = [ss[j], ss[i]]; return { ...d, introSlides: ss }; });
    setSelected({ intro: j });
  };

  // 並び: タイトル → 説明1..k → 問題1..n
  const goPrev = useCallback(() => setSelected((s) => {
    if (s === "title") return "title";
    if (isIntroSel(s)) return s.intro === 0 ? "title" : { intro: s.intro - 1 };
    if (s === 0) return introCount ? { intro: introCount - 1 } : "title";
    return s - 1;
  }), [introCount]);
  const goNext = useCallback(() => setSelected((s) => {
    if (s === "title") return introCount ? { intro: 0 } : total ? 0 : "title";
    if (isIntroSel(s)) return s.intro + 1 < introCount ? { intro: s.intro + 1 } : total ? 0 : s;
    return Math.min(total - 1, s + 1);
  }), [introCount, total]);
  const atLast = selected !== "title" && (isIntroSel(selected) ? selected.intro >= introCount - 1 && total === 0 : selected >= total - 1);

  // 入力欄以外にフォーカスがあるときは ↑↓ / PageUp・PageDown でスライド移動
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); goPrev(); }
      if (e.key === "ArrowDown" || e.key === "PageDown") { e.preventDefault(); goNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  const save = async () => {
    const problem = findProblem(draft);
    if (problem) { setSelected(problem.slide); setError(problem.message); return; }
    const v = toInput(draft);
    if ("error" in v) { setError(v.error); return; }
    setSaving(true); setError(null);
    try {
      const saved = isNew ? await api.createQuestionSet(v, passphrase) : await api.updateQuestionSet(id, v, passphrase);
      const d = fromSet(saved);
      setDraft(d); setSavedJson(JSON.stringify(d)); setSavedAt(Date.now());
      if (isNew) navigate(`/admin/${saved.id}`, { replace: true });
    } catch { setError("保存に失敗しました"); } finally { setSaving(false); }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ ...draft, name: draft.name.trim() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.name.trim() || "question-set"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (file: File) => {
    try {
      const v = validateQuestionSetInput(JSON.parse(await file.text()));
      if ("error" in v) { setError(`インポート失敗: ${v.error}`); return; }
      if (dirty && !confirm("未保存の内容をインポートした内容で置き換えますか？")) return;
      setDraft(fromSet(v)); setSelected("title"); setError(null);
    } catch { setError("JSONを読み込めません"); }
  };

  const registerThumb = (key: string) => (el: HTMLElement | null) => { if (el) thumbRefs.current.set(key, el); else thumbRefs.current.delete(key); };
  const thumbClass = (active: boolean) =>
    `group relative flex w-full items-start gap-2 rounded-xl p-2 text-left transition ${active ? "bg-slate-700 ring-2 ring-purple-400" : "hover:bg-slate-700/50"}`;
  const toolBtn = "rounded-xl p-2 hover:bg-slate-800 disabled:opacity-30";

  if (loading) return <main className="flex min-h-full items-center justify-center bg-slate-900 text-slate-400">読み込んでいます…</main>;

  const heading = selected === "title" ? "タイトルスライド" : isIntroSel(selected) ? `説明スライド ${selected.intro + 1}` : `第${selected + 1}問`;
  const position = selected === "title" ? "タイトル" : isIntroSel(selected) ? `説明 ${selected.intro + 1} / ${introCount}` : `${selected + 1} / ${total}`;

  return (
    <main className="grid h-full grid-rows-[auto_1fr] bg-slate-900 text-slate-100">
      <header className="flex items-center gap-4 border-b border-slate-800 px-6 py-3">
        <Link to="/admin" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"><ArrowLeft size={16} aria-hidden />一覧へ</Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-black">
          {draft.name.trim() || (isNew ? "新しい企画" : "企画を編集")}
          <span className="ml-3 text-sm font-bold text-slate-500">{total}問{introCount > 0 && ` ・ 説明${introCount}枚`}</span>
        </h1>
        <span className="text-sm" aria-live="polite">
          {dirty ? <span className="inline-flex items-center gap-1 text-amber-300"><AlertCircle size={16} aria-hidden />未保存</span>
            : savedAt ? <span className="inline-flex items-center gap-1 text-green-300"><Check size={16} aria-hidden />保存済み</span> : null}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Upload} onClick={() => fileRef.current?.click()}>インポート</Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ""; }} />
          <Button variant="secondary" icon={Download} onClick={exportJson}>エクスポート</Button>
          <Button variant="brand" icon={Save} onClick={save} disabled={saving || (!dirty && !isNew)}>{saving ? "保存中…" : "保存"}</Button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[240px_1fr_380px]">
        {/* 左: スライド一覧（タイトル → 説明 → 問題） */}
        <nav className="flex min-h-0 flex-col border-r border-slate-800" aria-label="スライド一覧">
          <ol className="flex-1 space-y-1 overflow-y-auto p-3">
            <li ref={registerThumb("title")}>
              <button type="button" onClick={() => setSelected("title")} className={thumbClass(selected === "title")} aria-current={selected === "title" ? "true" : undefined}>
                <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-bold text-slate-400">T</span>
                <span className="min-w-0 flex-1"><TitleSlidePreview name={draft.name} coverImageUrl={draft.coverImageUrl} questionCount={total} settings={settings} compact /></span>
              </button>
            </li>
            {introSlides.map((s, i) => {
              const active = isIntroSel(selected) && selected.intro === i;
              const empty = introEmpty(s);
              return (
                <li key={s.id} ref={registerThumb(s.id)}>
                  <button type="button" onClick={() => setSelected({ intro: i })} className={thumbClass(active)} aria-current={active ? "true" : undefined} aria-label={`説明スライド${i + 1}${empty ? "（未入力）" : ""}`}>
                    <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-bold text-slate-400">説{i + 1}</span>
                    <span className="min-w-0 flex-1"><IntroSlidePreview heading={s.heading} body={s.body} imageUrl={s.imageUrl} compact /></span>
                    {empty && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900" aria-hidden />}
                  </button>
                </li>
              );
            })}
            {questions.map((q, i) => {
              const incomplete = questionIncomplete(q);
              return (
                <li key={q.id} ref={registerThumb(q.id)}>
                  <button type="button" onClick={() => setSelected(i)} className={thumbClass(selected === i)} aria-current={selected === i ? "true" : undefined} aria-label={`第${i + 1}問${incomplete ? "（未入力あり）" : ""}`}>
                    <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-bold text-slate-400">{i + 1}</span>
                    <span className="min-w-0 flex-1"><QuestionSlidePreview question={q} index={i} total={total} settings={resolveSettings({ id: "", ...draft }, i)} background={draft.slideBackground} compact /></span>
                    {incomplete && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-slate-900" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-col gap-2 border-t border-slate-800 p-3">
            <Button type="button" variant="secondary" icon={Presentation} className="w-full" onClick={addIntro} disabled={introCount >= 20}>説明スライドを追加</Button>
            <Button type="button" variant="secondary" icon={Plus} className="w-full" onClick={() => addQuestion()}>問題を追加</Button>
          </div>
        </nav>

        {/* 中央: 大きなプレビュー */}
        <section className="flex min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto bg-slate-950/60 p-8">
          <div className="w-full max-w-4xl">
            {selected === "title"
              ? <TitleSlidePreview name={draft.name} coverImageUrl={draft.coverImageUrl} questionCount={total} settings={settings} />
              : isIntroSel(selected)
                ? currentIntro && <IntroSlidePreview heading={currentIntro.heading} body={currentIntro.body} imageUrl={currentIntro.imageUrl} />
                : current && <QuestionSlidePreview question={current} index={selected} total={total} settings={resolveSettings({ id: "", ...draft }, selected)} background={draft.slideBackground} />}
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <button type="button" onClick={goPrev} disabled={selected === "title"} className={toolBtn} aria-label="前のスライド"><ChevronLeft size={22} /></button>
            <span className="w-28 text-center text-sm font-bold tabular-nums">{position}</span>
            <button type="button" onClick={goNext} disabled={atLast} className={toolBtn} aria-label="次のスライド"><ChevronRight size={22} /></button>
            {isIntroSel(selected) && (
              <div className="ml-6 flex items-center gap-1 border-l border-slate-700 pl-6">
                <button type="button" onClick={() => moveIntro(selected.intro, -1)} disabled={selected.intro === 0} className={toolBtn} aria-label="前へ移動"><ArrowUp size={18} /></button>
                <button type="button" onClick={() => moveIntro(selected.intro, 1)} disabled={selected.intro >= introCount - 1} className={toolBtn} aria-label="後ろへ移動"><ArrowDown size={18} /></button>
                <button type="button" onClick={() => duplicateIntro(selected.intro)} className={toolBtn} aria-label="この説明スライドを複製"><Copy size={18} /></button>
                <button type="button" onClick={() => removeIntro(selected.intro)} className={`${toolBtn} text-red-300`} aria-label="この説明スライドを削除"><Trash2 size={18} /></button>
              </div>
            )}
            {typeof selected === "number" && (
              <div className="ml-6 flex items-center gap-1 border-l border-slate-700 pl-6">
                <button type="button" onClick={() => moveQuestion(selected, -1)} disabled={selected === 0} className={toolBtn} aria-label="前へ移動"><ArrowUp size={18} /></button>
                <button type="button" onClick={() => moveQuestion(selected, 1)} disabled={selected >= total - 1} className={toolBtn} aria-label="後ろへ移動"><ArrowDown size={18} /></button>
                <button type="button" onClick={() => duplicateQuestion(selected)} className={toolBtn} aria-label="この問題を複製"><Copy size={18} /></button>
                <button type="button" onClick={() => removeQuestion(selected)} className={`${toolBtn} text-red-300`} aria-label="この問題を削除"><Trash2 size={18} /></button>
                <Button type="button" variant="secondary" icon={Plus} className="ml-2 h-10 px-4 text-sm" onClick={() => addQuestion(selected)}>次に問題を追加</Button>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500">↑↓ キーでスライドを移動できます</p>
          {error && <p role="alert" className="qj-slide-in rounded-xl bg-red-600/20 px-4 py-2 font-bold text-red-300">{error}</p>}
        </section>

        {/* 右: 選択中スライドの内容 */}
        <aside className="min-h-0 overflow-y-auto border-l border-slate-800 p-5">
          <h2 className="mb-4 text-lg font-black">{heading}</h2>
          {selected === "title" ? (
            <TitleInspector name={draft.name} coverImageUrl={draft.coverImageUrl} slideBackground={draft.slideBackground} settings={settings} passphrase={passphrase}
              onName={(name) => patch({ name })} onCover={(coverImageUrl) => patch({ coverImageUrl })} onSlideBackground={(slideBackground) => patch({ slideBackground })}
              onSettings={(s) => patch({ settings: s })} />
          ) : isIntroSel(selected) ? (
            currentIntro && <IntroInspector key={currentIntro.id} slide={currentIntro} passphrase={passphrase} onChange={(p) => updateIntro(selected.intro, p)} />
          ) : current && (
            <QuestionInspector key={current.id} question={current} index={selected} baseSettings={settings} passphrase={passphrase} onChange={(p) => updateQuestion(selected, p)} />
          )}
        </aside>
      </div>
    </main>
  );
}
