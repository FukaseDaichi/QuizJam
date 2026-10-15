import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateConfig } from "../lib/config.mjs";
import { runMondai, runVoices, runBuild } from "../lib/commands.mjs";
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

const SET = `# サンプル

## Q01
- 答え: A
- 読み: いち<short pause>です

## Q02
- 答え: B
- 読み: に<short pause>です
- style: 速め

## Q03
- 答え: C
- 読み: さん
`;

function writeSet(root, name, text) {
  fs.mkdirSync(path.join(root, "voice", "sets"), { recursive: true });
  fs.writeFileSync(path.join(root, "voice", "sets", `${name}.md`), text);
}

test("runBuild: 全問生成して manifest に書く。問ごとの style が優先される", async () => {
  const { ctx, calls, root } = makeCtx({ seconds: 3 });
  writeSet(root, "s", SET);
  const r = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r.generated, ["Q01", "Q02", "Q03"]);
  assert.deepEqual(r.failed, []);
  assert.equal(calls.find((c) => c.text === "に<short pause>です").style, "速め");
  assert.equal(calls.find((c) => c.text === "さん").style, ctx.config.style);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "voice", "out", "s", "manifest.json"), "utf8"));
  assert.equal(manifest.set, "s");
  assert.deepEqual(Object.keys(manifest.entries).sort(), ["Q01", "Q02", "Q03"]);
  assert.equal(manifest.entries.Q01.durationMs, 3000);
  assert.equal(manifest.entries.Q01.voice, "Kore");
  assert.equal(manifest.entries.Q01.generatedAt, "2026-10-15T00:00:00.000Z");
  assert.ok(fs.existsSync(path.join(root, "voice", "out", "s", "Q01.wav")));
});

test("runBuild: 2 回目は変更なし。読みを変えた問だけ再生成。--force で全部", async () => {
  const { ctx, calls, root } = makeCtx();
  writeSet(root, "s", SET);
  await runBuild(ctx, { setName: "s" });
  const r2 = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r2.skipped, ["Q01", "Q02", "Q03"]);
  assert.equal(calls.length, 3);
  writeSet(root, "s", SET.replace("- 読み: さん", "- 読み: さんばん"));
  const r3 = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r3.generated, ["Q03"]);
  assert.equal(calls.length, 4);
  const r4 = await runBuild(ctx, { setName: "s", force: true });
  assert.equal(r4.generated.length, 3);
  assert.equal(calls.length, 7);
});

test("runBuild: WAV が消えていれば manifest が一致しても再生成する", async () => {
  const { ctx, calls, root } = makeCtx();
  writeSet(root, "s", SET);
  await runBuild(ctx, { setName: "s" });
  fs.unlinkSync(path.join(root, "voice", "out", "s", "Q02.wav"));
  const r = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r.generated, ["Q02"]);
  assert.equal(calls.length, 4);
});

test("runBuild: --only で絞る。無い ID はエラーで何も生成しない", async () => {
  const { ctx, calls, root } = makeCtx();
  writeSet(root, "s", SET);
  const r = await runBuild(ctx, { setName: "s", only: ["Q02"] });
  assert.deepEqual(r.generated, ["Q02"]);
  assert.equal(calls.length, 1);
  await assert.rejects(runBuild(ctx, { setName: "s", only: ["Q99"] }), /Q99/);
  assert.equal(calls.length, 1);
});

test("runBuild: 一部失敗しても続行し、失敗した問は manifest に書かない", async () => {
  const { ctx, root } = makeCtx({
    synthesize: async (params) => {
      if (params.text.startsWith("に")) throw new Error("Gemini API エラー 429: slow down");
      return makeWav({ seconds: 2 });
    },
  });
  writeSet(root, "s", SET);
  const r = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r.generated, ["Q01", "Q03"]);
  assert.deepEqual(r.failed.map((f) => f.id), ["Q02"]);
  assert.match(r.failed[0].error, /429/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "voice", "out", "s", "manifest.json"), "utf8"));
  assert.equal("Q02" in manifest.entries, false);
});

test("runBuild: WAV でない応答は失敗扱いで、ファイルも manifest も残さない", async () => {
  const { ctx, root } = makeCtx({ synthesize: async () => Buffer.from("not wav") });
  writeSet(root, "s", "## Q01\n- 読み: いち\n");
  const r = await runBuild(ctx, { setName: "s" });
  assert.deepEqual(r.failed.map((f) => f.id), ["Q01"]);
  assert.equal(fs.existsSync(path.join(root, "voice", "out", "s", "Q01.wav")), false);
  assert.equal(fs.existsSync(path.join(root, "voice", "out", "s", "manifest.json")), false);
});

test("runBuild: 短すぎ・長すぎは警告に入る", async () => {
  const { ctx, root } = makeCtx({ seconds: 0.5 });
  writeSet(root, "s", "## Q01\n- 読み: いち\n");
  const r = await runBuild(ctx, { setName: "s" });
  assert.ok(r.warnings.some((w) => /Q01/.test(w) && /短すぎ/.test(w)));
});

test("runBuild: 台本が無い・セット名が無いとき CommandError", async () => {
  const { ctx } = makeCtx();
  await assert.rejects(runBuild(ctx, { setName: "nope" }), /台本がありません/);
  await assert.rejects(runBuild(ctx, {}), /セット名/);
});

test("runBuild: 台本の警告をログに出す", async () => {
  const { ctx, logs, root } = makeCtx();
  writeSet(root, "s", "## Q01\n- 読み: 『いち』\n");
  await runBuild(ctx, { setName: "s" });
  assert.ok(logs.some((l) => /警告: Q01:.*『』/.test(l)));
});
