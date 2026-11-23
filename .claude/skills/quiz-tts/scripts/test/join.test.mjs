import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ffmpegAvailable, ffmpegArgs, joinQuestion, needsJoin } from "../lib/join.mjs";
import { spawnSync } from "node:child_process";
import { tmpDir, makeWav } from "./helpers.mjs";

const fmt = (i) => `[${i}:a]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono[a${i}]`;

test("ffmpegArgs: 3 入力を concat して mp3 にする", () => {
  const args = ffmpegArgs({ mondaiWav: "m.wav", questionWav: "q.wav", pauseMs: 600, outMp3: "o.mp3" });
  assert.deepEqual(args, [
    "-y", "-loglevel", "error",
    "-i", "m.wav",
    "-f", "lavfi", "-t", "0.600", "-i", "anullsrc=r=24000:cl=mono",
    "-i", "q.wav",
    "-filter_complex", `${fmt(0)};${fmt(1)};${fmt(2)};[a0][a1][a2]concat=n=3:v=0:a=1[out]`,
    "-map", "[out]", "-codec:a", "libmp3lame", "-q:a", "4",
    "o.mp3",
  ]);
});

test("ffmpegArgs: cueWav があれば「問題！」の直後に入れて 4 入力を concat する", () => {
  const args = ffmpegArgs({ mondaiWav: "m.wav", cueWav: "c.wav", questionWav: "q.wav", pauseMs: 600, outMp3: "o.mp3" });
  assert.deepEqual(args.slice(3, 15), ["-i", "m.wav", "-i", "c.wav", "-f", "lavfi", "-t", "0.600", "-i", "anullsrc=r=24000:cl=mono", "-i", "q.wav"]);
  assert.equal(args[16], `${fmt(0)};${fmt(1)};${fmt(2)};${fmt(3)};[a0][a1][a2][a3]concat=n=4:v=0:a=1[out]`);
});

test("joinQuestion: 形式の違う効果音（44.1kHz ステレオ）も結合でき、長さは 問題！＋効果音＋間＋問題文", { skip: !ffmpegAvailable() }, () => {
  const dir = tmpDir();
  const m = path.join(dir, "m.wav");
  const c = path.join(dir, "c.wav");
  const q = path.join(dir, "q.wav");
  const out = path.join(dir, "o.mp3");
  fs.writeFileSync(m, makeWav({ seconds: 1 }));
  fs.writeFileSync(q, makeWav({ seconds: 2 }));
  const gen = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-t", "0.5", "-i", "sine=f=880:r=44100", "-ac", "2", c]);
  assert.equal(gen.status, 0);
  joinQuestion({ mondaiWav: m, cueWav: c, questionWav: q, pauseMs: 600, outMp3: out });
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" });
  assert.ok(Math.abs(Number(probe.stdout) - 4.1) < 0.15, probe.stdout);
});

test("needsJoin: mp3 が無いか入力より古いときだけ true", () => {
  const dir = tmpDir();
  const a = path.join(dir, "a.wav");
  const b = path.join(dir, "b.wav");
  const out = path.join(dir, "o.mp3");
  fs.writeFileSync(a, "x");
  fs.writeFileSync(b, "x");
  assert.equal(needsJoin(out, [a, b]), true);
  fs.writeFileSync(out, "x");
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(a, past, past);
  fs.utimesSync(b, past, past);
  assert.equal(needsJoin(out, [a, b]), false);
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(b, future, future);
  assert.equal(needsJoin(out, [a, b]), true);
});

test("joinQuestion: ffmpeg で実際に結合できる", { skip: !ffmpegAvailable() && "ffmpeg が無い" }, () => {
  const dir = tmpDir();
  const m = path.join(dir, "m.wav");
  const q = path.join(dir, "q.wav");
  const out = path.join(dir, "o.mp3");
  fs.writeFileSync(m, makeWav({ seconds: 0.5 }));
  fs.writeFileSync(q, makeWav({ seconds: 1 }));
  joinQuestion({ mondaiWav: m, questionWav: q, pauseMs: 600, outMp3: out });
  assert.ok(fs.statSync(out).size > 1000);
});

test("joinQuestion: 入力が無ければ投げる", { skip: !ffmpegAvailable() && "ffmpeg が無い" }, () => {
  const dir = tmpDir();
  assert.throws(
    () => joinQuestion({ mondaiWav: path.join(dir, "none.wav"), questionWav: path.join(dir, "none2.wav"), pauseMs: 600, outMp3: path.join(dir, "o.mp3") }),
    /ffmpeg/,
  );
});

test("ffmpegAvailable・joinQuestion: 渡された ffmpeg を使う", () => {
  const missing = path.join(tmpDir(), "no-ffmpeg");
  assert.equal(ffmpegAvailable(missing), false);
  assert.throws(() => joinQuestion({ mondaiWav: "m.wav", questionWav: "q.wav", pauseMs: 600, outMp3: "o.mp3" }, missing), /ffmpeg を実行できません/);
});
