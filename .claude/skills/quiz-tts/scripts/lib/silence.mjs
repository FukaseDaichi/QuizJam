import { spawnSync } from "node:child_process";
import { parseSilences } from "./timing.mjs";

/** −40 dB 未満が 0.1 秒以上続く所を無音とする */
export function silenceArgs(file) {
  return ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=noise=-40dB:d=0.1", "-f", "null", "-"];
}

/** ffmpeg silencedetect で音声ファイルの無音区間 [始まり, 明け]（秒）を取る */
export function detectSilences(file, ffmpeg = "ffmpeg") {
  const r = spawnSync(ffmpeg, silenceArgs(file), { encoding: "utf8" });
  if (r.error) throw new Error(`ffmpeg を実行できません: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg が失敗しました: ${(r.stderr || "").trim().slice(-500)}`);
  return parseSilences(r.stderr);
}
