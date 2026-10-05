import type { QuestionSet, QuestionSetSummary } from "../shared/types";
import type { QuestionSetInput } from "../shared/validateQuestionSet";
export { validateQuestionSetInput, type QuestionSetInput } from "../shared/validateQuestionSet";

export async function listQuestionSets(db: D1Database): Promise<QuestionSetSummary[]> {
  const { results } = await db
    .prepare("SELECT id, name, data, updated_at FROM question_sets ORDER BY updated_at DESC")
    .all<{ id: string; name: string; data: string; updated_at: number }>();
  return results.map((r) => ({
    id: r.id, name: r.name, updatedAt: r.updated_at,
    questionCount: (JSON.parse(r.data) as QuestionSet).questions.length,
  }));
}

export async function getQuestionSet(db: D1Database, id: string): Promise<QuestionSet | null> {
  const row = await db.prepare("SELECT data FROM question_sets WHERE id = ?").bind(id).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as QuestionSet) : null;
}

export async function createQuestionSet(db: D1Database, input: QuestionSetInput): Promise<QuestionSet> {
  const set: QuestionSet = { id: crypto.randomUUID(), ...input };
  const now = Date.now();
  await db.prepare("INSERT INTO question_sets (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(set.id, set.name, JSON.stringify(set), now, now).run();
  return set;
}

export async function updateQuestionSet(db: D1Database, id: string, input: QuestionSetInput): Promise<QuestionSet | null> {
  const set: QuestionSet = { id, ...input };
  const res = await db.prepare("UPDATE question_sets SET name = ?, data = ?, updated_at = ? WHERE id = ?")
    .bind(set.name, JSON.stringify(set), Date.now(), id).run();
  return res.meta.changes > 0 ? set : null;
}

export async function deleteQuestionSet(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM question_sets WHERE id = ?").bind(id).run();
  return res.meta.changes > 0;
}
