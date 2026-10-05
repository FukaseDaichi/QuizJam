import { Hono } from "hono";
import type { Env } from "../env";
import { requireAdmin, isAdmin } from "../auth";
import {
  createQuestionSet, deleteQuestionSet, getQuestionSet, listQuestionSets, updateQuestionSet, validateQuestionSetInput,
} from "../questionSets";

export const questionSetRoutes = new Hono<{ Bindings: Env }>();

questionSetRoutes.post("/api/admin/verify", (c) => (isAdmin(c) ? c.json({ ok: true }) : c.json({ error: "unauthorized" }, 401)));

questionSetRoutes.get("/api/question-sets", async (c) => c.json(await listQuestionSets(c.env.DB)));

questionSetRoutes.get("/api/question-sets/:id", async (c) => {
  const set = await getQuestionSet(c.env.DB, c.req.param("id"));
  return set ? c.json(set) : c.json({ error: "not_found" }, 404);
});

questionSetRoutes.post("/api/question-sets", requireAdmin, async (c) => {
  const v = validateQuestionSetInput(await c.req.json().catch(() => null));
  if ("error" in v) return c.json({ error: v.error }, 400);
  return c.json(await createQuestionSet(c.env.DB, v), 201);
});

questionSetRoutes.put("/api/question-sets/:id", requireAdmin, async (c) => {
  const v = validateQuestionSetInput(await c.req.json().catch(() => null));
  if ("error" in v) return c.json({ error: v.error }, 400);
  const set = await updateQuestionSet(c.env.DB, c.req.param("id")!, v);
  return set ? c.json(set) : c.json({ error: "not_found" }, 404);
});

questionSetRoutes.delete("/api/question-sets/:id", requireAdmin, async (c) => {
  const ok = await deleteQuestionSet(c.env.DB, c.req.param("id")!);
  return ok ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
});
