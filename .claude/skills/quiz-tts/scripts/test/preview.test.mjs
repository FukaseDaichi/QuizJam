import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildPreviewAss, previewArgs, renderPreview, runPreview, PREVIEW_CHARS_PER_LINE } from "../lib/preview.mjs";
import { validateConfig } from "../lib/config.mjs";
import { CommandError } from "../lib/commands.mjs";
import { ffmpegAvailable } from "../lib/join.mjs";
import { tmpDir, makeWav } from "./helpers.mjs";

/** 問題文の行（Style K）の {\kNN}文字 を [NN, 文字] の並びにする */
function syllables(ass) {
  const line = ass.split("\n").find((l) => l.startsWith("Dialogue:") && l.includes(",K,"));
  return [...line.matchAll(/\{\\k(\d+)\}([^{]*)/g)].map((m) => [Number(m[1]), m[2]]);
}

test("buildPreviewAss: 先頭は 1 文字目までの空の区間で、各文字の頭までの \\k の合計がその文字の表示時刻（センチ秒）", () => {
  const ass = buildPreviewAss({ title: "Q06", prompt: "あいう", revealAtMs: [2000, 2340, 2345], font: "Meiryo" });
  const s = syllables(ass);
  assert.deepEqual(s.map(([, c]) => c), ["", "あ", "い", "う"]);
  const starts = [];
  let sum = 0;
  for (const [k, c] of s) { if (c) starts.push(sum); sum += k; }
  assert.deepEqual(starts, [200, 234, 235]);
  assert.ok(s[3][0] > 0, "最後の文字にも長さがある");
});

test("buildPreviewAss: 同じ時刻に出る文字は \\k0 でつなぐ", () => {
  const s = syllables(buildPreviewAss({ title: "Q13", prompt: "「Iア", revealAtMs: [2324, 2324, 2324], font: "Meiryo" }));
  assert.deepEqual(s.map(([k]) => k), [232, 0, 0, s[3][0]]);
});

test("buildPreviewAss: 決まった文字数ごとに改行し、最後には付けない", () => {
  const prompt = "あ".repeat(PREVIEW_CHARS_PER_LINE + 4);
  const ass = buildPreviewAss({ title: "Q01", prompt, revealAtMs: Array.from(prompt, (_, i) => 2000 + i * 100), font: "Meiryo" });
  const line = ass.split("\n").find((l) => l.includes(",K,"));
  assert.equal(line.split("\\N").length, 2);
  assert.ok(!line.endsWith("\\N"));
});

test("buildPreviewAss: 字幕の制御文字（{ } \\）は全角にして、そのまま見せる", () => {
  const s = syllables(buildPreviewAss({ title: "Q{1}", prompt: "a{b}\\", revealAtMs: [0, 0, 0, 0, 0], font: "Meiryo" }));
  assert.deepEqual(s.map(([, c]) => c).join(""), "a｛b｝＼");
});

test("buildPreviewAss: フォント名を両方のスタイルに入れ、見出しに問題 ID を出す", () => {
  const ass = buildPreviewAss({ title: "Q06", prompt: "あ", revealAtMs: [2000], font: "Hiragino Sans" });
  assert.equal(ass.split("\n").filter((l) => l.startsWith("Style:") && l.includes(",Hiragino Sans,")).length, 2);
  assert.ok(ass.split("\n").some((l) => l.includes(",L,") && l.endsWith("Q06")));
});

test("previewArgs: 単色の背景に字幕を焼き込み、mp3 を付けて音声の長さで切る", () => {
  assert.deepEqual(previewArgs({ mp3: "C:/x/Q06.full.mp3", ass: "Q06.ass", out: "Q06.mp4" }), [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x0f172a:s=1280x720:r=30",
    "-i", "C:/x/Q06.full.mp3",
    "-vf", "subtitles=Q06.ass",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    "Q06.mp4",
  ]);
});

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const SET = {
  name: "映画", mode: "buzzer", settings: {},
  questions: [
    { id: "Q01", type: "anagram", prompt: "あいう", answers: ["え"] },
    { id: "Q02", type: "anagram", prompt: "かき", answers: ["く"] },
  ],
};

/** 問題セット・timing.json・mp3 を置いた作業場所と、ffmpeg の呼び出しを記録する ctx */
function setup({ config = {} } = {}) {
  const root = tmpDir();
  const dir = path.join(root, "voice", "out", "movie");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, "question-sets"), { recursive: true });
  fs.writeFileSync(path.join(root, "question-sets", "movie.json"), JSON.stringify(SET));
  const mp3 = { Q01: Buffer.from("mp3 one"), Q02: Buffer.from("mp3 two") };
  for (const [id, b] of Object.entries(mp3)) fs.writeFileSync(path.join(dir, `${id}.full.mp3`), b);
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify({
    version: 1, set: "movie",
    entries: {
      Q01: { prompt: "あいう", mp3Sha256: sha(mp3.Q01), revealAtMs: [2000, 2300, 2600] },
      Q02: { prompt: "かき", mp3Sha256: sha(mp3.Q02), revealAtMs: [2100, 2400] },
    },
  }));
  const renders = [];
  const logs = [];
  const ctx = {
    root, config: validateConfig(config), log: (s) => logs.push(s),
    ffmpegAvailable: () => true,
    renderPreview: (opts) => { renders.push(opts); },
  };
  return { ctx, renders, logs, root, dir };
}

test("runPreview: 各問の字幕を preview/ に書き、mp3 と重ねて Qnn.mp4 を作る", async () => {
  const { ctx, renders, dir } = setup();
  const r = await runPreview(ctx, { setName: "movie" });
  assert.deepEqual(r.rendered, ["Q01", "Q02"]);
  const previewDir = path.join(dir, "preview");
  assert.deepEqual(renders[0], { dir: previewDir, mp3: path.join(dir, "Q01.full.mp3"), ass: "Q01.ass", out: "Q01.mp4" });
  const ass = fs.readFileSync(path.join(previewDir, "Q01.ass"), "utf8");
  assert.ok(ass.includes("{\\k200}{\\k30}あ{\\k30}い"));
  assert.match(ass, /,Meiryo,/);
});

test("runPreview: config の previewFont を使う", async () => {
  const { ctx, dir } = setup({ config: { previewFont: "Hiragino Sans" } });
  await runPreview(ctx, { setName: "movie", only: ["Q02"] });
  assert.match(fs.readFileSync(path.join(dir, "preview", "Q02.ass"), "utf8"), /,Hiragino Sans,/);
});

test("runPreview: timing.json が古い・無い問は作らずに挙げる", async () => {
  const { ctx, renders, root, dir } = setup();
  fs.writeFileSync(path.join(dir, "Q02.full.mp3"), Buffer.from("changed"));
  const r = await runPreview(ctx, { setName: "movie" });
  assert.deepEqual(r.rendered, ["Q01"]);
  assert.deepEqual(r.stale, ["Q02"]);
  assert.equal(renders.length, 1);
  fs.writeFileSync(path.join(root, "question-sets", "movie.json"), JSON.stringify({ ...SET, questions: [{ ...SET.questions[0], prompt: "あいえ" }] }));
  assert.deepEqual((await runPreview(ctx, { setName: "movie" })).stale, ["Q01"]);
});

test("runPreview: --only で絞り、問題セットに無い ID は CommandError", async () => {
  const { ctx, renders } = setup();
  const r = await runPreview(ctx, { setName: "movie", only: ["Q02"] });
  assert.deepEqual(r.rendered, ["Q02"]);
  assert.equal(renders.length, 1);
  await assert.rejects(runPreview(ctx, { setName: "movie", only: ["Q09"] }), CommandError);
});

test("runPreview: ffmpeg が失敗した問は失敗にして、ほかの問は作る", async () => {
  const { ctx } = setup();
  ctx.renderPreview = ({ ass }) => { if (ass === "Q01.ass") throw new Error("libass が無い"); };
  const r = await runPreview(ctx, { setName: "movie" });
  assert.deepEqual(r.rendered, ["Q02"]);
  assert.deepEqual(r.failed, [{ id: "Q01", error: "libass が無い" }]);
});

test("runPreview: セット名・ffmpeg・問題セットが無ければ CommandError", async () => {
  const { ctx, root } = setup();
  await assert.rejects(runPreview(ctx, {}), /セット名を指定してください: preview/);
  await assert.rejects(runPreview({ ...ctx, ffmpegAvailable: () => false }, { setName: "movie" }), /ffmpeg/);
  fs.rmSync(path.join(root, "question-sets", "movie.json"));
  await assert.rejects(runPreview(ctx, { setName: "movie" }), /question-sets\/movie\.json/);
});

test("renderPreview: ffmpeg で実際に字幕入りの mp4 ができる", { skip: !ffmpegAvailable() && "ffmpeg が無い" }, () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "q.wav"), makeWav({ seconds: 1 }));
  fs.writeFileSync(path.join(dir, "q.ass"), buildPreviewAss({ title: "Q01", prompt: "あいう", revealAtMs: [100, 300, 500], font: "Meiryo" }));
  renderPreview({ dir, mp3: path.join(dir, "q.wav"), ass: "q.ass", out: "q.mp4" });
  assert.ok(fs.statSync(path.join(dir, "q.mp4")).size > 0);
});
