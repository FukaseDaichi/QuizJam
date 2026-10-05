import { describe, it, expect } from "vitest";
import { exports } from "cloudflare:workers";

const BASE = "http://localhost";
const auth = { Authorization: "Bearer test-pass", "Content-Type": "application/json" };

const input = {
  name: "果物",
  settings: { timerMode: "fixed", timerSeconds: 20, basePoints: 100, rankBonus: [50, 30, 10], wrongPenalty: 0, maxAttempts: 3 },
  questions: [{ id: "q1", type: "anagram", prompt: "ごんり", answers: ["りんご"] }],
};

async function create() {
  const res = await exports.default.fetch(`${BASE}/api/question-sets`, {
    method: "POST", headers: auth, body: JSON.stringify(input),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

describe("question set API", () => {
  it("rejects mutations without the passphrase", async () => {
    const res = await exports.default.fetch(`${BASE}/api/question-sets`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    expect(res.status).toBe(401);
    const bad = await exports.default.fetch(`${BASE}/api/question-sets`, {
      method: "POST", headers: { ...auth, Authorization: "Bearer wrong" }, body: JSON.stringify(input),
    });
    expect(bad.status).toBe(401);
  });

  it("verifies the passphrase", async () => {
    expect((await exports.default.fetch(`${BASE}/api/admin/verify`, { method: "POST", headers: auth })).status).toBe(200);
    expect((await exports.default.fetch(`${BASE}/api/admin/verify`, { method: "POST" })).status).toBe(401);
  });

  it("creates, lists and gets a question set", async () => {
    const created = await create();
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const list = await exports.default.fetch(`${BASE}/api/question-sets`);
    expect(list.status).toBe(200);
    const items = (await list.json()) as { id: string; name: string; questionCount: number }[];
    expect(items.some((i) => i.id === created.id && i.name === "果物" && i.questionCount === 1)).toBe(true);

    const get = await exports.default.fetch(`${BASE}/api/question-sets/${created.id}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ id: created.id, ...input });
  });

  it("updates and deletes", async () => {
    const created = await create();
    const put = await exports.default.fetch(`${BASE}/api/question-sets/${created.id}`, {
      method: "PUT", headers: auth, body: JSON.stringify({ ...input, name: "野菜" }),
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { name: string }).name).toBe("野菜");

    const del = await exports.default.fetch(`${BASE}/api/question-sets/${created.id}`, { method: "DELETE", headers: auth });
    expect(del.status).toBe(204);
    expect((await exports.default.fetch(`${BASE}/api/question-sets/${created.id}`)).status).toBe(404);
  });

  it("validates input", async () => {
    const res = await exports.default.fetch(`${BASE}/api/question-sets`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ name: "", settings: {}, questions: [{ prompt: "x", answers: [] }] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("name");
  });
});
