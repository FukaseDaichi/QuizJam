import { describe, it, expect } from "vitest";
import { exports } from "cloudflare:workers";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await exports.default.fetch("http://localhost/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
