import { Hono } from "hono";
import type { Env } from "./env";
import { questionSetRoutes } from "./routes/questionSets";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/", questionSetRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app;
