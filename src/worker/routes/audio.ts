import { Hono } from "hono";
import type { Env } from "../env";
import { requireAdmin } from "../auth";

/** 早押しの問読み音声（mp3）を R2 に保存・配信する。画像と同じバケットを使う */
export const audioRoutes = new Hono<{ Bindings: Env }>();

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

/** キーは本文の SHA-256 なので、同じ mp3 を何度上げても増えない */
const KEY_PATTERN = /^[0-9a-f]{64}\.mp3$/;

async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

audioRoutes.post("/api/audio", requireAdmin, async (c) => {
  const type = (c.req.header("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "audio/mpeg") return c.json({ error: "unsupported_type" }, 415);
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (declared > MAX_AUDIO_BYTES) return c.json({ error: "too_large" }, 413);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
  if (body.byteLength > MAX_AUDIO_BYTES) return c.json({ error: "too_large" }, 413);

  const key = `${await sha256Hex(body)}.mp3`;
  const url = `/api/audio/${key}`;
  if (await c.env.IMAGES.head(key)) return c.json({ key, url }, 200);
  await c.env.IMAGES.put(key, body, { httpMetadata: { contentType: "audio/mpeg" } });
  return c.json({ key, url }, 201);
});

audioRoutes.get("/api/audio/:key", async (c) => {
  const key = c.req.param("key")!;
  if (!KEY_PATTERN.test(key)) return c.json({ error: "not_found" }, 404);
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  // キーは内容のハッシュなので内容が変わることはない。長期キャッシュしてよい
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});
