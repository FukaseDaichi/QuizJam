import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, X } from "lucide-react";
import { pairingMsLeft, shouldShowJudgePairing } from "../lib/judgePairing";

/**
 * 判定用スマホをつなぐ QR。この QR が使われる（judgeStatus の paired で reducer が judgePairing を消す）か、
 * 期限が切れるか、手で閉じるまで出す。再接続の state では judgePairing が消えないので、期限は自分で見る。
 */
export function JudgePairingModal({ pairing, clockOffsetMs }: {
  pairing: { url: string; expiresAt: number } | null;
  clockOffsetMs: number;
}) {
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [, tick] = useState(0);
  const expiresAt = pairing?.expiresAt ?? null;

  // 期限が来たら描き直して閉じる
  useEffect(() => {
    if (expiresAt === null) return;
    const left = pairingMsLeft(expiresAt, clockOffsetMs);
    if (left <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [expiresAt, clockOffsetMs]);

  const visible = shouldShowJudgePairing(pairing, dismissed, clockOffsetMs);
  const close = () => { if (expiresAt !== null) setDismissed(expiresAt); };
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, expiresAt]);

  if (!visible || !pairing) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6" onClick={close} role="presentation">
      <div
        role="dialog" aria-modal="true" aria-labelledby="judge-pairing-title"
        className="qj-pop flex max-w-md flex-col items-center gap-4 rounded-3xl border border-slate-700 bg-slate-800 p-8 text-slate-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-full items-center justify-between">
          <h2 id="judge-pairing-title" className="inline-flex items-center gap-2 text-2xl font-black"><Smartphone size={24} aria-hidden />判定用スマホをつなぐ</h2>
          <button type="button" onClick={close} aria-label="閉じる" className="rounded-xl p-2 hover:bg-slate-700"><X size={24} aria-hidden /></button>
        </div>
        <div className="rounded-2xl bg-white p-4"><QRCodeSVG value={location.origin + pairing.url} size={280} /></div>
        <p className="text-center text-sm text-slate-300">
          GM のスマホでこの QR を読み取ってください。5 分間・1 回だけ使えます。映っている画面は参加者にも見えるので、読み取ったらすぐ閉じてください。
        </p>
      </div>
    </div>
  );
}
