export function remainingSeconds(deadlineAt: number | null, clockOffsetMs: number, nowMs = Date.now()): number | null {
  if (deadlineAt === null) return null;
  const serverNow = nowMs + clockOffsetMs;
  return Math.max(0, Math.ceil((deadlineAt - serverNow) / 1000));
}
