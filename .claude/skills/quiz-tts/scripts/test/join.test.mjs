import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ffmpegAvailable, ffmpegArgs, joinQuestion, needsJoin } from "../lib/join.mjs";
import { tmpDir, makeWav } from "./helpers.mjs";

test("ffmpegArgs: 3 入力を concat して mp3 にする", () => {
  const args = ffmpegArgs({ mondaiWav: "m.wav", questionWav: "q.wav", pauseMs: 600, outMp3: "o.mp3" });
  assert.deepEqual(args, [
    "-y", "-loglevel", "error",
    "-i", "m.wav",
    "-f", "lavfi", "-t", "0.600", "-i", "anullsrc=r=24000:cl=mono",
    "-i", "q.wav",
    "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
    "-map", "[out]", "-codec:a", "libmp3lame", "-q:a", "4",
    "o.mp3",
  ]);
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
