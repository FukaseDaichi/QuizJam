CREATE TABLE IF NOT EXISTS question_sets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,            -- QuestionSet 全体の JSON（id を含む）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
