import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreviewAss, previewArgs, PREVIEW_CHARS_PER_LINE } from "../lib/preview.mjs";

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
