import { useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Minus, Plus, Settings, UserMinus, UserPlus, Users, X } from "lucide-react";
import { Button } from "../components/Button";
import type { ClientMessage, SettingsView } from "../../shared/messages";
import type { LiveSettings, Participant } from "../../shared/types";

/**
 * GM がゲーム中でも開ける管理パネル。
 * 設定の上書き（次の問題から反映）、参加者のスコア調整・キック、途中参加用の QR を扱う。
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
  const current = { ...settings.effective, ...settings.override };
  const [timerSeconds, setTimerSeconds] = useState(String(current.timerSeconds ?? ""));
  const [unlimited, setUnlimited] = useState(current.maxAttempts === null);
  const [maxAttempts, setMaxAttempts] = useState(current.maxAttempts == null ? "" : String(current.maxAttempts));
  const [wrongPenalty, setWrongPenalty] = useState(String(current.wrongPenalty ?? ""));
  const [applied, setApplied] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const patch: Partial<LiveSettings> = {};
    const sec = Number(timerSeconds);
    if (timerSeconds !== "" && Number.isInteger(sec) && sec > 0) patch.timerSeconds = sec;
    if (unlimited) patch.maxAttempts = null;
    else {
      const n = Number(maxAttempts);
      if (maxAttempts !== "" && Number.isInteger(n) && n > 0) patch.maxAttempts = n;
    }
    const pen = Number(wrongPenalty);
    if (wrongPenalty !== "" && Number.isInteger(pen) && pen >= 0) patch.wrongPenalty = pen;
    if (Object.keys(patch).length === 0) return;
    send({ type: "updateSettings", settings: patch });
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };

  return (
    <form onSubmit={submit}>
      <h3 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide opacity-70"><Settings size={16} aria-hidden />設定</h3>
      <label className="block text-sm text-slate-400" htmlFor="live-timer">制限時間（秒）</label>
      <input id="live-timer" type="number" min={1} step={1} inputMode="numeric" value={timerSeconds} onChange={(e) => setTimerSeconds(e.target.value)} className={inputClass} placeholder="セットの設定" />
      <label className="mt-4 block text-sm text-slate-400" htmlFor="live-attempts">お手付き上限（回）</label>
      <input id="live-attempts" type="number" min={1} step={1} inputMode="numeric" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} disabled={unlimited} className={inputClass} placeholder="セットの設定" />
      <label className="mt-2 flex items-center gap-2 text-slate-300">
        <input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} className="h-5 w-5" />無制限
      </label>
      <label className="mt-4 block text-sm text-slate-400" htmlFor="live-penalty">不正解ペナルティ（点）</label>
      <input id="live-penalty" type="number" min={0} step={1} inputMode="numeric" value={wrongPenalty} onChange={(e) => setWrongPenalty(e.target.value)} className={inputClass} placeholder="セットの設定" />
      <Button type="submit" variant="primary" className="mt-5 w-full">適用する</Button>
      <p className="mt-2 text-sm text-slate-400" aria-live="polite">{applied ? "適用しました。次の問題から反映されます" : "次の問題から反映されます"}</p>
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
