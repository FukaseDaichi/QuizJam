import { describe, it, expect } from "vitest";
import { exports } from "cloudflare:workers";
import { randomRoomCode, randomToken } from "../../src/worker/token";

const BASE = "http://localhost";

describe("token helpers", () => {
  it("room code is 6 chars from the safe alphabet", () => {
    for (let i = 0; i < 100; i++) expect(randomRoomCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
  it("token is 64 hex chars", () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe("room API", () => {
  it("creates a room and reports it exists", async () => {
    const res = await exports.default.fetch(`${BASE}/api/rooms`, { method: "POST" });
    expect(res.status).toBe(201);
    const { roomCode, gmToken } = (await res.json()) as { roomCode: string; gmToken: string };
    expect(roomCode).toHaveLength(6);
    expect(gmToken).toHaveLength(64);
    const exists = await exports.default.fetch(`${BASE}/api/rooms/${roomCode}`);
    expect(exists.status).toBe(200);
    expect(await exists.json()).toEqual({ roomCode });
  });

  it("returns 404 for unknown rooms", async () => {
    expect((await exports.default.fetch(`${BASE}/api/rooms/ZZZZZZ`)).status).toBe(404);
    const join = await exports.default.fetch(`${BASE}/api/rooms/ZZZZZZ/join`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: "a" }),
    });
    expect(join.status).toBe(404);
  });

  it("joins a room and opens a websocket through the worker", async () => {
    const created = await exports.default.fetch(`${BASE}/api/rooms`, { method: "POST" });
    const { roomCode } = (await created.json()) as { roomCode: string };
    const join = await exports.default.fetch(`${BASE}/api/rooms/${roomCode}/join`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: "みさき" }),
    });
    expect(join.status).toBe(200);
    const { participantToken } = (await join.json()) as { participantToken: string };

    const ws = await exports.default.fetch(`${BASE}/ws/room/${roomCode}?token=${participantToken}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(ws.status).toBe(101);
    expect(ws.webSocket).toBeTruthy();
    ws.webSocket!.accept();
    ws.webSocket!.close();
  });

  it("upper-cases room codes", async () => {
    const created = await exports.default.fetch(`${BASE}/api/rooms`, { method: "POST" });
    const { roomCode } = (await created.json()) as { roomCode: string };
    expect((await exports.default.fetch(`${BASE}/api/rooms/${roomCode.toLowerCase()}`)).status).toBe(200);
  });
});
