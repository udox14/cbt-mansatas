CREATE TABLE IF NOT EXISTS cbt_ai_generations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  created_by TEXT,
  generation_mode TEXT NOT NULL DEFAULT 'review' CHECK (generation_mode IN ('review', 'direct_save')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'imported')),
  model_name TEXT,
  request_payload TEXT,
  generated_payload TEXT,
  generated_count INTEGER DEFAULT 0,
  imported_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  imported_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cbt_ai_generations_exam ON cbt_ai_generations(exam_id, created_at DESC);
