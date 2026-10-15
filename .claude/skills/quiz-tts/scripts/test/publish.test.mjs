import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateConfig } from "../lib/config.mjs";
import { runPublish, formatQuestionSet } from "../lib/publish.mjs";
import { CommandError } from "../lib/commands.mjs";
import { tmpDir } from "./helpers.mjs";

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const SET = {
  name: "映画", mode: "buzzer", settings: {},
  questions: [
    { id: "Q01", type: "anagram", prompt: "あいう", answers: ["え"] },
    { id: "Q02", type: "anagram", prompt: "かき", answers: ["く", "け"] },
  ],
};

/** 問題セット・timing.json・mp3 を置いた作業場所と、アップロードを記録する fetch */
function setup({ status = 201 } = {}) {
  const root = tmpDir();
  const dir = path.join(root, "voice", "out", "movie");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, "question-sets"), { recursive: true });
  const setFile = path.join(root, "question-sets", "movie.json");
  fs.writeFileSync(setFile, formatQuestionSet(SET));
  const mp3 = { Q01: Buffer.from("mp3 one"), Q02: Buffer.from("mp3 two") };
  for (const [id, b] of Object.entries(mp3)) fs.writeFileSync(path.join(dir, `${id}.full.mp3`), b);
  const timing = {
    version: 1, set: "movie",
    entries: {
      Q01: { prompt: "あいう", mp3Sha256: sha(mp3.Q01), revealAtMs: [2000, 2300, 2600] },
      Q02: { prompt: "かき", mp3Sha256: sha(mp3.Q02), revealAtMs: [2100, 2400] },
    },
  };
  fs.writeFileSync(path.join(dir, "timing.json"), JSON.stringify(timing));
  const uploads = [];
  const logs = [];
  const ctx = {
    root, config: validateConfig({}), log: (s) => logs.push(s),
    fetch: async (url, init) => {
      uploads.push({ url, init });
      const key = `${sha(Buffer.from(init.body))}.mp3`;
      return new Response(JSON.stringify({ key, url: `/api/audio/${key}` }), { status });
    },
  };
  return { ctx, uploads, logs, root, dir, setFile, mp3 };
}
const target = { baseUrl: "https://quizjam.example.workers.dev", passphrase: "pass" };

test("runPublish: mp3 を /api/audio に上げ、各問に audio（url と revealAtMs）を書き込む", async () => {
  const { ctx, uploads, setFile, mp3 } = setup();
  const r = await runPublish(ctx, { setName: "movie", ...target });
  assert.deepEqual(r.published, ["Q01", "Q02"]);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].url, "https://quizjam.example.workers.dev/api/audio");
  assert.equal(uploads[0].init.method, "POST");
  assert.equal(uploads[0].init.headers.Authorization, "Bearer pass");
  assert.equal(uploads[0].init.headers["Content-Type"], "audio/mpeg");
  assert.deepEqual(Buffer.from(uploads[0].init.body), mp3.Q01);
  const set = JSON.parse(fs.readFileSync(setFile, "utf8"));
  assert.deepEqual(set.questions[0].audio, { url: `/api/audio/${sha(mp3.Q01)}.mp3`, revealAtMs: [2000, 2300, 2600] });
  assert.deepEqual(set.questions[1].audio.revealAtMs, [2100, 2400]);
  assert.equal(set.name, "映画");
});

test("formatQuestionSet: 1 問 1 行で書く", () => {
  const text = formatQuestionSet(SET);
  assert.equal(text, [
    "{",
    '  "name": "映画",',
    '  "mode": "buzzer",',
    '  "settings": {},',
    '  "questions": [',
    '    { "id": "Q01", "type": "anagram", "prompt": "あいう", "answers": ["え"] },',
    '    { "id": "Q02", "type": "anagram", "prompt": "かき", "answers": ["く", "け"] }',
    "  ]",
    "}",
    "",
  ].join("\n"));
  assert.deepEqual(JSON.parse(text), SET);
});

test("runPublish: timing.json が古い・無い問があれば何も上げずに止まる", async () => {
  const { ctx, uploads, dir, setFile } = setup();
  const before = fs.readFileSync(setFile, "utf8");
  fs.writeFileSync(path.join(dir, "Q02.full.mp3"), Buffer.from("changed"));
  const r = await runPublish(ctx, { setName: "movie", ...target });
  assert.deepEqual(r.stale, ["Q02"]);
  assert.equal(uploads.length, 0);
  assert.equal(fs.readFileSync(setFile, "utf8"), before);
});

test("runPublish: 問題文が timing.json と違う問も古いとみなす", async () => {
  const { ctx, uploads, setFile } = setup();
  fs.writeFileSync(setFile, formatQuestionSet({ ...SET, questions: [{ ...SET.questions[0], prompt: "あいえ" }, SET.questions[1]] }));
  const r = await runPublish(ctx, { setName: "movie", ...target });
  assert.deepEqual(r.stale, ["Q01"]);
  assert.equal(uploads.length, 0);
});

test("runPublish: アップロードに失敗した問があれば問題セットを書き戻さない", async () => {
  const { ctx, setFile } = setup({ status: 401 });
  const before = fs.readFileSync(setFile, "utf8");
  const r = await runPublish(ctx, { setName: "movie", ...target });
  assert.deepEqual(r.failed.map((f) => f.id), ["Q01", "Q02"]);
  assert.match(r.failed[0].error, /401/);
  assert.equal(fs.readFileSync(setFile, "utf8"), before);

  const s2 = setup();
  s2.ctx.fetch = async () => { throw new Error("network down"); };
  const r2 = await runPublish(s2.ctx, { setName: "movie", ...target });
  assert.match(r2.failed[0].error, /network down/);
});

test("runPublish: セット名か問題セットが無ければ CommandError", async () => {
  const { ctx, setFile } = setup();
  await assert.rejects(runPublish(ctx, { ...target }), CommandError);
  fs.rmSync(setFile);
  await assert.rejects(runPublish(ctx, { setName: "movie", ...target }), /question-sets\/movie\.json/);
});

test("runPublish: 早押しモードでない問題セットは CommandError（取り込むと音声が落ちる）", async () => {
  const { ctx, uploads, setFile } = setup();
  fs.writeFileSync(setFile, formatQuestionSet({ ...SET, mode: undefined }));
  await assert.rejects(runPublish(ctx, { setName: "movie", ...target }), /buzzer/);
  assert.equal(uploads.length, 0);
});

test("runPublish: 応答の url が無いか、上げた mp3 の SHA-256 と合わなければ失敗にする", async () => {
  const { ctx, setFile } = setup();
  const before = fs.readFileSync(setFile, "utf8");
  ctx.fetch = async () => new Response(JSON.stringify({ key: "x.mp3", url: "/api/audio/x.mp3" }), { status: 200 });
  const r = await runPublish(ctx, { setName: "movie", ...target });
  assert.deepEqual(r.failed.map((f) => f.id), ["Q01", "Q02"]);
  assert.match(r.failed[0].error, /url/);
  ctx.fetch = async () => new Response("{}", { status: 201 });
  const r2 = await runPublish(ctx, { setName: "movie", ...target });
  assert.equal(r2.failed.length, 2);
  assert.equal(fs.readFileSync(setFile, "utf8"), before);
});
