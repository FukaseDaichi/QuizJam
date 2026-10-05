import type { Context, Next } from "hono";
import type { Env } from "./env";

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ea, eb);
}

export function isAdmin(c: Context<{ Bindings: Env }>): boolean {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = c.env.ADMIN_PASSPHRASE ?? "";
  return expected.length > 0 && timingSafeEqual(token, expected);
}

export async function requireAdmin(c: Context<{ Bindings: Env }>, next: Next) {
  if (!isAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  await next();
}
