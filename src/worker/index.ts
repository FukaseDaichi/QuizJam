import { Hono } from "hono";
import type { Env } from "./env";
import { questionSetRoutes } from "./routes/questionSets";
import { roomRoutes } from "./routes/rooms";
import { imageRoutes } from "./routes/images";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", questionSetRoutes);
app.route("/", roomRoutes);
app.route("/", imageRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

export { Room } from "../room/Room";

export default app;
