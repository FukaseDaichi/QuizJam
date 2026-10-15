import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateConfig } from "../lib/config.mjs";
import { runMondai, runVoices } from "../lib/commands.mjs";
import { tmpDir, makeWav } from "./helpers.mjs";

/** テスト用の ctx。synthesize は呼び出しを記録し、seconds 秒の WAV を返す */
export function makeCtx({ seconds = 2, synthesize, config = {} } = {}) {
  const root = tmpDir();
  const calls = [];
  const logs = [];
  const ctx = {
    root,
    config: validateConfig(config),
    log: (s) => logs.push(s),
    now: () => new Date("2026-10-15T00:00:00.000Z"),
    synthesize: synthesize ?? (async (params) => { calls.push(params); return makeWav({ seconds }); }),
    ffmpegAvailable: () => true,
    joinQuestion: () => {},
  };
  return { ctx, calls, logs, root };
}

test("runMondai: 無ければ config の文と声で生成する", async () => {
  const { ctx, calls, root } = makeCtx({ seconds: 1.2 });
  const r = await runMondai(ctx, {});
  assert.equal(r.generated, true);
  assert.equal(r.durationMs, 1200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "問題！");
  assert.equal(calls[0].voice, "Kore");
  assert.equal(calls[0].style, ctx.config.style);
  assert.ok(fs.existsSync(path.join(root, "voice", "out", "mondai.wav")));
});

test("runMondai: 既にあれば生成しない。--force なら作り直す", async () => {
  const { ctx, calls } = makeCtx();
  await runMondai(ctx, {});
  const r = await runMondai(ctx, {});
  assert.equal(r.generated, false);
  assert.equal(calls.length, 1);
  await runMondai(ctx, { force: true });
  assert.equal(calls.length, 2);
});

test("runMondai: WAV でない応答は投げてファイルを残さない", async () => {
  const { ctx, root } = makeCtx({ synthesize: async () => Buffer.from("<html>") });
  await assert.rejects(runMondai(ctx, {}), /WAV/);
  assert.equal(fs.existsSync(path.join(root, "voice", "out", "mondai.wav")), false);
});

test("runVoices: 候補ごとに同じ文で生成し、失敗した声は記録して続ける", async () => {
  const { ctx, calls, root } = makeCtx({
    config: { candidates: ["Kore", "Zephyr", "Charon"] },
    synthesize: async (params) => {
      calls.push(params);
      if (params.voice === "Zephyr") throw new Error("boom");
      return makeWav({ seconds: 1 });
    },
  });
  const results = await runVoices(ctx, { text: "聴き比べ" });
  assert.deepEqual(results.map((r) => [r.voice, r.ok]), [["Kore", true], ["Zephyr", false], ["Charon", true]]);
  assert.ok(calls.every((c) => c.text === "聴き比べ"));
  assert.ok(fs.existsSync(path.join(root, "voice", "out", "voices", "Kore.wav")));
  assert.equal(fs.existsSync(path.join(root, "voice", "out", "voices", "Zephyr.wav")), false);
});

test("runVoices: --text が無ければ config.sampleText", async () => {
  const { ctx, calls } = makeCtx({ config: { candidates: ["Kore"] } });
  await runVoices(ctx, {});
  assert.equal(calls[0].text, ctx.config.sampleText);
});
