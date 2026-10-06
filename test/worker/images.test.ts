import { describe, it, expect } from "vitest";
import { exports } from "cloudflare:workers";

const BASE = "http://localhost";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe("image API (R2)", () => {
  it("rejects uploads without the passphrase", async () => {
    const res = await exports.default.fetch(`${BASE}/api/images`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    expect(res.status).toBe(401);
  });

  it("rejects unsupported content types and empty bodies", async () => {
    const txt = await exports.default.fetch(`${BASE}/api/images`, {
      method: "POST", headers: { "Content-Type": "text/plain", Authorization: "Bearer test-pass" }, body: "hello",
    });
    expect(txt.status).toBe(415);
    const empty = await exports.default.fetch(`${BASE}/api/images`, {
      method: "POST", headers: { "Content-Type": "image/png", Authorization: "Bearer test-pass" }, body: new Uint8Array(0),
    });
    expect(empty.status).toBe(400);
  });

  it("stores an image and serves it back with long-lived caching", async () => {
    const up = await exports.default.fetch(`${BASE}/api/images`, {
      method: "POST", headers: { "Content-Type": "image/png", Authorization: "Bearer test-pass" }, body: png,
    });
    expect(up.status).toBe(201);
    const { key, url } = (await up.json()) as { key: string; url: string };
    expect(key).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(url).toBe(`/api/images/${key}`);

    const get = await exports.default.fetch(`${BASE}${url}`);
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("image/png");
    expect(get.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(png);

    const del = await exports.default.fetch(`${BASE}${url}`, { method: "DELETE", headers: { Authorization: "Bearer test-pass" } });
    expect(del.status).toBe(204);
    expect((await exports.default.fetch(`${BASE}${url}`)).status).toBe(404);
  });

  it("returns 404 for unknown or malformed keys", async () => {
    expect((await exports.default.fetch(`${BASE}/api/images/nope.png`)).status).toBe(404);
    expect((await exports.default.fetch(`${BASE}/api/images/..%2Fetc`)).status).toBe(404);
  });

  it("accepts image URLs on question sets and rejects foreign ones", async () => {
    const headers = { Authorization: "Bearer test-pass", "Content-Type": "application/json" };
    const ok = await exports.default.fetch(`${BASE}/api/question-sets`, {
      method: "POST", headers,
      body: JSON.stringify({
        name: "画像つき", coverImageUrl: "/api/images/abc.png",
        questions: [{ prompt: "ごんり", answers: ["りんご"], imageUrl: "/api/images/def.jpg" }],
      }),
    });
    expect(ok.status).toBe(201);
    const created = (await ok.json()) as { id: string; coverImageUrl: string; questions: { imageUrl: string }[] };
    expect(created.coverImageUrl).toBe("/api/images/abc.png");
    expect(created.questions[0].imageUrl).toBe("/api/images/def.jpg");

    const list = (await (await exports.default.fetch(`${BASE}/api/question-sets`)).json()) as { id: string; coverImageUrl?: string }[];
    expect(list.find((s) => s.id === created.id)?.coverImageUrl).toBe("/api/images/abc.png");

    const bad = await exports.default.fetch(`${BASE}/api/question-sets`, {
      method: "POST", headers,
      body: JSON.stringify({ name: "x", questions: [{ prompt: "ごんり", answers: ["りんご"], imageUrl: "javascript:alert(1)" }] }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("imageUrl");
  });
});
