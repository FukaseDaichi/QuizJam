import fs from "node:fs";
import { spawnSync } from "node:child_process";

export function ffmpegAvailable(ffmpeg = "ffmpeg") {
  return spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
}

/** 問題！ → 無音 pauseMs → 問題文 を concat して mp3 にする ffmpeg の引数 */
export function ffmpegArgs({ mondaiWav, questionWav, pauseMs, outMp3, sampleRate = 24000 }) {
  return [
    "-y", "-loglevel", "error",
    "-i", mondaiWav,
    "-f", "lavfi", "-t", (pauseMs / 1000).toFixed(3), "-i", `anullsrc=r=${sampleRate}:cl=mono`,
    "-i", questionWav,
    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
    "-map", "[out]", "-codec:a", "libmp3lame", "-q:a", "4",
    outMp3,
  ];
}

export function joinQuestion(opts, ffmpeg = "ffmpeg") {
  const r = spawnSync(ffmpeg, ffmpegArgs(opts), { encoding: "utf8" });
  if (r.error) throw new Error(`ffmpeg を実行できません: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`ffmpeg が失敗しました: ${(r.stderr || "").trim().slice(0, 500)}`);
}

/** 出力が無いか、入力のどれかが出力より新しければ結合し直す */
export function needsJoin(outMp3, inputs) {
  if (!fs.existsSync(outMp3)) return true;
  const outTime = fs.statSync(outMp3).mtimeMs;
  return inputs.some((f) => fs.statSync(f).mtimeMs > outTime);
}
