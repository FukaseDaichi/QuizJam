export class GeminiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** 単一話者 TTS のリクエスト本文。text は逐語で読まれる。style は短い定型文 */
export function buildRequest({ model, voice, style, text }) {
  const content = { type: "text", text };
  if (style) content.annotations = [{ type: "speech_metadata", style }];
  return {
    model,
    input: [{ type: "user_input", content: [content] }],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice }] },
  };
}

/** steps[].type === "model_output" の最後の audio content の data（base64）を Buffer にする */
export function extractAudio(json) {
  const steps = Array.isArray(json?.steps) ? json.steps : [];
  for (const step of [...steps].reverse()) {
    if (step?.type !== "model_output") continue;
    const audios = (step.content ?? []).filter((c) => c?.type === "audio" && typeof c.data === "string");
    if (audios.length > 0) return Buffer.from(audios[audios.length - 1].data, "base64");
  }
  throw new GeminiError(`応答に audio がありません: ${JSON.stringify(json).slice(0, 500)}`);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 429 / 5xx は 2s・4s・8s 待って maxRetries 回まで再試行。それ以外の失敗は即 GeminiError */
export async function synthesize(
  params,
  { apiKey, fetchImpl = globalThis.fetch, sleep = defaultSleep, maxRetries = 3, endpoint = ENDPOINT },
) {
  const body = JSON.stringify(buildRequest(params));
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body,
    });
    if (res.ok) return extractAudio(await res.json());
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= maxRetries) {
      throw new GeminiError(`Gemini API エラー ${res.status}: ${text.slice(0, 500)}`, { status: res.status, body: text });
    }
    await sleep(2000 * 2 ** attempt);
  }
}
