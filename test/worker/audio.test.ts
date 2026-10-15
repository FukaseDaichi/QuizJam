import { describe, it, expect } from "vitest";
import { exports } from "cloudflare:workers";

const BASE = "http://localhost";
const AUTH = { Authorization: "Bearer test-pass" };
const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 1, 2, 3]);

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function upload(body: BodyInit, headers: Record<string, string> = { "Content-Type": "audio/mpeg", ...AUTH }) {
  return exports.default.fetch(`${BASE}/api/audio`, { method: "POST", headers, body });
}

describe("audio API (R2)", () => {
  it("rejects uploads without the passphrase", async () => {
    expect((await upload(mp3, { "Content-Type": "audio/mpeg" })).status).toBe(401);
  });

  it("rejects other content types, empty bodies and bodies over 2 MB", async () => {
    expect((await upload("hello", { "Content-Type": "text/plain", ...AUTH })).status).toBe(415);
    expect((await upload(new Uint8Array(0))).status).toBe(400);
    expect((await upload(new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(413);
  });

  it("stores an mp3 under its SHA-256 and serves it back with long-lived caching", async () => {
    const up = await upload(mp3);
    expect(up.status).toBe(201);
    const { key, url } = (await up.json()) as { key: string; url: string };
    expect(key).toBe(`${await sha256Hex(mp3)}.mp3`);
    expect(url).toBe(`/api/audio/${key}`);

    const get = await exports.default.fetch(`${BASE}${url}`);
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(get.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(mp3);
  });

  it("returns the same key for the same mp3 without storing it again", async () => {
    const body = new Uint8Array([...mp3, 9]);
    const first = (await (await upload(body)).json()) as { key: string };
    const again = await upload(body);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { key: string }).key).toBe(first.key);
  });

  it("returns 404 for unknown keys and keys that are not an mp3 hash", async () => {
    expect((await exports.default.fetch(`${BASE}/api/audio/${"0".repeat(64)}.mp3`)).status).toBe(404);
    expect((await exports.default.fetch(`${BASE}/api/audio/abc.png`)).status).toBe(404);
    expect((await exports.default.fetch(`${BASE}/api/audio/..%2Fetc`)).status).toBe(404);
  });

  it("keeps question audio on a buzzer question set", async () => {
    const audio = { url: "/api/audio/abc.mp3", revealAtMs: [2000, 2300, 2300] };
    const res = await exports.default.fetch(`${BASE}/api/question-sets`, {
      method: "POST", headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "音声つき", mode: "buzzer", questions: [{ prompt: "あいう", answers: ["え"], audio }] }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { questions: { audio?: unknown }[] }).questions[0].audio).toEqual(audio);
  });
});
