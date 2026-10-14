import { useState } from "react";
import { MODE_LABELS, TIMER_MODE_LABELS } from "../lib/labels";
import { ChevronDown, ChevronRight, Plus, Shuffle, X } from "lucide-react";
import type { IntroSlide, Question, QuestionSetMode, QuestionSettings, TimerMode } from "../../shared/types";
import { MAX_CHARS_PER_SECOND, MIN_CHARS_PER_SECOND } from "../../shared/validateQuestionSet";
import { shuffleAnagram } from "../../shared/anagram";
import { Button } from "../components/Button";
import { Field, SectionTitle, inputClass, textareaClass } from "./fields";
import { ImageField } from "./ImageField";

const num = (v: string) => (v === "" ? 0 : Number(v));

const TIMER_LABELS = TIMER_MODE_LABELS;

/** タイトルスライド＝企画名・表紙・セット全体の設定 */
export function TitleInspector({ name, mode, coverImageUrl, slideBackground, settings, passphrase, onName, onMode, onCover, onSlideBackground, onSettings }: {
  name: string; mode: QuestionSetMode; coverImageUrl?: string; slideBackground?: string; settings: QuestionSettings; passphrase: string;
  onName: (v: string) => void; onMode: (v: QuestionSetMode) => void; onCover: (v: string | undefined) => void; onSlideBackground: (v: string | undefined) => void; onSettings: (s: QuestionSettings) => void;
}) {
  const buzzer = mode === "buzzer";
  return (
    <div className="flex flex-col gap-5">
      <Field label="企画名">
        <input value={name} onChange={(e) => onName(e.target.value)} placeholder="例: 新人歓迎会クイズ 2026" className={`${inputClass} text-lg`} autoFocus />
      </Field>
      <Field label="出題形式" hint="セット全体で1つ">
        <select value={mode} onChange={(e) => onMode(e.target.value as QuestionSetMode)} className={inputClass}>
          {(Object.keys(MODE_LABELS) as QuestionSetMode[]).map((m) => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
        </select>
        {buzzer && <p className="mt-1 text-xs font-normal text-slate-500">問題文が GM 画面に一文字ずつ表示され、参加者はスマホのボタンで早押しして口頭で答えます。正解・不正解は GM が判定します</p>}
      </Field>
      <ImageField label="表紙画像（任意）" value={coverImageUrl} onChange={onCover} passphrase={passphrase} />
      <div className="text-sm font-bold text-slate-300">
        問題スライドの背景色<span className="ml-2 text-xs font-normal text-slate-500">問題画像の地の色に合わせると画像が背景になじむ</span>
        <div className="mt-1 flex items-center gap-2">
          <input type="color" value={slideBackground ?? "#1e293b"} onChange={(e) => onSlideBackground(e.target.value)} aria-label="問題スライドの背景色"
            className="h-11 w-14 cursor-pointer rounded-xl border border-slate-600 bg-slate-900 p-1" />
          <span className="font-mono text-sm text-slate-400">{slideBackground ?? "標準（ダーク）"}</span>
          {slideBackground && (
            <button type="button" onClick={() => onSlideBackground(undefined)} className="ml-auto text-xs font-bold text-slate-400 underline hover:text-slate-200">標準に戻す</button>
          )}
        </div>
      </div>

      <div className="border-t border-slate-700 pt-4">
        <SectionTitle>全問共通の設定</SectionTitle>
        <p className="mt-1 text-xs text-slate-500">各問題の「この問題だけの設定」で個別に上書きできます。</p>
        <div className="mt-3 flex flex-col gap-3">
          {!buzzer && (
            <Field label="制限時間">
              <select value={settings.timerMode} onChange={(e) => onSettings({ ...settings, timerMode: e.target.value as TimerMode })} className={inputClass}>
                {(Object.keys(TIMER_LABELS) as TimerMode[]).map((m) => <option key={m} value={m}>{TIMER_LABELS[m]}</option>)}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            {!buzzer && (
              <Field label="秒数">
                <input type="number" min={0} value={settings.timerSeconds} onChange={(e) => onSettings({ ...settings, timerSeconds: num(e.target.value) })} className={inputClass} disabled={settings.timerMode === "none"} />
              </Field>
            )}
            {!buzzer && (
              <Field label="お手付き上限" hint="空で無制限">
                <input type="number" min={1} value={settings.maxAttempts ?? ""} onChange={(e) => onSettings({ ...settings, maxAttempts: e.target.value === "" ? null : Number(e.target.value) })} className={inputClass} />
              </Field>
            )}
            {buzzer && (
              <Field label="読み上げ速度" hint="文字/秒">
                <input type="number" min={MIN_CHARS_PER_SECOND} max={MAX_CHARS_PER_SECOND} value={settings.charsPerSecond} onChange={(e) => onSettings({ ...settings, charsPerSecond: num(e.target.value) })} className={inputClass} />
              </Field>
            )}
            <Field label="基本点">
              <input type="number" value={settings.basePoints} onChange={(e) => onSettings({ ...settings, basePoints: num(e.target.value) })} className={inputClass} />
            </Field>
            <Field label="不正解ペナルティ">
              <input type="number" min={0} value={settings.wrongPenalty} onChange={(e) => onSettings({ ...settings, wrongPenalty: num(e.target.value) })} className={inputClass} />
            </Field>
          </div>
          {!buzzer && (
            <Field label="正解順ボーナス" hint="1位から順にカンマ区切り">
              <input value={settings.rankBonus.join(",")} onChange={(e) => onSettings({ ...settings, rankBonus: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)) })} className={inputClass} />
            </Field>
          )}
        </div>
      </div>
    </div>
  );
}

/** 説明スライド＝見出し・本文・画像。どれか1つは必要 */
export function IntroInspector({ slide, passphrase, onChange }: {
  slide: IntroSlide; passphrase: string; onChange: (patch: Partial<IntroSlide>) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Field label="見出し（任意）">
        <input value={slide.heading ?? ""} onChange={(e) => onChange({ heading: e.target.value || undefined })} placeholder="例: ルール説明" maxLength={100} className={`${inputClass} text-lg font-bold`} autoFocus />
      </Field>
      <Field label="本文（任意）" hint="改行はそのまま表示。1000文字まで">
        <textarea rows={8} value={slide.body ?? ""} onChange={(e) => onChange({ body: e.target.value || undefined })} maxLength={1000}
          placeholder={"例: 1問につき3回まで回答できます\n早く正解するほど高得点"} className={textareaClass} />
      </Field>
      <ImageField label="画像（任意）" value={slide.imageUrl} onChange={(imageUrl) => onChange({ imageUrl })} passphrase={passphrase} />
      <p className="text-xs text-slate-500">見出し・本文・画像のどれか1つは必要です。</p>
    </div>
  );
}

/** 問題スライド＝1問分の内容と個別設定 */
export function QuestionInspector({ question, index, mode, baseSettings, passphrase, onChange }: {
  question: Question; index: number; mode: QuestionSetMode; baseSettings: QuestionSettings; passphrase: string; onChange: (patch: Partial<Question>) => void;
}) {
  const answers = question.answers.length ? question.answers : [""];
  const setAnswer = (i: number, v: string) => onChange({ answers: answers.map((a, j) => (j === i ? v : a)) });
  const removeAnswer = (i: number) => onChange({ answers: answers.length === 1 ? [""] : answers.filter((_, j) => j !== i) });
  const primary = answers[0]?.trim() ?? "";
  const buzzer = mode === "buzzer";

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

      {buzzer ? (
        <Field label="問題文（読み上げる文章）" hint="GM 画面に一文字ずつ表示される。参加者には見せない">
          <textarea rows={4} value={question.prompt} onChange={(e) => onChange({ prompt: e.target.value })} placeholder="例: 日本で一番高い山は何でしょう？" className={`${textareaClass} text-lg`} />
        </Field>
      ) : (
        <Field label="出題文" hint="画面に大きく表示されるシャッフル済み文字列。画像に文字が描かれていれば空欄でよい">
          <div className="mt-1 flex gap-2">
            <input value={question.prompt} onChange={(e) => onChange({ prompt: e.target.value })} placeholder="例: ごんり" className={`${inputClass} mt-0 text-lg font-bold tracking-widest`} />
            <Button type="button" variant="secondary" icon={Shuffle} disabled={!primary} onClick={() => onChange({ prompt: shuffleAnagram(primary) })} aria-label="正解からシャッフル生成" className="shrink-0">生成</Button>
          </div>
        </Field>
      )}

      <ImageField label="問題画像（任意）" value={question.imageUrl} onChange={(imageUrl) => onChange({ imageUrl })} passphrase={passphrase} />

      <ImageField label="解説画像（任意・問題結果の画面に表示）" value={question.explanationImageUrl} onChange={(explanationImageUrl) => onChange({ explanationImageUrl })} passphrase={passphrase} />

      {!buzzer && (
        <Field label="ヒント（任意）" hint="参加者が「ヒントを見る」を押すと表示">
          <textarea rows={2} value={question.hint ?? ""} onChange={(e) => onChange({ hint: e.target.value || undefined })} className={textareaClass} />
        </Field>
      )}

      <OverridesPanel key={question.id} index={index} mode={mode} overrides={question.overrides} base={baseSettings} onChange={(overrides) => onChange({ overrides })} />
    </div>
  );
}

function OverridesPanel({ index, mode, overrides, base, onChange }: {
  index: number; mode: QuestionSetMode; overrides?: Partial<QuestionSettings>; base: QuestionSettings; onChange: (o: Partial<QuestionSettings> | undefined) => void;
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
  const buzzer = mode === "buzzer";

  return (
    <div className="rounded-xl border border-slate-700">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-slate-300 hover:bg-slate-700/50" aria-expanded={open}>
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        第{index + 1}問だけの設定
        {active && <span className="ml-auto rounded-full bg-purple-500/30 px-2 py-0.5 text-xs text-purple-200">上書き中</span>}
      </button>
      {open && buzzer && (
        <div className="grid grid-cols-2 gap-3 border-t border-slate-700 p-3">
          <Field label="基本点" hint={`共通: ${base.basePoints}`}>
            <input type="number" value={o.basePoints ?? ""} placeholder={String(base.basePoints)}
              onChange={(e) => (e.target.value === "" ? set({}, ["basePoints"]) : set({ basePoints: Number(e.target.value) }))} className={inputClass} />
          </Field>
          <Field label="読み上げ速度" hint={`共通: ${base.charsPerSecond}`}>
            <input type="number" min={MIN_CHARS_PER_SECOND} max={MAX_CHARS_PER_SECOND} value={o.charsPerSecond ?? ""} placeholder={String(base.charsPerSecond)}
              onChange={(e) => (e.target.value === "" ? set({}, ["charsPerSecond"]) : set({ charsPerSecond: Number(e.target.value) }))} className={inputClass} />
          </Field>
          {active && (
            <button type="button" onClick={() => onChange(undefined)} className="col-span-2 self-start text-xs font-bold text-slate-400 underline hover:text-slate-200">上書きをすべて解除</button>
          )}
        </div>
      )}
      {open && !buzzer && (
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
