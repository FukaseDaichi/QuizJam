import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpDir } from "./helpers.mjs";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "tts.mjs");
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
const runWithFfmpeg = (ffmpeg, ...args) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, FFMPEG_PATH: ffmpeg } });

test("CLI: 不明なオプションは 1 行のエラーと使い方を出して終了コード 2", () => {
  const r = run("mondai", "--bogus");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /エラー: /);
  assert.match(r.stderr, /使い方:/);
  assert.doesNotMatch(r.stderr, /at .*node:internal/);
});

test("CLI: コマンド無しは使い方を出して終了コード 2", () => {
  const r = run();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /使い方:/);
});

test("CLI: align はセット名が無ければエラーで終了コード 1", () => {
  const r = run("align");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /セット名を指定してください: align/);
});

test("CLI: publish はセット名が無ければエラーで終了コード 1", () => {
  const r = run("publish");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /セット名を指定してください: publish/);
});

test("CLI: preview はセット名が無ければエラーで終了コード 1", () => {
  const r = run("preview");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /セット名を指定してください: preview/);
});

test("CLI: preview は FFMPEG_PATH の ffmpeg を使い、動かなければエラーで終了コード 1", () => {
  const r = runWithFfmpeg(path.join(tmpDir(), "no-ffmpeg"), "preview", "no-such-set");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /エラー: ffmpeg が見つかりません/);
});

test("CLI: preview は ffmpeg に subtitles フィルタが無ければ、ffmpeg のエラーではなく入れ方を出して終了コード 1", { skip: process.platform === "win32" && "sh のスクリプトを ffmpeg の代わりにする" }, () => {
  const ffmpeg = path.join(tmpDir(), "ffmpeg");
  fs.writeFileSync(ffmpeg, '#!/bin/sh\necho " .. scale             V->V       Scale the input video size."\n', { mode: 0o755 });
  const r = runWithFfmpeg(ffmpeg, "preview", "no-such-set");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /エラー: .*subtitles フィルタがありません/);
  assert.match(r.stderr, /brew install ffmpeg-full/);
  assert.doesNotMatch(r.stderr, /Error parsing/);
});
