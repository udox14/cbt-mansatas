-- ============================================================
-- Phase 8: AI Question Generator V1 Migration
-- Additive D1 / SQLite migration for AI authoring persistence
-- ============================================================

-- 1. AI Generation Runs (Authoring provenance & operational metadata)
CREATE TABLE IF NOT EXISTS cbt_ai_generation_runs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES cbt_events(id) ON DELETE CASCADE,
  actor_staff_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  difficulty_mode TEXT NOT NULL CHECK (difficulty_mode IN ('easy', 'balanced', 'hard')),
  variation_level TEXT NOT NULL CHECK (variation_level IN ('standard', 'varied', 'high_variation')),
  topic TEXT NOT NULL,
  additional_instruction TEXT,
  reference_text TEXT,
  requested_count INTEGER NOT NULL CHECK (requested_count > 0 AND requested_count <= 50),
  generated_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  error_code TEXT,
  error_message TEXT,
  idempotency_token TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_exam ON cbt_ai_generation_runs(exam_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_runs_actor ON cbt_ai_generation_runs(actor_staff_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_runs_idempotency ON cbt_ai_generation_runs(idempotency_token) WHERE idempotency_token IS NOT NULL;

-- 2. AI Question Drafts (Authoring review stage before canonical question creation)
CREATE TABLE IF NOT EXISTS cbt_ai_question_drafts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  run_id TEXT NOT NULL REFERENCES cbt_ai_generation_runs(id) ON DELETE CASCADE,
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  question_order INTEGER NOT NULL DEFAULT 0,
  question_text TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL CHECK (correct_index >= 0),
  explanation TEXT,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'balanced', 'hard')),
  content_hash TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'invalid', 'duplicate')),
  validation_errors_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'accepted', 'rejected')),
  canonical_question_id TEXT REFERENCES cbt_questions(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_drafts_run ON cbt_ai_question_drafts(run_id, question_order);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_exam_status ON cbt_ai_question_drafts(exam_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_hash ON cbt_ai_question_drafts(exam_id, content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_drafts_canonical_qid ON cbt_ai_question_drafts(canonical_question_id) WHERE canonical_question_id IS NOT NULL;

-- ============================================================
-- DB Integrity Triggers
-- ============================================================

-- 1. Enforce draft exam_id matches run exam_id (Cross-exam spoofing prevention)
CREATE TRIGGER IF NOT EXISTS trg_cbt_ai_drafts_exam_id_check
BEFORE INSERT ON cbt_ai_question_drafts
BEGIN
  SELECT CASE
    WHEN NEW.exam_id != (SELECT exam_id FROM cbt_ai_generation_runs WHERE id = NEW.run_id)
      THEN RAISE(ABORT, 'Draft exam_id must match run exam_id')
  END;
END;

-- 2. Protect draft acceptance: cannot accept twice, requires valid canonical question in same exam
CREATE TRIGGER IF NOT EXISTS trg_cbt_ai_drafts_acceptance_protect
BEFORE UPDATE OF status ON cbt_ai_question_drafts
WHEN NEW.status = 'accepted'
BEGIN
  SELECT CASE
    WHEN OLD.status = 'accepted'
      THEN RAISE(ABORT, 'Draft has already been accepted and cannot be accepted again')
    WHEN NEW.canonical_question_id IS NULL
      THEN RAISE(ABORT, 'Cannot mark draft accepted without a canonical_question_id')
    WHEN NOT EXISTS (SELECT 1 FROM cbt_questions WHERE id = NEW.canonical_question_id AND exam_id = NEW.exam_id)
      THEN RAISE(ABORT, 'canonical_question_id does not exist in target exam questions')
  END;
END;

-- 3. Freeze guard: drafts cannot be accepted if target exam is frozen or parent event is ready+
CREATE TRIGGER IF NOT EXISTS trg_cbt_ai_drafts_freeze_protect
BEFORE UPDATE OF status ON cbt_ai_question_drafts
WHEN NEW.status = 'accepted'
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM cbt_exams e
      LEFT JOIN cbt_events ev ON ev.id = e.event_id
      WHERE e.id = NEW.exam_id AND (
        e.is_frozen = 1 OR
        e.active_status IN ('ready', 'active', 'completed', 'archived', 'finished') OR
        ev.status IN ('ready', 'active', 'completed', 'archived')
      )
    )
      THEN RAISE(ABORT, 'Cannot accept draft into a frozen or ready+ exam')
  END;
END;
