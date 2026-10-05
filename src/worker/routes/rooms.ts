import { Hono } from "hono";
import type { Env } from "../env";
import { randomRoomCode, randomToken } from "../token";

export const roomRoutes = new Hono<{ Bindings: Env }>();

function stub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code.toUpperCase()));
}

roomRoutes.post("/api/rooms", async (c) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const roomCode = randomRoomCode();
    const gmToken = randomToken();
    const res = await stub(c.env, roomCode).fetch("http://room/init", {
      method: "POST", body: JSON.stringify({ roomCode, gmToken }),
    });
    if (res.status === 200) return c.json({ roomCode, gmToken }, 201);
    if (res.status !== 409) return c.json({ error: "room_init_failed" }, 500);
  }
  return c.json({ error: "room_code_exhausted" }, 503);
});

roomRoutes.get("/api/rooms/:code", async (c) => {
  const res = await stub(c.env, c.req.param("code")).fetch("http://room/exists");
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
});

roomRoutes.post("/api/rooms/:code/join", async (c) => {
  const res = await stub(c.env, c.req.param("code")).fetch("http://room/join", {
    method: "POST", body: await c.req.text(),
  });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
});

roomRoutes.get("/ws/room/:code", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "expected_websocket" }, 426);
  const token = c.req.query("token") ?? "";
  const url = new URL("http://room/ws");
  url.searchParams.set("token", token);
  return stub(c.env, c.req.param("code")).fetch(url.toString(), { headers: { Upgrade: "websocket" } });
});
