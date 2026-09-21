// test/event-migration.test.ts
// Verifies Phase 1B database migration against an authoritative in-memory SQLite database.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Event Multi-Tenancy & Lifecycle DB Migration Suite', () => {
  it('safely rebuilds cbt_events, backfills modes intelligently, and updates cbt_exams', () => {
    const db = new DatabaseSync(':memory:');

    // 1. Setup legacy pre-Phase 1B schema
    db.exec(`
      CREATE TABLE cbt_staff_profiles (
        id TEXT PRIMARY KEY,
        mansatas_user_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        nama_lengkap TEXT NOT NULL,
        nip TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        synced_at TEXT NOT NULL
      );

      CREATE TABLE cbt_events (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        activity_type TEXT NOT NULL DEFAULT 'other',
        participant_source TEXT NOT NULL CHECK (participant_source IN ('pmb', 'mansatas', 'cbt_user')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_cbt_events_status ON cbt_events(status);

      CREATE TABLE cbt_rooms (
        id TEXT PRIMARY KEY,
        room_name TEXT NOT NULL,
        capacity INTEGER DEFAULT 40,
        event_id TEXT REFERENCES cbt_events(id),
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE cbt_exams (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        duration_minutes INTEGER NOT NULL DEFAULT 60,
        rules_text TEXT,
        completion_message TEXT DEFAULT 'Ujian telah selesai. Terima kasih.',
        is_score_visible INTEGER DEFAULT 0,
        randomize_questions INTEGER DEFAULT 0,
        randomize_options INTEGER DEFAULT 0,
        active_status TEXT DEFAULT 'draft' CHECK (active_status IN ('draft', 'active', 'finished')),
        passing_score REAL DEFAULT 0,
        target_jalur TEXT DEFAULT NULL,
        event_id TEXT REFERENCES cbt_events(id),
        subject_name TEXT,
        sequence_order INTEGER NOT NULL DEFAULT 0,
        cheat_limit INTEGER DEFAULT 3,
        cheat_action TEXT DEFAULT 'lock',
        enforce_fullscreen INTEGER DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE cbt_exam_roster (
        id TEXT PRIMARY KEY,
        exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL REFERENCES cbt_events(id),
        source_key TEXT NOT NULL,
        source_id TEXT NOT NULL,
        username TEXT NOT NULL,
        nisn TEXT,
        full_name TEXT NOT NULL,
        class_name TEXT,
        grade TEXT,
        gender TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT,
        room_id TEXT REFERENCES cbt_rooms(id),
        tanggal_tes TEXT NOT NULL DEFAULT '',
        sesi_tes TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // 2. Populate sample existing production events
    db.exec(`
      -- A. Canonical PMB event
      INSERT INTO cbt_events (id, code, name, activity_type, participant_source, status)
      VALUES ('event-pmb', 'PMB', 'Penerimaan Murid Baru 2026', 'pmb', 'pmb', 'active');

      -- B. TKA event
      INSERT INTO cbt_events (id, code, name, activity_type, participant_source, status)
      VALUES ('ev-tka-12', 'TKA-2026', 'Tes Kemampuan Akademik Kelas 12', 'tka', 'mansatas', 'active');

      -- C. Semester event
      INSERT INTO cbt_events (id, code, name, activity_type, participant_source, status)
      VALUES ('ev-pas-ganjil', 'PAS-GANJIL', 'Penilaian Akhir Semester Ganjil 2025/2026', 'semester', 'mansatas', 'active');

      -- D. Ulangan event
      INSERT INTO cbt_events (id, code, name, activity_type, participant_source, status)
      VALUES ('ev-uh-fisika', 'UH-FIS-X', 'Penilaian Harian Fisika X', 'ulangan', 'mansatas', 'draft');

      -- E. General activity / competition (must fallback safely to kegiatan, NOT PMB!)
      INSERT INTO cbt_events (id, code, name, activity_type, participant_source, status)
      VALUES ('ev-lomba-robot', 'ROBOTIK-2026', 'Kompetisi Robotik Madrasah', 'other', 'cbt_user', 'active');

      -- Exams linked to events
      INSERT INTO cbt_exams (id, title, event_id) VALUES ('exam-pmb-01', 'Tes Potensi Akademik PMB', 'event-pmb');
      INSERT INTO cbt_exams (id, title, event_id) VALUES ('exam-tka-01', 'TKA Matematika Peminatan', 'ev-tka-12');
      INSERT INTO cbt_exams (id, title, event_id) VALUES ('exam-pas-01', 'PAS Bahasa Indonesia', 'ev-pas-ganjil');
      INSERT INTO cbt_exams (id, title, event_id) VALUES ('exam-uh-01', 'UH Gerak Lurus', 'ev-uh-fisika');
      INSERT INTO cbt_exams (id, title, event_id) VALUES ('exam-lomba-01', 'Penyisihan Robotik', 'ev-lomba-robot');
      INSERT INTO cbt_exams (id, title, event_id) VALUES ('exam-orphan-01', 'Ujian Lama Tanpa Event', NULL);
      INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name)
      VALUES ('roster-01', 'exam-pmb-01', 'event-pmb', 'pmb', 'p-101', '2026001', 'Ahmad Fauzi');
    `);

    // Verify row counts before migration
    const beforeCount = db.prepare('SELECT COUNT(*) as c FROM cbt_events').get() as { c: number };
    assert.equal(beforeCount.c, 5);

    // 3. Read and execute migration script
    const migrationPath = resolve(__dirname, '../migration-phase1b-events.sql');
    const migrationSql = readFileSync(migrationPath, 'utf8');
    db.exec(migrationSql);

    // 4. Verify backup table exists and holds original rows
    const backupRows = db.prepare('SELECT * FROM cbt_migration_events_backup').all();
    assert.equal(backupRows.length, 5);

    // 5. Verify post-migration events count
    const afterCount = db.prepare('SELECT COUNT(*) as c FROM cbt_events').get() as { c: number };
    assert.equal(afterCount.c, 5);

    // 6. Verify backfill classification results and proctor defaults
    const events = db.prepare('SELECT id, code, mode, status, academic_year_id, proctor_access_before_minutes, proctor_access_after_minutes FROM cbt_events ORDER BY id').all() as any[];

    const pmbEv = events.find((e) => e.id === 'event-pmb');
    assert.ok(pmbEv);
    assert.equal(pmbEv.mode, 'pmb');
    assert.equal(pmbEv.status, 'active');
    assert.equal(pmbEv.proctor_access_before_minutes, 30);
    assert.equal(pmbEv.proctor_access_after_minutes, 45);

    const tkaEv = events.find((e) => e.id === 'ev-tka-12');
    assert.ok(tkaEv);
    assert.equal(tkaEv.mode, 'tka');

    const pasEv = events.find((e) => e.id === 'ev-pas-ganjil');
    assert.ok(pasEv);
    assert.equal(pasEv.mode, 'semester');

    const uhEv = events.find((e) => e.id === 'ev-uh-fisika');
    assert.ok(uhEv);
    assert.equal(uhEv.mode, 'ulangan');
    assert.equal(uhEv.status, 'draft');

    const lombaEv = events.find((e) => e.id === 'ev-lomba-robot');
    assert.ok(lombaEv);
    // CRITICAL: Non-PMB event must NOT become PMB! Safe fallback to 'kegiatan'.
    assert.equal(lombaEv.mode, 'kegiatan');

    // 7. Verify is_active was removed and status is the single source of truth
    const columns = db.prepare('PRAGMA table_info(cbt_events)').all() as any[];
    const hasIsActive = columns.some((col) => col.name === 'is_active');
    assert.equal(hasIsActive, false, 'cbt_events must not have is_active column; status is single source of truth');

    // Verify zero events have empty or invalid mode
    const invalidModes = db.prepare(
      "SELECT COUNT(*) as c FROM cbt_events WHERE mode IS NULL OR mode NOT IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')"
    ).get() as { c: number };
    assert.equal(invalidModes.c, 0);

    // 8. Verify the new 6-stage lifecycle constraint is active
    // Inserting with newly supported lifecycle statuses: 'configuration', 'ready', 'completed'
    db.exec(`
      INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
      VALUES ('ev-new-config', 'CONF-01', 'Event Setting Stage', 'kegiatan', 'cbt_user', 'configuration');

      INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
      VALUES ('ev-new-ready', 'READY-01', 'Event Ready Stage', 'kegiatan', 'cbt_user', 'ready');

      INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
      VALUES ('ev-new-comp', 'COMP-01', 'Event Completed Stage', 'kegiatan', 'cbt_user', 'completed');
    `);

    // Invalid status must be rejected by CHECK constraint
    assert.throws(() => {
      db.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-invalid', 'INV-01', 'Invalid Status Event', 'kegiatan', 'cbt_user', 'fake_status');
      `);
    }, /CHECK constraint failed/);

    // Invalid mode must be rejected by CHECK constraint
    assert.throws(() => {
      db.exec(`
        INSERT INTO cbt_events (id, code, name, mode, participant_source, status)
        VALUES ('ev-inv-mode', 'INV-02', 'Invalid Mode Event', 'tryout', 'cbt_user', 'draft');
      `);
    }, /CHECK constraint failed/);

    // 9. Verify cbt_exams additive columns, mode backfill, and orphan exam re-attachment
    const exams = db.prepare('SELECT id, event_id, mode, is_frozen FROM cbt_exams ORDER BY id').all() as any[];

    assert.equal(exams.find((x) => x.id === 'exam-pmb-01')?.mode, 'pmb');
    assert.equal(exams.find((x) => x.id === 'exam-tka-01')?.mode, 'tka');
    assert.equal(exams.find((x) => x.id === 'exam-pas-01')?.mode, 'semester');
    assert.equal(exams.find((x) => x.id === 'exam-uh-01')?.mode, 'ulangan');
    assert.equal(exams.find((x) => x.id === 'exam-lomba-01')?.mode, 'kegiatan');

    // Orphan exam mapped to PMB and attached to canonical event-pmb
    const orphanExam = exams.find((x) => x.id === 'exam-orphan-01');
    assert.ok(orphanExam);
    assert.equal(orphanExam.mode, 'pmb');
    assert.equal(orphanExam.event_id, 'event-pmb');

    for (const ex of exams) {
      assert.equal(ex.is_frozen, 0);
    }

    // Verify roster row was restored with event_id
    const rosterRows = db.prepare('SELECT id, exam_id, event_id, full_name FROM cbt_exam_roster').all() as any[];
    assert.equal(rosterRows.length, 1);
    assert.equal(rosterRows[0].id, 'roster-01');
    assert.equal(rosterRows[0].event_id, 'event-pmb');

    // 10. Verify Foreign Keys check passes cleanly
    const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkViolations.length, 0, 'No foreign key violations allowed');
  });
});
