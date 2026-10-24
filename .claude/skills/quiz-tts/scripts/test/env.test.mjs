import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseDotenv, loadEnv, requireApiKey, requirePublishEnv, ffmpegCommand, EnvError } from "../lib/env.mjs";
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

test("requirePublishEnv: QUIZJAM_URL（末尾の / は外す）と ADMIN_PASSPHRASE を読む", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, ".env"), "QUIZJAM_URL=https://quizjam.example.workers.dev/\nADMIN_PASSPHRASE=pass\n");
  delete process.env.QUIZJAM_URL;
  delete process.env.ADMIN_PASSPHRASE;
  assert.deepEqual(requirePublishEnv(dir), { baseUrl: "https://quizjam.example.workers.dev", passphrase: "pass" });
});

test("requirePublishEnv: どちらかが無ければ EnvError", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, ".env"), "QUIZJAM_URL=https://quizjam.example.workers.dev\n");
  delete process.env.ADMIN_PASSPHRASE;
  assert.throws(() => requirePublishEnv(dir), (err) => err instanceof EnvError && /ADMIN_PASSPHRASE/.test(err.message));
});

test("ffmpegCommand: 環境変数 → .env の FFMPEG_PATH、どちらも無ければ PATH の ffmpeg", () => {
  const dir = tmpDir();
  delete process.env.FFMPEG_PATH;
  assert.equal(ffmpegCommand(dir), "ffmpeg");
  fs.writeFileSync(path.join(dir, ".env"), "FFMPEG_PATH=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg\n");
  assert.equal(ffmpegCommand(dir), "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg");
  process.env.FFMPEG_PATH = "C:/ffmpeg/bin/ffmpeg.exe";
  try {
    assert.equal(ffmpegCommand(dir), "C:/ffmpeg/bin/ffmpeg.exe");
  } finally {
    delete process.env.FFMPEG_PATH;
  }
});
