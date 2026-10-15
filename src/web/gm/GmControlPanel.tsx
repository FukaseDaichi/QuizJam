import { useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Minus, Plus, Settings, UserMinus, UserPlus, Users, X } from "lucide-react";
import { Button } from "../components/Button";
import type { ClientMessage, SettingsView } from "../../shared/messages";
import type { LiveSettings, Participant, TimerMode } from "../../shared/types";
import { TIMER_MODE_LABELS } from "../lib/labels";

/**
 * GM がゲーム中でも開ける管理パネル。
 * 設定の上書き（今の問題にも即時反映）、参加者のスコア調整・キック、途中参加用の QR を扱う。
 */
export function GmControlPanel({ open, onClose, settings, participants, joinUrl, send }: {
  open: boolean;
  onClose: () => void;
  settings: SettingsView;
  participants: Participant[];
  joinUrl: string;
  send: (msg: ClientMessage) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose} role="presentation">
      <div
        role="dialog" aria-modal="true" aria-labelledby="gm-panel-title"
        className="qj-pop grid max-h-full w-full max-w-5xl grid-cols-[1fr_1fr_auto] gap-6 overflow-y-auto rounded-3xl border border-slate-700 bg-slate-800 p-6 text-slate-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="col-span-3 flex items-center justify-between">
          <h2 id="gm-panel-title" className="inline-flex items-center gap-2 text-2xl font-black"><Settings size={24} aria-hidden />管理</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-xl p-2 hover:bg-slate-700"><X size={24} aria-hidden /></button>
        </div>
        <SettingsForm settings={settings} send={send} />
        <ParticipantList participants={participants} send={send} />
        <section>
          <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide opacity-70"><UserPlus size={16} aria-hidden />参加者を追加</h3>
          <div className="rounded-2xl bg-white p-3"><QRCodeSVG value={joinUrl} size={160} /></div>
          <p className="mt-2 w-[184px] break-all text-xs text-slate-400">{joinUrl}</p>
        </section>
      </div>
    </div>
  );
}

const inputClass = "mt-1 h-12 w-full rounded-xl bg-slate-700 px-3 text-lg tabular-nums disabled:opacity-40";

function SettingsForm({ settings, send }: { settings: SettingsView; send: (msg: ClientMessage) => void }) {
  const { override: o, effective: eff } = settings;
  // 入力欄はライブ設定（上書き）を表し、空欄はセットの設定を使う。placeholder に実際に効く値を出す
  const [timerMode, setTimerMode] = useState<TimerMode | "">(o.timerMode ?? "");
  const [timerSeconds, setTimerSeconds] = useState(o.timerSeconds == null ? "" : String(o.timerSeconds));
  const [unlimited, setUnlimited] = useState(o.maxAttempts === null);
  const [maxAttempts, setMaxAttempts] = useState(o.maxAttempts == null ? "" : String(o.maxAttempts));
  const [basePoints, setBasePoints] = useState(o.basePoints == null ? "" : String(o.basePoints));
  const [wrongPenalty, setWrongPenalty] = useState(o.wrongPenalty == null ? "" : String(o.wrongPenalty));
  const [rankBonus, setRankBonus] = useState(o.rankBonus == null ? "" : o.rankBonus.join(","));
  const [charsPerSecond, setCharsPerSecond] = useState(o.charsPerSecond == null ? "" : String(o.charsPerSecond));
  const [applied, setApplied] = useState(false);
  // 早押しでは制限時間・お手付き上限・正解順ボーナスが効かないので欄を出さない
  const buzzer = settings.mode === "buzzer";

  const effectiveMode = timerMode || eff?.timerMode;
  const ph = (v: number | null | undefined) => (eff ? (v === null ? "無制限" : String(v)) : "セットの設定");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<LiveSettings> = {};
    if (timerMode) next.timerMode = timerMode;
    const sec = Number(timerSeconds);
    if (timerSeconds !== "" && Number.isInteger(sec) && sec > 0) next.timerSeconds = sec;
    if (unlimited) next.maxAttempts = null;
    else {
      const n = Number(maxAttempts);
      if (maxAttempts !== "" && Number.isInteger(n) && n > 0) next.maxAttempts = n;
    }
    const base = Number(basePoints);
    if (basePoints !== "" && Number.isInteger(base) && base >= 0) next.basePoints = base;
    const pen = Number(wrongPenalty);
    if (wrongPenalty !== "" && Number.isInteger(pen) && pen >= 0) next.wrongPenalty = pen;
    if (rankBonus.trim() !== "") {
      const bonus = rankBonus.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
      if (bonus.every((n) => Number.isInteger(n) && n >= 0)) next.rankBonus = bonus;
    }
    const cps = Number(charsPerSecond);
    if (charsPerSecond !== "" && Number.isInteger(cps) && cps >= 1 && cps <= 30) next.charsPerSecond = cps;
    send({ type: "updateSettings", settings: next });
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };

  const clearAll = () => {
    setTimerMode(""); setTimerSeconds(""); setUnlimited(false); setMaxAttempts(""); setBasePoints(""); setWrongPenalty(""); setRankBonus(""); setCharsPerSecond("");
    send({ type: "updateSettings", settings: {} });
  };

  return (
    <form onSubmit={submit}>
      <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide opacity-70"><Settings size={16} aria-hidden />設定</h3>
      {!buzzer && (
        <>
          <label className="block text-sm text-slate-400" htmlFor="live-timer-mode">制限時間</label>
          <select id="live-timer-mode" value={timerMode} onChange={(e) => setTimerMode(e.target.value as TimerMode | "")} className={inputClass}>
            <option value="">セットの設定{eff ? `（${TIMER_MODE_LABELS[eff.timerMode]}）` : ""}</option>
            {(Object.keys(TIMER_MODE_LABELS) as TimerMode[]).map((m) => <option key={m} value={m}>{TIMER_MODE_LABELS[m]}</option>)}
          </select>
        </>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3">
        {!buzzer && (
          <div>
            <label className="block text-sm text-slate-400" htmlFor="live-timer">秒数</label>
            <input id="live-timer" type="number" min={1} step={1} inputMode="numeric" value={timerSeconds} onChange={(e) => setTimerSeconds(e.target.value)}
              disabled={effectiveMode === "none"} className={inputClass} placeholder={ph(eff?.timerSeconds)} />
          </div>
        )}
        {!buzzer && (
          <div>
            <label className="block text-sm text-slate-400" htmlFor="live-attempts">お手付き上限（回）</label>
            <input id="live-attempts" type="number" min={1} step={1} inputMode="numeric" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} disabled={unlimited} className={inputClass} placeholder={ph(eff?.maxAttempts)} />
            <label className="mt-1 flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} className="h-5 w-5" />無制限
            </label>
          </div>
        )}
        {buzzer && (
          <div>
            <label className="block text-sm text-slate-400" htmlFor="live-cps">読み上げ速度（文字/秒）</label>
            <input id="live-cps" type="number" min={1} max={30} step={1} inputMode="numeric" value={charsPerSecond} onChange={(e) => setCharsPerSecond(e.target.value)} className={inputClass} placeholder={ph(eff?.charsPerSecond)} />
          </div>
        )}
        <div>
          <label className="block text-sm text-slate-400" htmlFor="live-base">基本点</label>
          <input id="live-base" type="number" min={0} step={1} inputMode="numeric" value={basePoints} onChange={(e) => setBasePoints(e.target.value)} className={inputClass} placeholder={ph(eff?.basePoints)} />
        </div>
        <div>
          <label className="block text-sm text-slate-400" htmlFor="live-penalty">不正解ペナルティ（点）</label>
          <input id="live-penalty" type="number" min={0} step={1} inputMode="numeric" value={wrongPenalty} onChange={(e) => setWrongPenalty(e.target.value)} className={inputClass} placeholder={ph(eff?.wrongPenalty)} />
        </div>
      </div>
      {!buzzer && (
        <>
          <label className="mt-3 block text-sm text-slate-400" htmlFor="live-bonus">正解順ボーナス <span className="text-xs">1位から順にカンマ区切り</span></label>
          <input id="live-bonus" inputMode="numeric" value={rankBonus} onChange={(e) => setRankBonus(e.target.value)} className={inputClass} placeholder={eff ? eff.rankBonus.join(",") || "なし" : "セットの設定"} />
        </>
      )}
      <Button type="submit" variant="primary" className="mt-5 w-full">適用する</Button>
      <p className="mt-2 text-sm text-slate-400" aria-live="polite">
        {applied ? "適用しました。" : ""}空欄はセットの設定を使います。{buzzer ? "読み上げ速度は今の問題にもすぐ反映されます（音声付きの問題には効きません）" : "今の問題にもすぐ反映され、制限時間は締切が無ければ今から数えます"}
      </p>
      {Object.keys(o).length > 0 && (
        <button type="button" onClick={clearAll} className="mt-2 text-xs font-bold text-slate-400 underline hover:text-slate-200">上書きをすべて解除</button>
      )}
    </form>
  );
}

function ParticipantList({ participants, send }: { participants: Participant[]; send: (msg: ClientMessage) => void }) {
  const [step, setStep] = useState("100");
  const delta = Math.abs(Math.trunc(Number(step))) || 0;
  const kick = (p: Participant) => {
    if (confirm(`${p.nickname} をルームから退出させますか？\nスコアも削除されます。`)) send({ type: "kick", participantId: p.id });
  };
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide opacity-70"><Users size={16} aria-hidden />参加者</h3>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          増減する点数
          <input type="number" min={1} step={1} inputMode="numeric" value={step} onChange={(e) => setStep(e.target.value)} aria-label="増減する点数" className="h-9 w-20 rounded-lg bg-slate-700 px-2 text-right tabular-nums text-slate-100" />
        </label>
      </div>
      <ul className="space-y-2">
        {participants.map((p) => (
          <li key={p.id} className={`flex items-center gap-2 rounded-xl bg-slate-700/60 px-3 py-2 ${p.connected ? "" : "opacity-50"}`}>
            <span className="min-w-0 flex-1 truncate text-lg">{p.nickname}{!p.connected && <span className="text-sm text-slate-400">（切断）</span>}</span>
            <span className="w-20 text-right text-lg font-bold tabular-nums">{p.score}点</span>
            <button type="button" aria-label={`${p.nickname} に${delta}点加算`} disabled={delta === 0} onClick={() => send({ type: "adjustScore", participantId: p.id, delta })} className="rounded-lg bg-green-600 p-2 hover:bg-green-500 disabled:opacity-40"><Plus size={18} aria-hidden /></button>
            <button type="button" aria-label={`${p.nickname} から${delta}点減算`} disabled={delta === 0} onClick={() => send({ type: "adjustScore", participantId: p.id, delta: -delta })} className="rounded-lg bg-orange-600 p-2 hover:bg-orange-500 disabled:opacity-40"><Minus size={18} aria-hidden /></button>
            <button type="button" aria-label={`${p.nickname} をキック`} onClick={() => kick(p)} className="ml-1 rounded-lg bg-red-600 p-2 hover:bg-red-500"><UserMinus size={18} aria-hidden /></button>
          </li>
        ))}
        {participants.length === 0 && <li className="text-slate-400">まだ参加者がいません</li>}
      </ul>
    </section>
  );
}
