import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG, defaultPreviewFont, validateConfig, loadConfig, ConfigError } from "../lib/config.mjs";
import { tmpDir } from "./helpers.mjs";

test("validateConfig: 空なら既定値", () => {
  assert.deepEqual(validateConfig({}), DEFAULT_CONFIG);
});

test("validateConfig: 指定した値で上書きする", () => {
  const c = validateConfig({ voice: "Zephyr", pauseMs: 300, concurrency: 1 });
  assert.equal(c.voice, "Zephyr");
  assert.equal(c.pauseMs, 300);
  assert.equal(c.concurrency, 1);
  assert.equal(c.model, DEFAULT_CONFIG.model);
});

test("validateConfig: 不正な値は ConfigError", () => {
  assert.throws(() => validateConfig({ voice: "" }), ConfigError);
  assert.throws(() => validateConfig({ pauseMs: -1 }), ConfigError);
  assert.throws(() => validateConfig({ pauseMs: 1.5 }), ConfigError);
  assert.throws(() => validateConfig({ concurrency: 0 }), ConfigError);
  assert.throws(() => validateConfig({ concurrency: 5 }), ConfigError);
  assert.throws(() => validateConfig({ candidates: ["Kore", ""] }), ConfigError);
  assert.throws(() => validateConfig({ unknownKey: 1 }), ConfigError);
});

test("loadConfig: voice/config.json が無ければ既定値", () => {
  assert.deepEqual(loadConfig(tmpDir()), DEFAULT_CONFIG);
});

test("loadConfig: voice/config.json を読む", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "voice"));
  fs.writeFileSync(path.join(dir, "voice", "config.json"), JSON.stringify({ voice: "Charon" }));
  assert.equal(loadConfig(dir).voice, "Charon");
});

test("loadConfig: 壊れた JSON は ConfigError", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "voice"));
  fs.writeFileSync(path.join(dir, "voice", "config.json"), "{ not json");
  assert.throws(() => loadConfig(dir), ConfigError);
});

test("validateConfig: questionSetsDir は既定で question-sets、空文字はエラー", () => {
  assert.equal(validateConfig({}).questionSetsDir, "question-sets");
  assert.throws(() => validateConfig({ questionSetsDir: "" }), ConfigError);
});

test("defaultPreviewFont: OS に入っている日本語フォントを選ぶ", () => {
  assert.equal(defaultPreviewFont("darwin"), "Hiragino Sans");
  assert.equal(defaultPreviewFont("win32"), "Meiryo");
  assert.equal(defaultPreviewFont("linux"), "Noto Sans CJK JP");
});

test("validateConfig: previewFont は既定でこの OS のフォント、空文字はエラー", () => {
  assert.equal(validateConfig({}).previewFont, defaultPreviewFont(process.platform));
  assert.throws(() => validateConfig({ previewFont: "" }), ConfigError);
});
