/** 判定用スマホの QR を今出すべきか。expiresAt はサーバー時刻なので clockOffsetMs（サーバー − 手元）で手元の時計に合わせる */
export function pairingMsLeft(expiresAt: number, clockOffsetMs: number, nowMs = Date.now()): number {
  return expiresAt - (nowMs + clockOffsetMs);
}

export function shouldShowJudgePairing(
  pairing: { expiresAt: number } | null,
  dismissedExpiresAt: number | null,
  clockOffsetMs: number,
  nowMs = Date.now(),
): boolean {
  if (!pairing) return false;
  if (dismissedExpiresAt === pairing.expiresAt) return false;
  return pairingMsLeft(pairing.expiresAt, clockOffsetMs, nowMs) > 0;
}
