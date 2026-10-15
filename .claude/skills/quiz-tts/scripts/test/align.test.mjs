import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateConfig } from "../lib/config.mjs";
import { runAlign } from "../lib/align.mjs";
import { CommandError } from "../lib/commands.mjs";
import { tmpDir, makeWav } from "./helpers.mjs";

const SCRIPT = `# 映画

## Q01
- 答え: 君の名は。
- 問題文: 瀧と山
- 読み: タキと、<short pause>山

## Q02
- 問題文: 1955年
- 読み: 1955年
`;
const SET = { name: "映画", mode: "buzzer", questions: [{ id: "Q01", prompt: "瀧と山", answers: ["x"] }, { id: "Q02", prompt: "1955年", answers: ["y"] }] };
// Q01 の Whisper の単語（無音 [0, 0.3] の明けにタキが寄る）
const WORDS = {
  Q01: [{ w: "タキ", s: 0.4, e: 0.8 }, { w: "と、", s: 0.8, e: 1.0 }, { w: "山", s: 1.6, e: 1.9 }],
  Q02: [{ w: "せんきゅうひゃくごじゅうご", s: 0.3, e: 1.6 }, { w: "年", s: 1.6, e: 1.9 }],
};

/** mondai.wav（1.4 秒）・台本・問題セット・各問の wav と mp3 を置いた作業場所と ctx */
function setup({ script = SCRIPT, set = SET, words = WORDS, uv = true } = {}) {
  const root = tmpDir();
  const config = validateConfig({});
  const out = path.join(root, "voice", "out");
  fs.mkdirSync(path.join(out, "movie"), { recursive: true });
  fs.writeFileSync(path.join(out, "mondai.wav"), makeWav({ seconds: 1.4 }));
  fs.mkdirSync(path.join(root, "voice", "sets"), { recursive: true });
  fs.writeFileSync(path.join(root, "voice", "sets", "movie.md"), script);
  fs.mkdirSync(path.join(root, "question-sets"), { recursive: true });
  fs.writeFileSync(path.join(root, "question-sets", "movie.json"), JSON.stringify(set));
  for (const id of ["Q01", "Q02"]) {
    fs.writeFileSync(path.join(out, "movie", `${id}.wav`), makeWav({ seconds: 2 }));
    fs.writeFileSync(path.join(out, "movie", `${id}.full.mp3`), Buffer.from(`mp3 ${id}`));
  }
  const calls = [];
  const logs = [];
  const ctx = {
    root, config,
    log: (s) => logs.push(s),
    ffmpegAvailable: () => true,
    uvAvailable: () => uv,
    alignWords: async (jobs) => { calls.push(jobs); return Object.fromEntries(jobs.map((j) => [j.id, words[j.id] ?? { error: "boom" }])); },
    detectSilences: () => [[0, 0.3], [1.0, 1.5]],
  };
  const timingFile = path.join(out, "movie", "timing.json");
  const readTiming = () => JSON.parse(fs.readFileSync(timingFile, "utf8"));
  return { ctx, calls, logs, root, out, timingFile, readTiming };
}

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

test("runAlign: 各問の表示時刻を mp3 の頭（問題！＋間）からの ms で timing.json に書く", async () => {
  const { ctx, calls, readTiming } = setup();
  const r = await runAlign(ctx, { setName: "movie" });
  assert.deepEqual(r.aligned, ["Q01", "Q02"]);
  const t = readTiming();
  assert.equal(t.version, 1);
  assert.equal(t.set, "movie");
  // offset = 1400 + pauseMs 600
  assert.deepEqual(t.entries.Q01, { prompt: "瀧と山", mp3Sha256: sha(Buffer.from("mp3 Q01")), revealAtMs: [2300, 2800, 3500] });
  assert.equal(t.entries.Q02.revealAtMs.length, 5);
  // 読みはタグを外し、数字をかなにして渡す
  assert.deepEqual(calls[0].map((j) => j.text), ["タキと、山", "せんきゅうひゃくごじゅうご年"]);
  assert.match(calls[0][0].wav, /Q01\.wav$/);
});

test("runAlign: 問題文と mp3 が同じなら飛ばし、--force でやり直す", async () => {
  const { ctx, calls } = setup();
  await runAlign(ctx, { setName: "movie" });
  const again = await runAlign(ctx, { setName: "movie" });
  assert.deepEqual(again.skipped, ["Q01", "Q02"]);
  assert.equal(calls.length, 1);
  const forced = await runAlign(ctx, { setName: "movie", force: true });
  assert.deepEqual(forced.aligned, ["Q01", "Q02"]);
  assert.equal(calls.length, 2);
});

test("runAlign: mp3 か問題セットの問題文が変わった問だけやり直す", async () => {
  const { ctx, calls, root, out, readTiming } = setup();
  await runAlign(ctx, { setName: "movie" });
  fs.writeFileSync(path.join(out, "movie", "Q02.full.mp3"), Buffer.from("new mp3"));
  const r = await runAlign(ctx, { setName: "movie" });
  assert.deepEqual(r.aligned, ["Q02"]);
  assert.deepEqual(calls[1].map((j) => j.id), ["Q02"]);
  fs.writeFileSync(path.join(root, "question-sets", "movie.json"), JSON.stringify({ ...SET, questions: [{ ...SET.questions[0], prompt: "滝と山" }, SET.questions[1]] }));
  const r2 = await runAlign(ctx, { setName: "movie" });
  assert.deepEqual(r2.aligned, ["Q01"]);
  assert.equal(readTiming().entries.Q01.prompt, "滝と山");
});

test("runAlign: 台本の問題文が問題セットと違えば警告し、問題セットの prompt を使う", async () => {
  const { ctx, readTiming } = setup({ script: SCRIPT.replace("- 問題文: 瀧と山", "- 問題文: 滝と山") });
  const r = await runAlign(ctx, { setName: "movie" });
  assert.ok(r.warnings.some((w) => /Q01: .*問題セット/.test(w)));
  assert.equal(readTiming().entries.Q01.prompt, "瀧と山");
});

test("runAlign: 問題セットに無い問・wav か mp3 の無い問・Whisper が失敗した問は失敗にして、ほかは書く", async () => {
  const { ctx, out, readTiming } = setup({ set: { ...SET, questions: [SET.questions[1]] } });
  const r = await runAlign(ctx, { setName: "movie" });
  assert.deepEqual(r.failed.map((f) => f.id), ["Q01"]);
  assert.match(r.failed[0].error, /問題セット/);
  assert.deepEqual(Object.keys(readTiming().entries), ["Q02"]);

  const s2 = setup({ words: { Q01: WORDS.Q01 } });
  fs.rmSync(path.join(s2.out, "movie", "Q01.full.mp3"));
  const r2 = await runAlign(s2.ctx, { setName: "movie" });
  assert.deepEqual(r2.failed.map((f) => f.id), ["Q01", "Q02"]);
  assert.match(r2.failed[0].error, /join/);
  assert.match(r2.failed[1].error, /boom/);
  void out;
});

test("runAlign: 読みの数字をかなに直せなければ警告する", async () => {
  const { ctx } = setup({ script: SCRIPT.replace("- 読み: 1955年", "- 読み: 12345年") });
  const r = await runAlign(ctx, { setName: "movie", only: ["Q02"] });
  assert.ok(r.warnings.some((w) => /Q02: .*12345/.test(w)));
});

test("runAlign: やり直す問があるのに uv が無ければ何もせず noUv を返す", async () => {
  const { ctx, calls, timingFile } = setup({ uv: false });
  const r = await runAlign(ctx, { setName: "movie" });
  assert.equal(r.noUv, true);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(timingFile), false);
});

test("runAlign: 台本から消えた問は timing.json から外す（--only のときは触らない）", async () => {
  const { ctx, root, readTiming } = setup();
  await runAlign(ctx, { setName: "movie" });
  fs.writeFileSync(path.join(root, "voice", "sets", "movie.md"), SCRIPT.split("## Q02")[0]);
  await runAlign(ctx, { setName: "movie", only: ["Q01"] });
  assert.deepEqual(Object.keys(readTiming().entries), ["Q01", "Q02"]);
  await runAlign(ctx, { setName: "movie" });
  assert.deepEqual(Object.keys(readTiming().entries), ["Q01"]);
});

test("runAlign: セット名・問題セット・mondai.wav・ffmpeg が無ければ CommandError", async () => {
  const { ctx, root, out } = setup();
  await assert.rejects(runAlign(ctx, {}), CommandError);
  await assert.rejects(runAlign({ ...ctx, ffmpegAvailable: () => false }, { setName: "movie" }), /ffmpeg/);
  fs.rmSync(path.join(root, "question-sets", "movie.json"));
  await assert.rejects(runAlign(ctx, { setName: "movie" }), /question-sets\/movie\.json/);
  fs.rmSync(path.join(out, "mondai.wav"));
  await assert.rejects(runAlign(ctx, { setName: "movie" }), /mondai/);
});

test("runAlign: 1 問の無音検出が失敗してもその問だけ失敗にし、ほかの問は書く", async () => {
  const { ctx, readTiming } = setup();
  ctx.detectSilences = (wav) => { if (/Q01/.test(wav)) throw new Error("ffmpeg broke"); return []; };
  const r = await runAlign(ctx, { setName: "movie" });
  assert.deepEqual(r.failed.map((f) => f.id), ["Q01"]);
  assert.match(r.failed[0].error, /ffmpeg broke/);
  assert.deepEqual(Object.keys(readTiming().entries), ["Q02"]);
});

test("runAlign: Whisper が単語を 1 つも返さなかった問は失敗にする", async () => {
  const { ctx, readTiming } = setup({ words: { Q01: [], Q02: WORDS.Q02 } });
  const r = await runAlign(ctx, { setName: "movie" });
  assert.deepEqual(r.failed.map((f) => f.id), ["Q01"]);
  assert.deepEqual(Object.keys(readTiming().entries), ["Q02"]);
});

test("runAlign: 壊れた timing.json は CommandError", async () => {
  const { ctx, timingFile } = setup();
  fs.writeFileSync(timingFile, "{ broken");
  await assert.rejects(runAlign(ctx, { setName: "movie" }), CommandError);
});

test("runAlign: WAV か mondai.wav が mp3 より新しい（join していない）問は失敗にして、時刻を作らない", async () => {
  const { ctx, calls, out, readTiming } = setup();
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(out, "movie", "Q01.wav"), future, future);
  const r = await runAlign(ctx, { setName: "movie" });
  assert.deepEqual(r.failed.map((f) => f.id), ["Q01"]);
  assert.match(r.failed[0].error, /join/);
  assert.deepEqual(calls[0].map((j) => j.id), ["Q02"]);
  assert.deepEqual(Object.keys(readTiming().entries), ["Q02"]);
});
