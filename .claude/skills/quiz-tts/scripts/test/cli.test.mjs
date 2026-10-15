import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "tts.mjs");
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

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
