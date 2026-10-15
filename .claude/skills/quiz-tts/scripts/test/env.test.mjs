import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseDotenv, loadEnv, requireApiKey, EnvError } from "../lib/env.mjs";
import { tmpDir } from "./helpers.mjs";

test("parseDotenv: コメント・空行・引用符を扱う", () => {
  const env = parseDotenv('# comment\n\nGEMINI_API_KEY="abc"\nOTHER=\'x y\'\nBARE=plain\n');
  assert.deepEqual(env, { GEMINI_API_KEY: "abc", OTHER: "x y", BARE: "plain" });
});

test("loadEnv: .env が無ければ空", () => {
  assert.deepEqual(loadEnv(tmpDir()), {});
});

test("requireApiKey: .env から読む", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, ".env"), "GEMINI_API_KEY=k123\n");
  delete process.env.GEMINI_API_KEY;
  assert.equal(requireApiKey(dir), "k123");
});

test("requireApiKey: 環境変数を優先する", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, ".env"), "GEMINI_API_KEY=file\n");
  process.env.GEMINI_API_KEY = "envvar";
  try {
    assert.equal(requireApiKey(dir), "envvar");
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test("requireApiKey: 無ければ EnvError で .env の作り方を案内する", () => {
  delete process.env.GEMINI_API_KEY;
  assert.throws(() => requireApiKey(tmpDir()), (err) => err instanceof EnvError && /\.env/.test(err.message));
});
