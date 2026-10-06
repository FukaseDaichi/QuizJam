import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Shuffle, X } from "lucide-react";
import type { Question, QuestionSettings, TimerMode } from "../../shared/types";
import { shuffleAnagram } from "../../shared/anagram";
import { Button } from "../components/Button";
import { Field, SectionTitle, inputClass, textareaClass } from "./fields";
import { ImageField } from "./ImageField";

const num = (v: string) => (v === "" ? 0 : Number(v));

const TIMER_LABELS: Record<TimerMode, string> = {
  fixed: "固定カウントダウン",
  afterFirstCorrect: "正解者が出てからカウントダウン",
  none: "なし（GMが締切）",
};

/** タイトルスライド＝企画名・表紙・セット全体の設定 */
export function TitleInspector({ name, coverImageUrl, settings, passphrase, onName, onCover, onSettings }: {
  name: string; coverImageUrl?: string; settings: QuestionSettings; passphrase: string;
  onName: (v: string) => void; onCover: (v: string | undefined) => void; onSettings: (s: QuestionSettings) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="企画名">
        <input value={name} onChange={(e) => onName(e.target.value)} placeholder="例: 新人歓迎会クイズ 2026" className={`${inputClass} text-lg`} autoFocus />
      </Field>
      <ImageField label="表紙画像（任意）" value={coverImageUrl} onChange={onCover} passphrase={passphrase} />

      <div className="border-t border-slate-700 pt-4">
        <SectionTitle>全問共通の設定</SectionTitle>
        <p className="mt-1 text-xs text-slate-500">各問題の「この問題だけの設定」で個別に上書きできます。</p>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="制限時間">
            <select value={settings.timerMode} onChange={(e) => onSettings({ ...settings, timerMode: e.target.value as TimerMode })} className={inputClass}>
              {(Object.keys(TIMER_LABELS) as TimerMode[]).map((m) => <option key={m} value={m}>{TIMER_LABELS[m]}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="秒数">
              <input type="number" min={0} value={settings.timerSeconds} onChange={(e) => onSettings({ ...settings, timerSeconds: num(e.target.value) })} className={inputClass} disabled={settings.timerMode === "none"} />
            </Field>
            <Field label="お手付き上限" hint="空で無制限">
              <input type="number" min={1} value={settings.maxAttempts ?? ""} onChange={(e) => onSettings({ ...settings, maxAttempts: e.target.value === "" ? null : Number(e.target.value) })} className={inputClass} />
            </Field>
            <Field label="基本点">
              <input type="number" value={settings.basePoints} onChange={(e) => onSettings({ ...settings, basePoints: num(e.target.value) })} className={inputClass} />
            </Field>
            <Field label="不正解ペナルティ">
              <input type="number" min={0} value={settings.wrongPenalty} onChange={(e) => onSettings({ ...settings, wrongPenalty: num(e.target.value) })} className={inputClass} />
            </Field>
          </div>
          <Field label="正解順ボーナス" hint="1位から順にカンマ区切り">
            <input value={settings.rankBonus.join(",")} onChange={(e) => onSettings({ ...settings, rankBonus: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)) })} className={inputClass} />
          </Field>
        </div>
      </div>
    </div>
  );
}

/** 問題スライド＝1問分の内容と個別設定 */
export function QuestionInspector({ question, index, baseSettings, passphrase, onChange }: {
  question: Question; index: number; baseSettings: QuestionSettings; passphrase: string; onChange: (patch: Partial<Question>) => void;
}) {
  const answers = question.answers.length ? question.answers : [""];
  const setAnswer = (i: number, v: string) => onChange({ answers: answers.map((a, j) => (j === i ? v : a)) });
  const removeAnswer = (i: number) => onChange({ answers: answers.length === 1 ? [""] : answers.filter((_, j) => j !== i) });
  const primary = answers[0]?.trim() ?? "";

  return (
    <div className="flex flex-col gap-5">
      <div className="text-sm font-bold text-slate-300" role="group" aria-labelledby={`answers-${question.id}`}>
        <span id={`answers-${question.id}`}>正解<span className="ml-2 text-xs font-normal text-slate-500">1つ目が代表表記。表記ゆれは下に追加</span></span>
        <div className="mt-1 flex flex-col gap-2">
          {answers.map((a, i) => (
            <div key={i} className="flex gap-2">
              <input value={a} onChange={(e) => setAnswer(i, e.target.value)} placeholder={i === 0 ? "例: りんご" : "例: 林檎"} aria-label={i === 0 ? "正解（代表表記）" : `正解の別表記 ${i}`}
                className={`${inputClass} mt-0 ${i === 0 ? "text-lg font-bold" : ""}`} autoFocus={i === 0 && !a} />
              {answers.length > 1 && (
                <button type="button" onClick={() => removeAnswer(i)} className="rounded-xl px-2 text-slate-400 hover:bg-slate-700 hover:text-red-300" aria-label="この表記を削除"><X size={18} /></button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => onChange({ answers: [...answers, ""] })} className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-slate-400 hover:text-slate-200">
          <Plus size={16} aria-hidden />別の表記を追加
        </button>
      </div>

      <Field label="出題文" hint="画面に大きく表示されるシャッフル済み文字列">
        <div className="mt-1 flex gap-2">
          <input value={question.prompt} onChange={(e) => onChange({ prompt: e.target.value })} placeholder="例: ごんり" className={`${inputClass} mt-0 text-lg font-bold tracking-widest`} />
          <Button type="button" variant="secondary" icon={Shuffle} disabled={!primary} onClick={() => onChange({ prompt: shuffleAnagram(primary) })} aria-label="正解からシャッフル生成" className="shrink-0">生成</Button>
        </div>
      </Field>

      <ImageField label="問題画像（任意）" value={question.imageUrl} onChange={(imageUrl) => onChange({ imageUrl })} passphrase={passphrase} />

      <Field label="ヒント（任意）" hint="参加者の画面に表示">
        <textarea rows={2} value={question.hint ?? ""} onChange={(e) => onChange({ hint: e.target.value || undefined })} className={textareaClass} />
      </Field>

      <OverridesPanel key={question.id} index={index} overrides={question.overrides} base={baseSettings} onChange={(overrides) => onChange({ overrides })} />
    </div>
  );
}

function OverridesPanel({ index, overrides, base, onChange }: {
  index: number; overrides?: Partial<QuestionSettings>; base: QuestionSettings; onChange: (o: Partial<QuestionSettings> | undefined) => void;
}) {
  const active = !!overrides && Object.keys(overrides).length > 0;
  const [open, setOpen] = useState(active);
  const o = overrides ?? {};
  const set = (patch: Partial<QuestionSettings>, clear?: (keyof QuestionSettings)[]) => {
    const next: Partial<QuestionSettings> = { ...o, ...patch };
    for (const k of clear ?? []) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const timerMode = o.timerMode ?? base.timerMode;

  return (
    <div className="rounded-xl border border-slate-700">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-slate-300 hover:bg-slate-700/50" aria-expanded={open}>
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        第{index + 1}問だけの設定
        {active && <span className="ml-auto rounded-full bg-purple-500/30 px-2 py-0.5 text-xs text-purple-200">上書き中</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-slate-700 p-3">
          <Field label="制限時間">
            <select value={o.timerMode ?? ""} onChange={(e) => (e.target.value ? set({ timerMode: e.target.value as TimerMode }) : set({}, ["timerMode"]))} className={inputClass}>
              <option value="">共通設定を使う（{TIMER_LABELS[base.timerMode]}）</option>
              {(Object.keys(TIMER_LABELS) as TimerMode[]).map((m) => <option key={m} value={m}>{TIMER_LABELS[m]}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="秒数" hint={`共通: ${base.timerSeconds}`}>
              <input type="number" min={0} value={o.timerSeconds ?? ""} placeholder={String(base.timerSeconds)} disabled={timerMode === "none"}
                onChange={(e) => (e.target.value === "" ? set({}, ["timerSeconds"]) : set({ timerSeconds: Number(e.target.value) }))} className={inputClass} />
            </Field>
            <Field label="基本点" hint={`共通: ${base.basePoints}`}>
              <input type="number" value={o.basePoints ?? ""} placeholder={String(base.basePoints)}
                onChange={(e) => (e.target.value === "" ? set({}, ["basePoints"]) : set({ basePoints: Number(e.target.value) }))} className={inputClass} />
            </Field>
          </div>
          <Field label="お手付き上限" hint={`共通: ${base.maxAttempts ?? "無制限"}`}>
            <select value={o.maxAttempts === undefined ? "" : o.maxAttempts === null ? "null" : String(o.maxAttempts)}
              onChange={(e) => (e.target.value === "" ? set({}, ["maxAttempts"]) : set({ maxAttempts: e.target.value === "null" ? null : Number(e.target.value) }))} className={inputClass}>
              <option value="">共通設定を使う</option>
              <option value="null">無制限</option>
              {[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}回まで</option>)}
            </select>
          </Field>
          {active && (
            <button type="button" onClick={() => onChange(undefined)} className="self-start text-xs font-bold text-slate-400 underline hover:text-slate-200">上書きをすべて解除</button>
          )}
        </div>
      )}
    </div>
  );
}
