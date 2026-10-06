import { Hono } from "hono";
import type { Env } from "../env";
import { requireAdmin } from "../auth";

/** 問題スライド用の画像を R2 に保存・配信する */
export const imageRoutes = new Hono<{ Bindings: Env }>();

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function imageExtension(contentType: string | undefined | null): string | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return EXTENSIONS[type] ?? null;
}

imageRoutes.post("/api/images", requireAdmin, async (c) => {
  const ext = imageExtension(c.req.header("Content-Type"));
  if (!ext) return c.json({ error: "unsupported_type" }, 415);
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) return c.json({ error: "too_large" }, 413);
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
  if (body.byteLength > MAX_IMAGE_BYTES) return c.json({ error: "too_large" }, 413);

  const key = `${crypto.randomUUID()}.${ext}`;
  await c.env.IMAGES.put(key, body, { httpMetadata: { contentType: `image/${ext === "jpg" ? "jpeg" : ext}` } });
  return c.json({ key, url: `/api/images/${key}` }, 201);
});

imageRoutes.get("/api/images/:key", async (c) => {
  const key = c.req.param("key")!;
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return c.json({ error: "not_found" }, 404);
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  // キーは UUID なので内容が変わることはない。長期キャッシュしてよい
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

imageRoutes.delete("/api/images/:key", requireAdmin, async (c) => {
  const key = c.req.param("key")!;
  if (!/^[A-Za-z0-9._-]+$/.test(key)) return c.json({ error: "not_found" }, 404);
  await c.env.IMAGES.delete(key);
  return c.body(null, 204);
});
