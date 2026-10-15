import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, extractAudio, synthesize, GeminiError } from "../lib/gemini.mjs";

const okJson = (wavBase64) =>
  JSON.stringify({ steps: [{ type: "model_output", content: [{ type: "audio", data: wavBase64 }] }] });

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

test("buildRequest: interactions の形で組み立てる", () => {
  const body = buildRequest({ model: "gemini-3.8-flash-tts", voice: "Kore", style: "ゆっくり", text: "問題！" });
  assert.deepEqual(body, {
    model: "gemini-3.8-flash-tts",
    input: [{ type: "user_input", content: [{ type: "text", text: "問題！", annotations: [{ type: "speech_metadata", style: "ゆっくり" }] }] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice: "Kore" }] },
  });
});

test("buildRequest: style が空なら annotations を付けない", () => {
  const body = buildRequest({ model: "m", voice: "Kore", style: "", text: "t" });
  assert.equal("annotations" in body.input[0].content[0], false);
});

test("extractAudio: model_output の最後の audio を base64 デコードする", () => {
  const json = { steps: [
    { type: "thought", content: [] },
    { type: "model_output", content: [{ type: "audio", data: Buffer.from("first").toString("base64") }, { type: "audio", data: Buffer.from("last").toString("base64") }] },
  ] };
  assert.equal(extractAudio(json).toString(), "last");
});

test("extractAudio: audio が無ければ GeminiError", () => {
  assert.throws(() => extractAudio({ steps: [{ type: "model_output", content: [{ type: "text", text: "x" }] }] }), GeminiError);
  assert.throws(() => extractAudio({}), GeminiError);
});

test("synthesize: ヘッダと本文を送り、音声を返す", async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: okJson(Buffer.from("RIFF").toString("base64")) }]);
  const out = await synthesize({ model: "m", voice: "Kore", style: "s", text: "t" }, { apiKey: "KEY", fetchImpl: impl });
  assert.equal(out.toString(), "RIFF");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["x-goog-api-key"], "KEY");
  assert.equal(JSON.parse(calls[0].init.body).model, "m");
});

test("synthesize: 429 の再試行は 2s/4s/8s で 3 回、その後 GeminiError", async () => {
  const { impl, calls } = fakeFetch([
    { status: 429, body: "slow down" }, { status: 429, body: "slow down" },
    { status: 429, body: "slow down" }, { status: 429, body: "slow down" },
  ]);
  const waits = [];
  await assert.rejects(
    synthesize({ model: "m", voice: "v", style: "", text: "t" }, { apiKey: "k", fetchImpl: impl, sleep: async (ms) => waits.push(ms) }),
    (err) => err instanceof GeminiError && err.status === 429,
  );
  assert.equal(calls.length, 4);
  assert.deepEqual(waits, [2000, 4000, 8000]);
});

test("synthesize: 5xx は再試行して成功すれば返す", async () => {
  const { impl } = fakeFetch([{ status: 503, body: "busy" }, { status: 200, body: okJson(Buffer.from("ok").toString("base64")) }]);
  const out = await synthesize({ model: "m", voice: "v", style: "", text: "t" }, { apiKey: "k", fetchImpl: impl, sleep: async () => {} });
  assert.equal(out.toString(), "ok");
});

test("synthesize: 400 は再試行せず GeminiError", async () => {
  const { impl, calls } = fakeFetch([{ status: 400, body: '{"error":"bad voice"}' }]);
  await assert.rejects(
    synthesize({ model: "m", voice: "v", style: "", text: "t" }, { apiKey: "k", fetchImpl: impl, sleep: async () => {} }),
    (err) => err instanceof GeminiError && err.status === 400 && /bad voice/.test(err.message),
  );
  assert.equal(calls.length, 1);
});
