-- ============================================================
-- PHASE 1B Migration: Event Multi-Tenancy & Lifecycle Foundation (Patched)
--
-- Safely rebuilds cbt_events with:
-- 1. Canonical mode CHECK (pmb, kegiatan, tka, semester, ulangan)
-- 2. Official 6-stage lifecycle CHECK (draft, configuration, ready, active, completed, archived)
-- 3. Academic year snapshot fields (external reference, NOT foreign key)
-- 4. Proctor access window fields (default 30/45 minutes as per implementation plan)
-- 5. Removes redundant is_active flag (lifecycle status is the single source of truth)
-- 6. Additive fields on cbt_exams (mode, owner_staff_id, version_label, is_frozen)
--
-- Safety Guarantees:
-- - event-pmb is preserved with mode = 'pmb'
-- - Non-PMB events are backfilled based on context/code/activity_type
-- - Zero events have empty or invalid mode
-- - D1 Foreign Key Safe: child references are backed up and temporarily cleared
--   before parent rebuild, then fully restored without any data loss.
-- ============================================================

-- ── 1. Backup existing cbt_events and child references ────────
DROP TABLE IF EXISTS cbt_migration_events_backup;
CREATE TABLE cbt_migration_events_backup AS SELECT * FROM cbt_events;

DROP TABLE IF EXISTS cbt_migration_rooms_event_backup;
CREATE TABLE cbt_migration_rooms_event_backup AS SELECT id, event_id FROM cbt_rooms;

DROP TABLE IF EXISTS cbt_migration_exams_event_backup;
CREATE TABLE cbt_migration_exams_event_backup AS SELECT id, event_id FROM cbt_exams;

DROP TABLE IF EXISTS cbt_migration_roster_backup;
CREATE TABLE cbt_migration_roster_backup AS SELECT * FROM cbt_exam_roster;

-- Temporarily unlink foreign keys pointing to cbt_events so DROP TABLE succeeds
-- in Cloudflare D1 environment where PRAGMA foreign_keys is enforced per statement.
DELETE FROM cbt_exam_roster;
UPDATE cbt_exams SET event_id = NULL;
UPDATE cbt_rooms SET event_id = NULL;

-- ── 2. Create cbt_events_new with canonical constraints ───────
DROP TABLE IF EXISTS cbt_events_new;
CREATE TABLE cbt_events_new (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
  activity_type TEXT NOT NULL DEFAULT 'other',
  participant_source TEXT NOT NULL CHECK (participant_source IN ('pmb', 'mansatas', 'cbt_user')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'configuration', 'ready', 'active', 'completed', 'archived')),
  academic_year_id TEXT,
  academic_year_name TEXT,
  term TEXT,
  proctor_access_before_minutes INTEGER NOT NULL DEFAULT 30,
  proctor_access_after_minutes INTEGER NOT NULL DEFAULT 45,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ── 3. Backfill existing events with intelligent context detection ─
INSERT INTO cbt_events_new (
  id,
  code,
  name,
  mode,
  activity_type,
  participant_source,
  status,
  academic_year_id,
  academic_year_name,
  term,
  proctor_access_before_minutes,
  proctor_access_after_minutes,
  created_by,
  created_at,
  updated_at
)
SELECT
  id,
  code,
  name,
  CASE
    -- Rule A: Explicit event-pmb or PMB context is ALWAYS 'pmb'
    WHEN id = 'event-pmb'
      OR LOWER(code) = 'pmb'
      OR LOWER(activity_type) = 'pmb'
      OR LOWER(name) LIKE '%penerimaan murid baru%'
      OR LOWER(name) LIKE '%pmb%'
      THEN 'pmb'

    -- Rule B: TKA context
    WHEN LOWER(activity_type) = 'tka'
      OR LOWER(code) LIKE '%tka%'
      OR LOWER(name) LIKE '%tes kemampuan akademik%'
      OR LOWER(name) LIKE '%tka%'
      THEN 'tka'

    -- Rule C: Semester context (PAS, PAT, Sumatif)
    WHEN LOWER(activity_type) IN ('semester', 'pas', 'pat', 'sumatif')
      OR LOWER(code) LIKE '%pas%'
      OR LOWER(code) LIKE '%pat%'
      OR LOWER(code) LIKE '%sem%'
      OR LOWER(name) LIKE '%semester%'
      OR LOWER(name) LIKE '%penilaian akhir semester%'
      OR LOWER(name) LIKE '%asesmen sumatif%'
      THEN 'semester'

    -- Rule D: Ulangan context (Penilaian Harian)
    WHEN LOWER(activity_type) IN ('ulangan', 'harian', 'uh')
      OR LOWER(code) LIKE '%uh%'
      OR LOWER(code) LIKE '%ulang%'
      OR LOWER(name) LIKE '%ulangan%'
      OR LOWER(name) LIKE '%penilaian harian%'
      THEN 'ulangan'

    -- Rule E: Safe fallback to 'kegiatan' for general school activities/competitions
    ELSE 'kegiatan'
  END AS mode,
  COALESCE(activity_type, 'other') AS activity_type,
  participant_source,
  CASE
    WHEN status IN ('draft', 'configuration', 'ready', 'active', 'completed', 'archived') THEN status
    ELSE 'active'
  END AS status,
  NULL AS academic_year_id,
  NULL AS academic_year_name,
  NULL AS term,
  30 AS proctor_access_before_minutes,
  45 AS proctor_access_after_minutes,
  created_by,
  COALESCE(created_at, datetime('now')) AS created_at,
  COALESCE(updated_at, datetime('now')) AS updated_at
FROM cbt_migration_events_backup;

-- Ensure canonical event-pmb row always exists
INSERT OR IGNORE INTO cbt_events_new (
  id, code, name, mode, activity_type, participant_source, status,
  academic_year_id, academic_year_name, term,
  proctor_access_before_minutes, proctor_access_after_minutes,
  created_by, created_at, updated_at
)
VALUES (
  'event-pmb', 'PMB', 'Penerimaan Murid Baru', 'pmb', 'pmb', 'pmb', 'active',
  NULL, NULL, NULL, 30, 45, NULL, datetime('now'), datetime('now')
);

-- ── 4. Swap cbt_events table safely ───────────────────────────
DROP INDEX IF EXISTS idx_cbt_events_status;
DROP TABLE cbt_events;
ALTER TABLE cbt_events_new RENAME TO cbt_events;

CREATE INDEX IF NOT EXISTS idx_cbt_events_mode ON cbt_events(mode);
CREATE INDEX IF NOT EXISTS idx_cbt_events_status ON cbt_events(status);
CREATE INDEX IF NOT EXISTS idx_cbt_events_academic_year ON cbt_events(academic_year_id);

-- ── 5. Restore child foreign key references from backups ───────
UPDATE cbt_rooms
SET event_id = (SELECT event_id FROM cbt_migration_rooms_event_backup b WHERE b.id = cbt_rooms.id);

UPDATE cbt_exams
SET event_id = (SELECT event_id FROM cbt_migration_exams_event_backup b WHERE b.id = cbt_exams.id);

INSERT INTO cbt_exam_roster
SELECT * FROM cbt_migration_roster_backup;

DROP TABLE IF EXISTS cbt_migration_rooms_event_backup;
DROP TABLE IF EXISTS cbt_migration_exams_event_backup;
DROP TABLE IF EXISTS cbt_migration_roster_backup;

-- ── 6. Additive foundation fields on cbt_exams ────────────────
ALTER TABLE cbt_exams ADD COLUMN mode TEXT;
ALTER TABLE cbt_exams ADD COLUMN owner_staff_id TEXT REFERENCES cbt_staff_profiles(id);
ALTER TABLE cbt_exams ADD COLUMN version_label TEXT;
ALTER TABLE cbt_exams ADD COLUMN is_frozen INTEGER NOT NULL DEFAULT 0;

-- Backfill cbt_exams.mode from parent cbt_events
UPDATE cbt_exams
SET mode = (SELECT mode FROM cbt_events WHERE cbt_events.id = cbt_exams.event_id)
WHERE event_id IS NOT NULL;

-- Backfill orphan exams (event_id IS NULL) based on audited contextual clues
UPDATE cbt_exams
SET mode = CASE
  WHEN target_jalur IS NOT NULL OR LOWER(title) LIKE '%pmb%' OR LOWER(title) LIKE '%potensi%' THEN 'pmb'
  WHEN LOWER(title) LIKE '%tka%' THEN 'tka'
  WHEN LOWER(title) LIKE '%pas%' OR LOWER(title) LIKE '%pat%' OR LOWER(title) LIKE '%semester%' THEN 'semester'
  WHEN LOWER(title) LIKE '%uh%' OR LOWER(title) LIKE '%ulangan%' OR LOWER(title) LIKE '%harian%' THEN 'ulangan'
  ELSE 'pmb' -- Historical CBT baseline: prior to multi-event, all exams were PMB
END
WHERE mode IS NULL;

-- Ensure orphan exams classified as PMB are explicitly linked to event-pmb
UPDATE cbt_exams
SET event_id = 'event-pmb'
WHERE event_id IS NULL AND mode = 'pmb';

CREATE INDEX IF NOT EXISTS idx_cbt_exams_mode ON cbt_exams(mode);
CREATE INDEX IF NOT EXISTS idx_cbt_exams_owner ON cbt_exams(owner_staff_id);

PRAGMA foreign_key_check;
