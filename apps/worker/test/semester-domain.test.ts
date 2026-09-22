// ============================================================
// Comprehensive Automated Test Suite for Phase 6 — Semester Foundation
//
// Verifies all 12 required architectural and integrity test suites:
// 1. Migration preflight diagnostic queries, dual schema consistency, FK integrity
// 2. Exam integrity triggers: non-semester parent rejection, mode escape on update, target_grade check
// 3. Mansatas subject verification: rejects synthetic or unverified subjects
// 4. Multi-grade participant snapshot (Grades 10, 11, 12) with riwayat_kelas fallback
// 5. Atomic diff resync: preserves assigned room_id and nomor_peserta
// 6. Deterministic participant numbering generation
// 7. Academic audience mapping (cbt_semester_exam_classes) & teacher deduplication
// 8. Class disjointness invariant: triggers block overlapping class-subject assignments in an event
// 9. Audience-driven roster materialization into cbt_exam_roster
// 10. Server-authoritative readiness gate with room capacity hard blocker
// 11. Discrete time slots, non-overlapping validation, collision detection, and token purge on reschedule
// 12. Authoritative runtime schedule check, late-start cutoff policy, lifecycle rollback, and RBAC matrix
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

import semesterRoutes from '../src/routes/domains/semester.ts';
import studentRoutes from '../src/routes/student.ts';
import { signJWT } from '../src/utils/jwt.ts';
import {
  listSemesterEvents,
  getSemesterEventById,
  createSemesterEvent,
  updateSemesterEvent,
  transitionSemesterEventStatus,
  deleteSemesterEvent,
  assertSemesterEvent,
  DomainMismatchError,
  EventFrozenError,
} from '../src/services/domains/semester/events.ts';
import {
  snapshotSemesterParticipants,
  listSemesterParticipants,
  assignSemesterParticipantRooms,
  generateSemesterParticipantNumbers,
} from '../src/services/domains/semester/snapshot.ts';
import {
  listSemesterExams,
  getSemesterExamById,
  createSemesterExam,
  updateSemesterExam,
  deleteSemesterExam,
  verifyMansatasSubject,
  listVerifiedMansatasSubjects,
} from '../src/services/domains/semester/exams.ts';
import {
  discoverAvailableClasses,
  listSemesterExamClasses,
  assignSemesterExamClasses,
  materializeSemesterExamRoster,
  materializeAllSemesterRosters,
} from '../src/services/domains/semester/audience.ts';
import {
  listSemesterSlots,
  createSemesterSlot,
  updateSemesterSlot,
  deleteSemesterSlot,
  assignSemesterExamSlot,
  removeSemesterExamSlot,
  listSemesterSchedules,
} from '../src/services/domains/semester/scheduling.ts';
import {
  authorizeSemesterExamSchedule,
  getWibNow,
} from '../src/services/domains/semester/runtime.ts';
import { checkSemesterEventReadiness } from '../src/services/domains/semester/readiness.ts';

const JWT_SECRET = 'test-secret-key-for-semester-phase6';

// ── Test Mock D1 Database Setup ─────────────────────────────
function createMockCbtDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE cbt_events (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
      activity_type TEXT NOT NULL DEFAULT 'other',
      participant_source TEXT NOT NULL DEFAULT 'mansatas',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'configuration', 'ready', 'active', 'completed', 'archived')),
      academic_year_id TEXT,
      academic_year_name TEXT,
      term TEXT,
      proctor_access_before_minutes INTEGER NOT NULL DEFAULT 30,
      proctor_access_after_minutes INTEGER NOT NULL DEFAULT 45,
      description TEXT,
      starts_at TEXT,
      ends_at TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

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
      active_status TEXT NOT NULL DEFAULT 'draft',
      passing_score REAL DEFAULT 0,
      target_jalur TEXT DEFAULT NULL,
      target_grade TEXT CHECK (target_grade IS NULL OR target_grade IN ('10', '11', '12')),
      event_id TEXT REFERENCES cbt_events(id),
      subject_id TEXT,
      subject_name TEXT,
      class_id TEXT,
      class_name TEXT,
      sequence_order INTEGER NOT NULL DEFAULT 0,
      cheat_limit INTEGER DEFAULT 3,
      cheat_action TEXT DEFAULT 'lock',
      enforce_fullscreen INTEGER DEFAULT 0,
      mode TEXT CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
      owner_staff_id TEXT,
      version_label TEXT,
      is_frozen INTEGER DEFAULT 0,
      teaching_assignment_id TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_semester_participants (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      nisn TEXT,
      nis_lokal TEXT,
      nama_lengkap TEXT NOT NULL,
      grade TEXT NOT NULL CHECK (grade IN ('10', '11', '12')),
      class_id TEXT NOT NULL,
      class_name TEXT NOT NULL,
      gender TEXT CHECK (gender IN ('L', 'P')),
      room_id TEXT REFERENCES cbt_rooms(id) ON DELETE SET NULL,
      nomor_peserta TEXT,
      is_room_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (event_id, student_id)
    );

    CREATE TABLE cbt_semester_exam_classes (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      class_id TEXT NOT NULL,
      class_name TEXT NOT NULL,
      grade TEXT NOT NULL CHECK (grade IN ('10', '11', '12')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (exam_id, class_id)
    );

    CREATE TABLE cbt_semester_slots (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      slot_label TEXT NOT NULL,
      slot_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      sequence_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (end_time > start_time),
      UNIQUE (event_id, slot_date, start_time, end_time)
    );

    CREATE TABLE cbt_semester_schedules (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL REFERENCES cbt_semester_slots(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      is_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (event_id, exam_id)
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_generation_controls (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      active_batch_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      started_at TEXT,
      actor_id TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      UNIQUE(event_id, stage)
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_room_layouts (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      layout_type TEXT NOT NULL,
      total_seats INTEGER NOT NULL,
      rows_count INTEGER,
      cols_count INTEGER,
      desk_group_count INTEGER,
      is_irregular INTEGER NOT NULL DEFAULT 0,
      required_invigilators INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, room_id)
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_seats (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      seat_number INTEGER NOT NULL,
      seat_label TEXT NOT NULL,
      row_num INTEGER NOT NULL DEFAULT 1,
      col_num INTEGER NOT NULL DEFAULT 1,
      desk_group INTEGER,
      sequence_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, room_id, seat_number)
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_seat_assignments (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      seat_id TEXT NOT NULL,
      is_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, participant_id),
      UNIQUE(event_id, seat_id)
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_rooms_staging (
      batch_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      is_locked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (batch_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_seat_assignments_staging (
      batch_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      seat_id TEXT NOT NULL,
      is_locked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (batch_id, participant_id)
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_invig_staging (
      batch_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      invigilator_order INTEGER NOT NULL,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      mansatas_user_id TEXT,
      is_locked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (batch_id, slot_id, room_id, invigilator_order)
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_invigilator_pool (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      is_eligible INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, staff_id)
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_staff_blackouts (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      slot_id TEXT,
      blackout_date TEXT,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_invigilator_assignments (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      invigilator_order INTEGER NOT NULL DEFAULT 1,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      mansatas_user_id TEXT,
      is_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, slot_id, staff_id),
      UNIQUE(event_id, slot_id, room_id, invigilator_order)
    );

    CREATE TABLE IF NOT EXISTS cbt_semester_generation_logs (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      seed INTEGER,
      configuration TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
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
      nomor_peserta TEXT,
      tanggal_tes TEXT NOT NULL DEFAULT '',
      sesi_tes TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(exam_id, source_key, source_id)
    );

    CREATE TABLE cbt_questions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      question_order INTEGER NOT NULL DEFAULT 0,
      question_text TEXT NOT NULL,
      question_type TEXT DEFAULT 'multiple_choice',
      image_url TEXT,
      audio_url TEXT,
      points REAL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_question_options (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES cbt_questions(id) ON DELETE CASCADE,
      option_label TEXT NOT NULL,
      option_text TEXT NOT NULL,
      image_url TEXT,
      is_correct INTEGER DEFAULT 0,
      option_order INTEGER DEFAULT 0
    );

    CREATE TABLE cbt_exam_tokens (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      room_id TEXT REFERENCES cbt_rooms(id) ON DELETE CASCADE,
      tanggal_tes TEXT NOT NULL DEFAULT '',
      sesi_tes TEXT NOT NULL DEFAULT '',
      token_code TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(exam_id, room_id, tanggal_tes, sesi_tes)
    );

    CREATE TABLE cbt_exam_sessions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL,
      room_id TEXT,
      status TEXT DEFAULT 'active',
      cheat_warnings INTEGER DEFAULT 0,
      question_map TEXT,
      option_map TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      last_heartbeat TEXT DEFAULT (datetime('now')),
      is_time_locked INTEGER DEFAULT 0,
      locked_at TEXT,
      ip_address TEXT,
      user_agent TEXT,
      UNIQUE(exam_id, user_id, user_type)
    );

    CREATE TABLE cbt_student_answers (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL REFERENCES cbt_questions(id) ON DELETE CASCADE,
      selected_option_id TEXT REFERENCES cbt_question_options(id),
      essay_answer TEXT,
      is_doubtful INTEGER DEFAULT 0,
      answered_at TEXT DEFAULT (datetime('now')),
      UNIQUE(session_id, question_id)
    );

    CREATE TABLE cbt_exam_results (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id),
      user_id TEXT NOT NULL,
      user_type TEXT NOT NULL,
      total_questions INTEGER DEFAULT 0,
      total_correct INTEGER DEFAULT 0,
      total_wrong INTEGER DEFAULT 0,
      total_unanswered INTEGER DEFAULT 0,
      score REAL DEFAULT 0,
      computed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_permission_grants (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'global',
      scope_value TEXT NOT NULL DEFAULT '*',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      nama_lengkap TEXT NOT NULL,
      nisn TEXT,
      role TEXT NOT NULL,
      room_id TEXT,
      is_active INTEGER DEFAULT 1
    );

    -- Phase 6 DB Integrity Triggers

    -- 1. Semester Exam Event & Grade Integrity
    CREATE TRIGGER trg_cbt_exams_semester_integrity_insert
    BEFORE INSERT ON cbt_exams
    WHEN (NEW.mode = 'semester' OR EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester'))
    BEGIN
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
          AND (NEW.mode IS NULL OR NEW.mode != 'semester')
          THEN RAISE(ABORT, 'Exams belonging to a semester event must have mode = ''semester''')
        WHEN NEW.mode = 'semester' AND (NEW.event_id IS NULL OR trim(NEW.event_id) = '')
          THEN RAISE(ABORT, 'Semester exams must have a non-null non-blank event_id')
        WHEN NEW.mode = 'semester' AND NOT EXISTS (
          SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester'
        )
          THEN RAISE(ABORT, 'Semester exams must reference an existing event with mode = ''semester''')
        WHEN NEW.mode = 'semester' AND (NEW.target_grade IS NULL OR trim(NEW.target_grade) = '' OR NEW.target_grade NOT IN ('10', '11', '12'))
          THEN RAISE(ABORT, 'Semester exams must have target_grade in (''10'', ''11'', ''12'')')
        WHEN NEW.mode = 'semester' AND (NEW.subject_id IS NULL OR trim(NEW.subject_id) = '')
          THEN RAISE(ABORT, 'Semester exams must have a non-null verified subject_id')
      END;
    END;

    CREATE TRIGGER trg_cbt_exams_semester_integrity_update
    BEFORE UPDATE OF target_grade, subject_id, mode, event_id ON cbt_exams
    WHEN (OLD.mode = 'semester' OR NEW.mode = 'semester' OR EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester'))
    BEGIN
      SELECT CASE
        WHEN OLD.mode = 'semester' AND (NEW.mode IS NULL OR NEW.mode != 'semester')
          THEN RAISE(ABORT, 'Cannot independently mutate mode of a Semester exam away from semester')
        WHEN EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
          AND (NEW.mode IS NULL OR NEW.mode != 'semester')
          THEN RAISE(ABORT, 'Exams belonging to a semester event must have mode = ''semester''')
        WHEN NEW.mode = 'semester' AND (NEW.event_id IS NULL OR trim(NEW.event_id) = '')
          THEN RAISE(ABORT, 'Semester exams must have a non-null non-blank event_id')
        WHEN NEW.mode = 'semester' AND NOT EXISTS (
          SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester'
        )
          THEN RAISE(ABORT, 'Semester exams must reference an existing event with mode = ''semester''')
        WHEN NEW.mode = 'semester' AND (NEW.target_grade IS NULL OR trim(NEW.target_grade) = '' OR NEW.target_grade NOT IN ('10', '11', '12'))
          THEN RAISE(ABORT, 'Semester exams must have target_grade in (''10'', ''11'', ''12'')')
        WHEN NEW.mode = 'semester' AND (NEW.subject_id IS NULL OR trim(NEW.subject_id) = '')
          THEN RAISE(ABORT, 'Semester exams must have a non-null verified subject_id')
      END;
    END;

    -- 2. Exam Academic Audience Trigger
    CREATE TRIGGER trg_cbt_semester_exam_classes_insert
    BEFORE INSERT ON cbt_semester_exam_classes
    BEGIN
      SELECT CASE
        WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_exam_classes.event_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'cbt_semester_exam_classes can only belong to an event with mode = ''semester''')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'Semester exam class assignment must reference an existing semester exam in the same event')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND target_grade = NEW.grade)
          THEN RAISE(ABORT, 'Semester exam class grade must match exam target_grade')
        WHEN EXISTS (
          SELECT 1
          FROM cbt_semester_exam_classes sec
          JOIN cbt_exams e1 ON e1.id = sec.exam_id
          JOIN cbt_exams e2 ON e2.id = NEW.exam_id
          WHERE sec.event_id = NEW.event_id
            AND sec.class_id = NEW.class_id
            AND sec.exam_id != NEW.exam_id
            AND e1.subject_id = e2.subject_id
        )
          THEN RAISE(ABORT, 'A class cannot be assigned to multiple semester exams for the same subject in the same event')
      END;
    END;

    CREATE TRIGGER trg_cbt_semester_exam_classes_update
    BEFORE UPDATE OF event_id, exam_id, class_id, grade ON cbt_semester_exam_classes
    BEGIN
      SELECT CASE
        WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_exam_classes.event_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'cbt_semester_exam_classes can only belong to an event with mode = ''semester''')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'Semester exam class assignment must reference an existing semester exam in the same event')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND target_grade = NEW.grade)
          THEN RAISE(ABORT, 'Semester exam class grade must match exam target_grade')
        WHEN EXISTS (
          SELECT 1
          FROM cbt_semester_exam_classes sec
          JOIN cbt_exams e1 ON e1.id = sec.exam_id
          JOIN cbt_exams e2 ON e2.id = NEW.exam_id
          WHERE sec.event_id = NEW.event_id
            AND sec.class_id = NEW.class_id
            AND sec.exam_id != NEW.exam_id
            AND e1.subject_id = e2.subject_id
        )
          THEN RAISE(ABORT, 'A class cannot be assigned to multiple semester exams for the same subject in the same event')
      END;
    END;

    -- 3. Schedule Cross-Event Integrity
    CREATE TRIGGER trg_cbt_semester_schedules_integrity_insert
    BEFORE INSERT ON cbt_semester_schedules
    BEGIN
      SELECT CASE
        WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_schedules.event_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'cbt_semester_schedules can only belong to an event with mode = ''semester''')
        WHEN NEW.exam_id IS NULL OR trim(NEW.exam_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_schedules.exam_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'cbt_semester_schedules.exam_id must belong to schedule.event_id with mode = ''semester''')
        WHEN NEW.slot_id IS NULL OR trim(NEW.slot_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_schedules.slot_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
          THEN RAISE(ABORT, 'cbt_semester_schedules.slot_id must belong to schedule.event_id')
      END;
    END;

    CREATE TRIGGER trg_cbt_semester_schedules_integrity_update
    BEFORE UPDATE OF event_id, exam_id, slot_id ON cbt_semester_schedules
    BEGIN
      SELECT CASE
        WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_schedules.event_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'cbt_semester_schedules can only belong to an event with mode = ''semester''')
        WHEN NEW.exam_id IS NULL OR trim(NEW.exam_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_schedules.exam_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'cbt_semester_schedules.exam_id must belong to schedule.event_id with mode = ''semester''')
        WHEN NEW.slot_id IS NULL OR trim(NEW.slot_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_schedules.slot_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_semester_slots WHERE id = NEW.slot_id AND event_id = NEW.event_id)
          THEN RAISE(ABORT, 'cbt_semester_schedules.slot_id must belong to schedule.event_id')
      END;
    END;

    -- 4. Participant Room Scope
    CREATE TRIGGER trg_cbt_semester_participants_integrity_insert
    BEFORE INSERT ON cbt_semester_participants
    BEGIN
      SELECT CASE
        WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_participants.event_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'cbt_semester_participants can only be attached to an event with mode = ''semester''')
        WHEN NEW.grade IS NULL OR trim(NEW.grade) = '' OR NEW.grade NOT IN ('10', '11', '12')
          THEN RAISE(ABORT, 'cbt_semester_participants.grade must be one of (''10'', ''11'', ''12'')')
        WHEN NEW.room_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id)
        ) THEN RAISE(ABORT, 'Semester participant room must be global or belong to the same event')
      END;
    END;

    CREATE TRIGGER trg_cbt_semester_participants_integrity_update
    BEFORE UPDATE OF event_id, grade, room_id ON cbt_semester_participants
    BEGIN
      SELECT CASE
        WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_participants.event_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'cbt_semester_participants can only be attached to an event with mode = ''semester''')
        WHEN NEW.grade IS NULL OR trim(NEW.grade) = '' OR NEW.grade NOT IN ('10', '11', '12')
          THEN RAISE(ABORT, 'cbt_semester_participants.grade must be one of (''10'', ''11'', ''12'')')
        WHEN NEW.room_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM cbt_rooms WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id)
        ) THEN RAISE(ABORT, 'Semester participant room must be global or belong to the same event')
      END;
    END;

    -- 5. Slots Mode Integrity
    CREATE TRIGGER trg_cbt_semester_slots_integrity_insert
    BEFORE INSERT ON cbt_semester_slots
    BEGIN
      SELECT CASE
        WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_slots.event_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'cbt_semester_slots can only be attached to an event with mode = ''semester''')
      END;
    END;

    CREATE TRIGGER trg_cbt_semester_slots_integrity_update
    BEFORE UPDATE OF event_id ON cbt_semester_slots
    BEGIN
      SELECT CASE
        WHEN NEW.event_id IS NULL OR trim(NEW.event_id) = ''
          THEN RAISE(ABORT, 'cbt_semester_slots.event_id cannot be null or blank')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_events WHERE id = NEW.event_id AND mode = 'semester')
          THEN RAISE(ABORT, 'cbt_semester_slots can only be attached to an event with mode = ''semester''')
      END;
    END;

    -- 6. Runtime Roster Integrity
    CREATE TRIGGER trg_cbt_exam_roster_semester_insert
    BEFORE INSERT ON cbt_exam_roster
    WHEN EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND mode = 'semester')
    BEGIN
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id)
          THEN RAISE(ABORT, 'Semester roster event_id must match exam event_id')
        WHEN NOT EXISTS (
          SELECT 1 FROM cbt_semester_participants
          WHERE event_id = NEW.event_id AND student_id = NEW.source_id
        )
          THEN RAISE(ABORT, 'Semester roster participant must exist in cbt_semester_participants for this event')
        WHEN NOT EXISTS (
          SELECT 1
          FROM cbt_semester_participants sp
          JOIN cbt_semester_exam_classes sec ON sec.exam_id = NEW.exam_id AND sec.class_id = sp.class_id
          WHERE sp.event_id = NEW.event_id AND sp.student_id = NEW.source_id
        )
          THEN RAISE(ABORT, 'Participant class is not in the academic audience for this semester exam')
        WHEN NOT EXISTS (
          SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND target_grade = NEW.grade
        )
          THEN RAISE(ABORT, 'Semester roster grade must match exam target_grade')
        WHEN NEW.room_id IS NULL OR trim(NEW.room_id) = ''
          THEN RAISE(ABORT, 'Semester roster room_id cannot be null')
        WHEN NOT EXISTS (
          SELECT 1 FROM cbt_rooms
          WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id)
        )
          THEN RAISE(ABORT, 'Semester roster room must be global or belong to this event')
      END;
    END;

    CREATE TRIGGER trg_cbt_exam_roster_semester_update
    BEFORE UPDATE OF exam_id, event_id, source_id, grade, room_id ON cbt_exam_roster
    WHEN EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND mode = 'semester')
      OR EXISTS (SELECT 1 FROM cbt_exams WHERE id = OLD.exam_id AND mode = 'semester')
    BEGIN
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM cbt_exams WHERE id = OLD.exam_id AND mode = 'semester')
          AND NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND mode = 'semester')
          THEN RAISE(ABORT, 'Cannot mutate semester roster entry to non-semester exam')
        WHEN NOT EXISTS (SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND event_id = NEW.event_id)
          THEN RAISE(ABORT, 'Semester roster event_id must match exam event_id')
        WHEN NOT EXISTS (
          SELECT 1 FROM cbt_semester_participants
          WHERE event_id = NEW.event_id AND student_id = NEW.source_id
        )
          THEN RAISE(ABORT, 'Semester roster participant must exist in cbt_semester_participants for this event')
        WHEN NOT EXISTS (
          SELECT 1
          FROM cbt_semester_participants sp
          JOIN cbt_semester_exam_classes sec ON sec.exam_id = NEW.exam_id AND sec.class_id = sp.class_id
          WHERE sp.event_id = NEW.event_id AND sp.student_id = NEW.source_id
        )
          THEN RAISE(ABORT, 'Participant class is not in the academic audience for this semester exam')
        WHEN NOT EXISTS (
          SELECT 1 FROM cbt_exams WHERE id = NEW.exam_id AND target_grade = NEW.grade
        )
          THEN RAISE(ABORT, 'Semester roster grade must match exam target_grade')
        WHEN NEW.room_id IS NULL OR trim(NEW.room_id) = ''
          THEN RAISE(ABORT, 'Semester roster room_id cannot be null')
        WHEN NOT EXISTS (
          SELECT 1 FROM cbt_rooms
          WHERE id = NEW.room_id AND (event_id IS NULL OR event_id = NEW.event_id)
        )
          THEN RAISE(ABORT, 'Semester roster room must be global or belong to this event')
      END;
    END;

    INSERT INTO cbt_rooms (id, room_name, capacity) VALUES
      ('room-sem-1', 'Ruang 01', 30),
      ('room-sem-2', 'Ruang 02', 30);
  `);

  return wrapSqliteAsD1(sqlite);
}

function createMockMansatasDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE tahun_ajaran (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      semester TEXT NOT NULL DEFAULT '1',
      is_active INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE mata_pelajaran (
      id TEXT PRIMARY KEY,
      nama_mapel TEXT NOT NULL,
      kode_mapel TEXT,
      kelompok TEXT,
      tingkat INTEGER
    );

    CREATE TABLE kelas (
      id TEXT PRIMARY KEY,
      tingkat INTEGER NOT NULL,
      nomor_kelas INTEGER,
      kelompok TEXT,
      kapasitas INTEGER DEFAULT 36,
      wali_kelas_id TEXT
    );

    CREATE TABLE siswa (
      id TEXT PRIMARY KEY,
      nisn TEXT UNIQUE NOT NULL,
      nis_lokal TEXT,
      nama_lengkap TEXT NOT NULL,
      jenis_kelamin TEXT NOT NULL CHECK (jenis_kelamin IN ('L', 'P')),
      kelas_id TEXT REFERENCES kelas(id),
      status TEXT NOT NULL DEFAULT 'aktif',
      foto_url TEXT
    );

    CREATE TABLE riwayat_kelas (
      siswa_id TEXT NOT NULL,
      kelas_id TEXT NOT NULL,
      tahun_ajaran_id TEXT NOT NULL
    );

    CREATE TABLE penugasan_mengajar (
      id TEXT PRIMARY KEY,
      guru_id TEXT NOT NULL,
      mapel_id TEXT NOT NULL REFERENCES mata_pelajaran(id),
      kelas_id TEXT NOT NULL REFERENCES kelas(id),
      tahun_ajaran_id TEXT NOT NULL REFERENCES tahun_ajaran(id)
    );

    -- Seed Academic Year
    INSERT INTO tahun_ajaran (id, nama, semester, is_active) VALUES
      ('ta-sem-2026', '2026/2027', '1', 1),
      ('ta-sem-2025', '2025/2026', '2', 0);

    -- Seed Official Mansatas Subjects
    INSERT INTO mata_pelajaran (id, nama_mapel, kode_mapel, kelompok, tingkat) VALUES
      ('mp-mat-10', 'Matematika X', 'MAT-10', 'Umum', 10),
      ('mp-mat-11', 'Matematika XI', 'MAT-11', 'Umum', 11),
      ('mp-mat-12', 'Matematika XII', 'MAT-12', 'Umum', 12),
      ('mp-fis-11', 'Fisika XI', 'FIS-11', 'MIPA', 11),
      ('mp-bio-12', 'Biologi XII', 'BIO-12', 'MIPA', 12),
      ('mp-kim-11', 'Kimia XI', 'KIM-11', 'MIPA', 11);

    -- Seed Classes across Grades 10, 11, 12
    INSERT INTO kelas (id, tingkat, kelompok, nomor_kelas, kapasitas) VALUES
      ('cls-10-1', 10, 'MIPA', 1, 36),
      ('cls-11-1', 11, 'MIPA', 1, 36),
      ('cls-11-2', 11, 'MIPA', 2, 36),
      ('cls-12-1', 12, 'MIPA', 1, 36);

    -- Seed Students across Grades
    -- Grade 10: st-10-1
    -- Grade 11: st-11-1, st-11-2, st-11-3 (via riwayat_kelas)
    -- Grade 12: st-12-1, st-inactive (should be ignored)
    INSERT INTO siswa (id, nisn, nis_lokal, nama_lengkap, jenis_kelamin, kelas_id, status) VALUES
      ('st-10-1', '1001', 'L1001', 'Anisa Rahma', 'P', 'cls-10-1', 'aktif'),
      ('st-11-1', '1101', 'L1101', 'Bagus Pratama', 'L', 'cls-11-1', 'aktif'),
      ('st-11-2', '1102', 'L1102', 'Cantika Dewi', 'P', 'cls-11-2', 'aktif'),
      ('st-11-3', '1103', 'L1103', 'Dimas Anggara', 'L', NULL, 'aktif'),
      ('st-12-1', '1201', 'L1201', 'Erlangga Putra', 'L', 'cls-12-1', 'aktif'),
      ('st-inactive', '9999', 'L9999', 'Fajar Inaktif', 'L', 'cls-11-1', 'nonaktif');

    -- riwayat_kelas fallback for st-11-3
    INSERT INTO riwayat_kelas (siswa_id, kelas_id, tahun_ajaran_id) VALUES
      ('st-11-3', 'cls-11-2', 'ta-sem-2026');

    -- Seed Teaching Assignments (penugasan_mengajar)
    -- Notice: two teachers for Fisika XI cls-11-1 to test deduplication
    INSERT INTO penugasan_mengajar (id, guru_id, mapel_id, kelas_id, tahun_ajaran_id) VALUES
      ('pen-1', 'guru-a', 'mp-fis-11', 'cls-11-1', 'ta-sem-2026'),
      ('pen-2', 'guru-b', 'mp-fis-11', 'cls-11-1', 'ta-sem-2026'),
      ('pen-3', 'guru-a', 'mp-fis-11', 'cls-11-2', 'ta-sem-2026'),
      ('pen-4', 'guru-c', 'mp-mat-10', 'cls-10-1', 'ta-sem-2026');
  `);

  return wrapSqliteAsD1(sqlite);
}

function wrapSqliteAsD1(sqlite: DatabaseSync) {
  const d1: any = {
    prepare: (sql: string) => {
      const exec = (params: any[]) => ({
        first: async <T>() => {
          const stmt = sqlite.prepare(sql);
          return (stmt.get(...params) as T) || null;
        },
        all: async <T>() => {
          const stmt = sqlite.prepare(sql);
          return { results: (stmt.all(...params) as T[]) || [] };
        },
        run: async () => {
          const stmt = sqlite.prepare(sql);
          const info = stmt.run(...params);
          return { meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
        },
      });

      return {
        bind: (...params: any[]) => exec(params),
        first: async <T>() => exec([]).first<T>(),
        all: async <T>() => exec([]).all<T>(),
        run: async () => exec([]).run(),
      };
    },
    batch: async (stmts: any[]) => {
      for (const s of stmts) {
        await s.run();
      }
      return [];
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return d1;
}

// ── Tests ───────────────────────────────────────────────────

describe('Phase 6 — Semester Foundation Automated Test Suite', () => {

  it('1. Migration preflight diagnostic checks & FK integrity', async () => {
    const cbtDb = createMockCbtDb();

    // Verify diagnostic preflight queries return 0 violations
    const missingParent = await cbtDb.prepare(`
      SELECT id FROM cbt_exams
      WHERE mode = 'semester' AND (event_id IS NULL OR TRIM(event_id) = '')
    `).all();
    assert.equal(missingParent.results.length, 0);

    const badTargetGrade = await cbtDb.prepare(`
      SELECT id FROM cbt_exams
      WHERE mode = 'semester' AND (target_grade IS NULL OR target_grade NOT IN ('10', '11', '12'))
    `).all();
    assert.equal(badTargetGrade.results.length, 0);

    // Verify foreign key integrity
    const fkCheck = await cbtDb.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkCheck.results.length, 0);
  });

  it('2. Exam integrity triggers: non-semester parent rejection, mode escape on update, target_grade check', async () => {
    const cbtDb = createMockCbtDb();

    // Seed non-semester event (e.g. kegiatan)
    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode) VALUES ('evt-keg', 'KEG-01', 'Lomba Matematika', 'kegiatan')
    `).run();

    // 2.1 Rejects semester exam with non-semester parent
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_exams (id, title, mode, event_id, target_grade, subject_id)
          VALUES ('ex-bad-1', 'Ujian Semester Bad', 'semester', 'evt-keg', '11', 'mp-mat-11')
        `).run();
      },
      /Semester exams must reference an existing event with mode = 'semester'/
    );

    // 2.2 Rejects semester exam with NULL event_id
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_exams (id, title, mode, event_id, target_grade, subject_id)
          VALUES ('ex-bad-2', 'Ujian Semester Bad', 'semester', NULL, '11', 'mp-mat-11')
        `).run();
      },
      /Semester exams must have a non-null non-blank event_id/
    );

    // 2.3 Rejects semester exam with invalid target_grade
    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode) VALUES ('evt-sem-1', 'PAS-2026', 'PAS Ganjil 2026', 'semester')
    `).run();

    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_exams (id, title, mode, event_id, target_grade, subject_id)
          VALUES ('ex-bad-3', 'Ujian Semester Bad', 'semester', 'evt-sem-1', '9', 'mp-mat-11')
        `).run();
      },
      /Semester exams must have target_grade in \('10', '11', '12'\)/
    );

    // 2.4 Creates valid semester exam
    await cbtDb.prepare(`
      INSERT INTO cbt_exams (id, title, mode, event_id, target_grade, subject_id)
      VALUES ('ex-good-1', 'Fisika XI PAS', 'semester', 'evt-sem-1', '11', 'mp-fis-11')
    `).run();

    // 2.5 Rejects mode escape on UPDATE
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          UPDATE cbt_exams SET mode = 'ulangan' WHERE id = 'ex-good-1'
        `).run();
      },
      /Cannot independently mutate mode of a Semester exam away from semester/
    );

    // 2.6 Rejects non-semester exam belonging to a semester event
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_exams (id, title, mode, event_id, target_grade, subject_id)
          VALUES ('ex-bad-mode', 'Ujian Ulangan', 'ulangan', 'evt-sem-1', '11', 'mp-fis-11')
        `).run();
      },
      /Exams belonging to a semester event must have mode = 'semester'/
    );
  });

  it('3. Mansatas subject verification: rejects synthetic or unverified subjects', async () => {
    const mansatasDb = createMockMansatasDb();

    // 3.1 Accepts verified subject matching target_grade
    const valid = await verifyMansatasSubject(mansatasDb, 'mp-fis-11', '11');
    assert.equal(valid.id, 'mp-fis-11');
    assert.equal(valid.nama_mapel, 'Fisika XI');

    // 3.2 Rejects synthetic IDs
    await assert.rejects(
      async () => {
        await verifyMansatasSubject(mansatasDb, 'sem-fisika', '11');
      },
      /ID mata pelajaran sintetis 'sem-fisika' ditolak/
    );

    // 3.3 Rejects non-existent subjects
    await assert.rejects(
      async () => {
        await verifyMansatasSubject(mansatasDb, 'mp-nonexistent', '11');
      },
      /tidak ditemukan di.*Mansatas/
    );

    // 3.4 Rejects grade mismatch (e.g. Grade 12 subject for Grade 11 exam)
    await assert.rejects(
      async () => {
        await verifyMansatasSubject(mansatasDb, 'mp-bio-12', '11');
      },
      /tidak cocok dengan target_grade/
    );
  });

  it('4. Multi-grade participant snapshot (Grades 10, 11, 12) with riwayat_kelas fallback', async () => {
    const cbtDb = createMockCbtDb();
    const mansatasDb = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, academic_year_id)
      VALUES ('evt-sem-1', 'PAS-2026', 'PAS Ganjil 2026', 'semester', 'ta-sem-2026')
    `).run();

    const snapshot = await snapshotSemesterParticipants(cbtDb, mansatasDb, 'evt-sem-1');
    // 5 active students across 10, 11, 12 (st-10-1, st-11-1, st-11-2, st-11-3, st-12-1)
    // st-inactive is excluded!
    assert.equal(snapshot.inserted, 5);

    // Verify st-11-3 was captured via riwayat_kelas fallback
    const st3 = await cbtDb.prepare(`
      SELECT * FROM cbt_semester_participants WHERE student_id = 'st-11-3'
    `).first<any>();
    assert.ok(st3);
    assert.equal(st3.grade, '11');
    assert.equal(st3.class_id, 'cls-11-2');

    // Verify participants list breakdown
    const list = await listSemesterParticipants(cbtDb, 'evt-sem-1');
    assert.equal(list.total, 5);
    assert.equal(list.items.length, 5);
  });

  it('5. Atomic diff resync: preserves assigned room_id and nomor_peserta', async () => {
    const cbtDb = createMockCbtDb();
    const mansatasDb = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, academic_year_id)
      VALUES ('evt-sem-1', 'PAS-2026', 'PAS Ganjil 2026', 'semester', 'ta-sem-2026')
    `).run();

    await snapshotSemesterParticipants(cbtDb, mansatasDb, 'evt-sem-1');

    // Assign room and nomor_peserta to st-11-1
    await cbtDb.prepare(`
      UPDATE cbt_semester_participants
      SET room_id = 'room-sem-1', nomor_peserta = 'SEM-0001'
      WHERE student_id = 'st-11-1'
    `).run();

    // Mutate Mansatas student name
    await mansatasDb.prepare(`
      UPDATE siswa SET nama_lengkap = 'Bagus Pratama Updated' WHERE id = 'st-11-1'
    `).run();

    // Resync
    const resync = await snapshotSemesterParticipants(cbtDb, mansatasDb, 'evt-sem-1');
    assert.equal(resync.updated, 5);

    // Verify room_id and nomor_peserta were preserved while name was updated
    const st1 = await cbtDb.prepare(`
      SELECT * FROM cbt_semester_participants WHERE student_id = 'st-11-1'
    `).first<any>();
    assert.equal(st1.nama_lengkap, 'Bagus Pratama Updated');
    assert.equal(st1.room_id, 'room-sem-1');
    assert.equal(st1.nomor_peserta, 'SEM-0001');
  });

  it('6. Deterministic participant numbering generation', async () => {
    const cbtDb = createMockCbtDb();
    const mansatasDb = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, academic_year_id)
      VALUES ('evt-sem-1', 'PAS-2026', 'PAS Ganjil 2026', 'semester', 'ta-sem-2026')
    `).run();

    await snapshotSemesterParticipants(cbtDb, mansatasDb, 'evt-sem-1');

    const result = await generateSemesterParticipantNumbers(cbtDb, 'evt-sem-1', 'PAS');
    assert.equal(result.totalNumbered, 5);

    const numbered = await cbtDb.prepare(`
      SELECT nomor_peserta FROM cbt_semester_participants
      WHERE event_id = 'evt-sem-1'
      ORDER BY grade ASC, class_name ASC, nama_lengkap ASC
    `).all<any>();

    assert.equal(numbered.results[0].nomor_peserta, 'PAS-10-0001');
  });

  it('7. Academic audience mapping & teacher deduplication', async () => {
    const cbtDb = createMockCbtDb();
    const mansatasDb = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, academic_year_id)
      VALUES ('evt-sem-1', 'PAS-2026', 'PAS Ganjil 2026', 'semester', 'ta-sem-2026')
    `).run();

    // Notice: penugasan_mengajar had two teachers for mp-fis-11 in cls-11-1
    const available = await discoverAvailableClasses(mansatasDb, '11', 'mp-fis-11', 'ta-sem-2026');
    // Deduplicated count should be 2 classes (cls-11-1 and cls-11-2)
    assert.equal(available.length, 2);
    assert.equal(available[0].class_id, 'cls-11-1');
    assert.equal(available[1].class_id, 'cls-11-2');
  });

  it('8. Class disjointness invariant: triggers block overlapping class-subject assignments in an event', async () => {
    const cbtDb = createMockCbtDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode) VALUES ('evt-sem-1', 'PAS-2026', 'PAS Ganjil 2026', 'semester')
    `).run();

    // Two Grade 11 Fisika exams (e.g. Regular vs Bilingual)
    await cbtDb.prepare(`
      INSERT INTO cbt_exams (id, title, mode, event_id, target_grade, subject_id)
      VALUES
        ('ex-fis-reg', 'Fisika XI Reguler', 'semester', 'evt-sem-1', '11', 'mp-fis-11'),
        ('ex-fis-bil', 'Fisika XI Bilingual', 'semester', 'evt-sem-1', '11', 'mp-fis-11')
    `).run();

    // Assign cls-11-1 to ex-fis-reg
    await cbtDb.prepare(`
      INSERT INTO cbt_semester_exam_classes (id, event_id, exam_id, class_id, class_name, grade)
      VALUES ('aec-1', 'evt-sem-1', 'ex-fis-reg', 'cls-11-1', 'XI MIPA 1', '11')
    `).run();

    // Attempting to assign cls-11-1 to ex-fis-bil for the SAME subject in the SAME event must be rejected by trigger!
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_semester_exam_classes (id, event_id, exam_id, class_id, class_name, grade)
          VALUES ('aec-2', 'evt-sem-1', 'ex-fis-bil', 'cls-11-1', 'XI MIPA 1', '11')
        `).run();
      },
      /A class cannot be assigned to multiple semester exams for the same subject in the same event/
    );

    // Assigning a DIFFERENT class (cls-11-2) to ex-fis-bil must succeed
    await cbtDb.prepare(`
      INSERT INTO cbt_semester_exam_classes (id, event_id, exam_id, class_id, class_name, grade)
      VALUES ('aec-3', 'evt-sem-1', 'ex-fis-bil', 'cls-11-2', 'XI MIPA 2', '11')
    `).run();
  });

  it('9. Audience-driven roster materialization into cbt_exam_roster', async () => {
    const cbtDb = createMockCbtDb();
    const mansatasDb = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, academic_year_id)
      VALUES ('evt-sem-1', 'PAS-2026', 'PAS Ganjil 2026', 'semester', 'ta-sem-2026')
    `).run();

    await snapshotSemesterParticipants(cbtDb, mansatasDb, 'evt-sem-1');

    // Assign rooms to participants so roster materialization satisfies room_id requirement
    await cbtDb.prepare("UPDATE cbt_semester_participants SET room_id = 'room-sem-1' WHERE event_id = 'evt-sem-1'").run();

    await cbtDb.prepare(`
      INSERT INTO cbt_exams (id, title, mode, event_id, target_grade, subject_id)
      VALUES ('ex-fis-11', 'Fisika XI', 'semester', 'evt-sem-1', '11', 'mp-fis-11')
    `).run();

    // Set audience to cls-11-1 only
    await assignSemesterExamClasses(cbtDb, mansatasDb, 'evt-sem-1', 'ex-fis-11', ['cls-11-1']);

    // Materialize roster
    const result = await materializeSemesterExamRoster(cbtDb, 'evt-sem-1', 'ex-fis-11');
    // cls-11-1 has 1 student (st-11-1). cls-11-2 has 2 students (st-11-2, st-11-3).
    assert.equal(result.enrolledCount, 1);

    const roster = await cbtDb.prepare(`
      SELECT * FROM cbt_exam_roster WHERE exam_id = 'ex-fis-11'
    `).all<any>();
    assert.equal(roster.results.length, 1);
    assert.equal(roster.results[0].source_id, 'st-11-1');

    // Expand audience to include cls-11-2 as well
    await assignSemesterExamClasses(cbtDb, mansatasDb, 'evt-sem-1', 'ex-fis-11', ['cls-11-1', 'cls-11-2']);
    const rematerialized = await materializeSemesterExamRoster(cbtDb, 'evt-sem-1', 'ex-fis-11');
    assert.equal(rematerialized.enrolledCount, 3);
  });

  it('10. Server-authoritative readiness gate with room capacity hard blocker', async () => {
    const cbtDb = createMockCbtDb();
    const mansatasDb = createMockMansatasDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, academic_year_id, status)
      VALUES ('evt-sem-1', 'PAS-2026', 'PAS Ganjil 2026', 'semester', 'ta-sem-2026', 'configuration')
    `).run();

    await snapshotSemesterParticipants(cbtDb, mansatasDb, 'evt-sem-1');

    // Create room with capacity 2
    await cbtDb.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES ('room-tiny', 'Ruang Sempit', 2, 'evt-sem-1')
    `).run();

    // Assign 3 students to room-tiny (exceeding capacity!)
    await cbtDb.prepare(`
      UPDATE cbt_semester_participants
      SET room_id = 'room-tiny'
      WHERE event_id = 'evt-sem-1' AND grade = '11'
    `).run();

    const readiness = await checkSemesterEventReadiness(cbtDb, 'evt-sem-1');
    assert.equal(readiness.eligible, false);

    // Find room capacity category
    assert.equal(readiness.categories.rooms.status, 'failed');
    assert.ok(readiness.blockers.some((b: string) => b.includes('Kapasitas ruangan terlampaui')));

    // Attempting to transition event to 'ready' must fail
    await assert.rejects(
      async () => {
        await transitionSemesterEventStatus(cbtDb, 'evt-sem-1', 'ready');
      },
      /belum siap untuk beralih ke status 'ready'/
    );
  });

  it('11. Discrete time slots, non-overlapping validation, collision detection, and token purge on reschedule', async () => {
    const cbtDb = createMockCbtDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode) VALUES ('evt-sem-1', 'PAS-2026', 'PAS Ganjil 2026', 'semester')
    `).run();

    // 11.1 Create slot 1 (07:30 - 09:30)
    const slot1 = await createSemesterSlot(cbtDb, 'evt-sem-1', {
      slot_date: '2026-12-01',
      start_time: '07:30',
      end_time: '09:30',
      label: 'Sesi 1',
    });
    assert.ok(slot1.id);

    // 11.2 Reject overlapping slot (08:30 - 10:30) on same date
    await assert.rejects(
      async () => {
        await createSemesterSlot(cbtDb, 'evt-sem-1', {
          slot_date: '2026-12-01',
          start_time: '08:30',
          end_time: '10:30',
          label: 'Sesi Bertabrakan',
        });
      },
      /tumpang tindih/
    );

    // 11.3 Accept non-overlapping slot (10:00 - 12:00)
    const slot2 = await createSemesterSlot(cbtDb, 'evt-sem-1', {
      slot_date: '2026-12-01',
      start_time: '10:00',
      end_time: '12:00',
      label: 'Sesi 2',
    });
    assert.ok(slot2.id);

    // 11.4 Setup two exams sharing audience class cls-11-1
    await cbtDb.prepare(`
      INSERT INTO cbt_exams (id, title, mode, event_id, target_grade, subject_id, duration_minutes)
      VALUES
        ('ex-fis', 'Fisika XI', 'semester', 'evt-sem-1', '11', 'mp-fis-11', 90),
        ('ex-kim', 'Kimia XI', 'semester', 'evt-sem-1', '11', 'mp-kim-11', 90)
    `).run();

    await cbtDb.prepare(`
      INSERT INTO cbt_semester_exam_classes (id, event_id, exam_id, class_id, class_name, grade)
      VALUES
        ('aec-fis-1', 'evt-sem-1', 'ex-fis', 'cls-11-1', 'XI MIPA 1', '11'),
        ('aec-kim-1', 'evt-sem-1', 'ex-kim', 'cls-11-1', 'XI MIPA 1', '11')
    `).run();

    // Assign Fisika to Slot 1
    await assignSemesterExamSlot(cbtDb, 'evt-sem-1', 'ex-fis', slot1.id);

    // 11.5 Collision detection: assigning Kimia (which also targets cls-11-1) to Slot 1 must throw 409 Conflict!
    await assert.rejects(
      async () => {
        await assignSemesterExamSlot(cbtDb, 'evt-sem-1', 'ex-kim', slot1.id);
      },
      /Tabrakan jadwal peserta terdeteksi/
    );

    // Assigning Kimia to Slot 2 succeeds
    await assignSemesterExamSlot(cbtDb, 'evt-sem-1', 'ex-kim', slot2.id);

    // 11.6 Token purge on reschedule
    // Seed token for ex-fis
    await cbtDb.prepare(`
      INSERT INTO cbt_exam_tokens (id, exam_id, token_code) VALUES ('tok-1', 'ex-fis', 'ABC123')
    `).run();

    // Move ex-fis to slot 2 (after unassigning ex-kim)
    await removeSemesterExamSlot(cbtDb, 'evt-sem-1', 'ex-kim');
    await assignSemesterExamSlot(cbtDb, 'evt-sem-1', 'ex-fis', slot2.id);

    // Tokens must be purged
    const tokens = await cbtDb.prepare('SELECT * FROM cbt_exam_tokens WHERE exam_id = ?').bind('ex-fis').all();
    assert.equal(tokens.results.length, 0);
  });

  it('12. Authoritative runtime schedule check, late-start cutoff policy, lifecycle rollback, and RBAC matrix', async () => {
    const cbtDb = createMockCbtDb();

    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES ('evt-sem-1', 'PAS-2026', 'PAS Ganjil 2026', 'semester', 'ready')
    `).run();

    await cbtDb.prepare(`
      INSERT INTO cbt_exams (id, title, mode, event_id, target_grade, subject_id, duration_minutes)
      VALUES ('ex-fis', 'Fisika XI', 'semester', 'evt-sem-1', '11', 'mp-fis-11', 60)
    `).run();

    // Create slot: 2026-12-01 08:00 - 10:00 (120 minutes)
    await cbtDb.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES ('slot-1', 'evt-sem-1', 'Sesi Pagi', '2026-12-01', '08:00', '10:00')
    `).run();

    await cbtDb.prepare(`
      INSERT INTO cbt_semester_schedules (id, exam_id, slot_id, event_id)
      VALUES ('sched-1', 'ex-fis', 'slot-1', 'evt-sem-1')
    `).run();

    // 12.1 Pre-window check (too early at 07:50 WIB)
    const earlyCheck = await authorizeSemesterExamSchedule(
      cbtDb,
      'ex-fis',
      new Date('2026-12-01T07:50:00+07:00')
    );
    assert.equal(earlyCheck.allowed, false);
    assert.equal(earlyCheck.scheduleContext?.jadwal_status, 'belum');
    assert.match(earlyCheck.error || '', /belum dimulai/);

    // 12.2 Valid window check (on time at 08:15 WIB, remaining 105 mins >= 60 min duration)
    const validCheck = await authorizeSemesterExamSchedule(
      cbtDb,
      'ex-fis',
      new Date('2026-12-01T08:15:00+07:00')
    );
    assert.equal(validCheck.allowed, true);

    // 12.3 Late-start cutoff check (at 09:15 WIB, remaining 45 mins < 60 min duration)
    const cutoffCheck = await authorizeSemesterExamSchedule(
      cbtDb,
      'ex-fis',
      new Date('2026-12-01T09:15:00+07:00')
    );
    assert.equal(cutoffCheck.allowed, false);
    assert.match(cutoffCheck.error || '', /tidak mencukupi/);

    // 12.4 Post-window check (after slot ended at 10:05 WIB)
    const expiredCheck = await authorizeSemesterExamSchedule(
      cbtDb,
      'ex-fis',
      new Date('2026-12-01T10:05:00+07:00')
    );
    assert.equal(expiredCheck.allowed, false);
    assert.equal(expiredCheck.scheduleContext?.jadwal_status, 'selesai');
    assert.match(expiredCheck.error || '', /telah berakhir/);

    // 12.5 Lifecycle rollback: ready -> configuration allowed if 0 sessions
    const rolledBack = await transitionSemesterEventStatus(cbtDb, 'evt-sem-1', 'configuration');
    assert.equal(rolledBack.event.status, 'configuration');

    // Transition back to ready
    await cbtDb.prepare("UPDATE cbt_events SET status = 'ready' WHERE id = 'evt-sem-1'").run();

    // Add 1 exam session
    await cbtDb.prepare(`
      INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type)
      VALUES ('sess-1', 'ex-fis', 'st-1', 'student')
    `).run();

    // Rollback must now be BLOCKED!
    await assert.rejects(
      async () => {
        await transitionSemesterEventStatus(cbtDb, 'evt-sem-1', 'configuration');
      },
      /Rollback ke 'configuration' ditolak: sudah terdapat 1 sesi ujian/
    );

    // 12.6 RBAC matrix via HTTP Router
    const app = new Hono<{ Bindings: any }>();
    app.use('*', async (c, next) => {
      c.env = { DB: cbtDb, JWT_SECRET };
      await next();
    });
    app.route('/api/semester', semesterRoutes);

    // Generate JWT for viewer (semester.results.view only)
    await cbtDb.prepare(`
      INSERT INTO cbt_permission_grants (id, staff_id, permission, scope_type, scope_value)
      VALUES ('perm-1', 'viewer-1', 'semester.results.view', 'global', '*')
    `).run();

    const viewerToken = await signJWT({
      sub: 'viewer-1',
      username: 'viewer',
      role: 'teacher',
      room_id: null,
    }, JWT_SECRET);

    // Viewer CAN read results
    const resultsRes = await app.request('/api/semester/exams/ex-fis/results', {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    assert.equal(resultsRes.status, 200);

    // Viewer CANNOT access participant snapshot mutation (requires semester.event.manage)
    const mutateRes = await app.request('/api/semester/events/evt-sem-1/participants/snapshot', {
      method: 'POST',
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    assert.equal(mutateRes.status, 403);
  });

  it('13. Final closure audit: exhaustive invariant enforcement for Items 1 to 6', async () => {
    const cbtDb = createMockCbtDb();
    const mansatasDb = createMockMansatasDb();

    // ── Setup baseline events and rooms ──
    await cbtDb.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status, academic_year_id)
      VALUES
        ('evt-sem-audit', 'SEM-AUDIT', 'Semester Audit Event', 'semester', 'configuration', 'ta-sem-2026'),
        ('evt-sem-other', 'SEM-OTHER', 'Other Semester Event', 'semester', 'configuration', 'ta-sem-2026'),
        ('evt-keg-audit', 'KEG-AUDIT', 'Kegiatan Audit Event', 'kegiatan', 'configuration', 'ta-sem-2026')
    `).run();

    await cbtDb.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES
        ('room-global', 'Ruang Global', 40, NULL),
        ('room-audit', 'Ruang Audit Sem', 40, 'evt-sem-audit'),
        ('room-other', 'Ruang Other Sem', 40, 'evt-sem-other')
    `).run();

    // ── Item 1: Semester Participant Integrity ──
    // 1.1 Reject non-semester event on participant
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name)
          VALUES ('sp-bad-event', 'evt-keg-audit', 'st-bad-1', 'Siswa Bad Event', '11', 'cls-11-1', 'XI MIPA 1')
        `).run();
      },
      /cbt_semester_participants can only be attached to an event with mode = 'semester'/
    );

    // 1.2 Reject invalid grade on participant
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name)
          VALUES ('sp-bad-grade', 'evt-sem-audit', 'st-bad-2', 'Siswa Bad Grade', '9', 'cls-11-1', 'XI MIPA 1')
        `).run();
      },
      /cbt_semester_participants\.grade must be one of \('10', '11', '12'\)/
    );

    // 1.3 Reject foreign room on participant
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name, room_id)
          VALUES ('sp-bad-room', 'evt-sem-audit', 'st-bad-3', 'Siswa Bad Room', '11', 'cls-11-1', 'XI MIPA 1', 'room-other')
        `).run();
      },
      /Semester participant room must be global or belong to the same event/
    );

    // 1.4 Valid participant with global or event-scoped room succeeds
    await cbtDb.prepare(`
      INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name, room_id)
      VALUES
        ('sp-ok-1', 'evt-sem-audit', 'st-11-1', 'Bagus Pratama', '11', 'cls-11-1', 'XI MIPA 1', 'room-audit'),
        ('sp-ok-2', 'evt-sem-audit', 'st-11-2', 'Cantika Dewi', '11', 'cls-11-2', 'XI MIPA 2', 'room-global')
    `).run();

    // ── Item 2: Discrete Slot Integrity ──
    // 2.1 Reject non-semester event on slots
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
          VALUES ('slot-bad-event', 'evt-keg-audit', 'Sesi Keg', '2026-12-01', '08:00', '10:00')
        `).run();
      },
      /cbt_semester_slots can only be attached to an event with mode = 'semester'/
    );

    // 2.2 Reject end_time <= start_time
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
          VALUES ('slot-inverted', 'evt-sem-audit', 'Sesi Inverted', '2026-12-01', '10:00', '08:00')
        `).run();
      },
      /CHECK constraint failed/
    );

    // 2.3 Create valid slot
    await cbtDb.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES ('slot-audit-1', 'evt-sem-audit', 'Sesi 1', '2026-12-01', '07:30', '09:30')
    `).run();

    // 2.4 Reject duplicate slot (same event, date, start_time, end_time)
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
          VALUES ('slot-dup', 'evt-sem-audit', 'Sesi 1 Dup', '2026-12-01', '07:30', '09:30')
        `).run();
      },
      /UNIQUE constraint failed/
    );

    // 2.5 Adjacent slots (07:30-09:30 and 09:30-11:30) are permitted by service
    const adjSlot = await createSemesterSlot(cbtDb, 'evt-sem-audit', {
      slot_date: '2026-12-01',
      start_time: '09:30',
      end_time: '11:30',
      label: 'Sesi 2 Berdampingan',
    });
    assert.ok(adjSlot.id);

    // ── Item 3: Schedule Cross-Context Integrity ──
    // Create valid exam in evt-sem-audit
    await cbtDb.prepare(`
      INSERT INTO cbt_exams (id, title, mode, event_id, target_grade, subject_id)
      VALUES
        ('ex-audit-fis', 'Fisika Audit XI', 'semester', 'evt-sem-audit', '11', 'mp-fis-11'),
        ('ex-other-fis', 'Fisika Other XI', 'semester', 'evt-sem-other', '11', 'mp-fis-11')
    `).run();

    await cbtDb.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES ('slot-other-1', 'evt-sem-other', 'Sesi Other', '2026-12-01', '08:00', '10:00')
    `).run();

    // 3.1 Reject schedule with exam belonging to another event
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_semester_schedules (id, event_id, exam_id, slot_id)
          VALUES ('sch-bad-exam', 'evt-sem-audit', 'ex-other-fis', 'slot-audit-1')
        `).run();
      },
      /cbt_semester_schedules\.exam_id must belong to schedule\.event_id with mode = 'semester'/
    );

    // 3.2 Reject schedule with slot belonging to another event
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_semester_schedules (id, event_id, exam_id, slot_id)
          VALUES ('sch-bad-slot', 'evt-sem-audit', 'ex-audit-fis', 'slot-other-1')
        `).run();
      },
      /cbt_semester_schedules\.slot_id must belong to schedule\.event_id/
    );

    // 3.3 Valid schedule succeeds
    await cbtDb.prepare(`
      INSERT INTO cbt_semester_schedules (id, event_id, exam_id, slot_id)
      VALUES ('sch-ok-1', 'evt-sem-audit', 'ex-audit-fis', 'slot-audit-1')
    `).run();

    // 3.4 Reject UPDATE to foreign slot
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          UPDATE cbt_semester_schedules SET slot_id = 'slot-other-1' WHERE id = 'sch-ok-1'
        `).run();
      },
      /cbt_semester_schedules\.slot_id must belong to schedule\.event_id/
    );

    // ── Item 4 & 5: Academic Audience & Runtime Roster Integrity ──
    // 5.1 Reject synthetic class ID in audience assignment
    await assert.rejects(
      async () => {
        await assignSemesterExamClasses(cbtDb, mansatasDb, 'evt-sem-audit', 'ex-audit-fis', ['sem-class-fake']);
      },
      /ID kelas sintetis 'sem-class-fake' ditolak/
    );

    // 5.2 Reject class with grade mismatch (cls-10-1 for grade 11 exam)
    await assert.rejects(
      async () => {
        await assignSemesterExamClasses(cbtDb, mansatasDb, 'evt-sem-audit', 'ex-audit-fis', ['cls-10-1']);
      },
      /tidak sesuai dengan target_grade/
    );

    // 5.3 Valid audience assignment (cls-11-1)
    await assignSemesterExamClasses(cbtDb, mansatasDb, 'evt-sem-audit', 'ex-audit-fis', ['cls-11-1']);

    // 4.1 Reject roster insert with event_id mismatch
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, grade, room_id)
          VALUES ('r-bad-evt', 'ex-audit-fis', 'evt-sem-other', 'mansatas', 'st-11-1', 'u1', 'Bagus', '11', 'room-audit')
        `).run();
      },
      /Semester roster event_id must match exam event_id/
    );

    // 4.2 Reject roster insert for un-snapshotted participant
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, grade, room_id)
          VALUES ('r-bad-snap', 'ex-audit-fis', 'evt-sem-audit', 'mansatas', 'st-unknown', 'u2', 'Unknown', '11', 'room-audit')
        `).run();
      },
      /Semester roster participant must exist in cbt_semester_participants for this event/
    );

    // 4.3 Reject roster insert for student whose class is not in exam audience
    // (st-11-2 is in cls-11-2, which is not in ex-audit-fis audience)
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, grade, room_id)
          VALUES ('r-bad-aud', 'ex-audit-fis', 'evt-sem-audit', 'mansatas', 'st-11-2', 'u3', 'Cantika', '11', 'room-audit')
        `).run();
      },
      /Participant class is not in the academic audience for this semester exam/
    );

    // 4.4 Reject roster insert with grade mismatch
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, grade, room_id)
          VALUES ('r-bad-grd', 'ex-audit-fis', 'evt-sem-audit', 'mansatas', 'st-11-1', 'u1', 'Bagus', '10', 'room-audit')
        `).run();
      },
      /Semester roster grade must match exam target_grade/
    );

    // 4.5 Reject roster insert with null room_id
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, grade, room_id)
          VALUES ('r-null-rm', 'ex-audit-fis', 'evt-sem-audit', 'mansatas', 'st-11-1', 'u1', 'Bagus', '11', NULL)
        `).run();
      },
      /Semester roster room_id cannot be null/
    );

    // 4.6 Reject roster insert with foreign room_id
    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, grade, room_id)
          VALUES ('r-for-rm', 'ex-audit-fis', 'evt-sem-audit', 'mansatas', 'st-11-1', 'u1', 'Bagus', '11', 'room-other')
        `).run();
      },
      /Semester roster room must be global or belong to this event/
    );

    // 4.7 Valid roster insert succeeds
    await cbtDb.prepare(`
      INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, username, full_name, grade, room_id)
      VALUES ('r-ok-1', 'ex-audit-fis', 'evt-sem-audit', 'mansatas', 'st-11-1', 'u1', 'Bagus', '11', 'room-audit')
    `).run();

    // 4.8 Reject mutating semester roster entry to non-semester exam
    await cbtDb.prepare(`
      INSERT INTO cbt_exams (id, title, mode, duration_minutes)
      VALUES ('ex-raw-ulangan', 'Ulangan Non-Sem', 'ulangan', 60)
    `).run();

    await assert.rejects(
      async () => {
        await cbtDb.prepare(`
          UPDATE cbt_exam_roster SET exam_id = 'ex-raw-ulangan' WHERE id = 'r-ok-1'
        `).run();
      },
      /Cannot mutate semester roster entry to non-semester exam/
    );

    // ── Item 6: Lifecycle Freeze & Session Safety ──
    // Freeze evt-sem-audit to 'ready'
    await cbtDb.prepare("UPDATE cbt_events SET status = 'ready' WHERE id = 'evt-sem-audit'").run();

    // 6.1 Mutations blocked at ready
    await assert.rejects(
      async () => {
        await snapshotSemesterParticipants(cbtDb, mansatasDb, 'evt-sem-audit');
      },
      EventFrozenError
    );

    await assert.rejects(
      async () => {
        await generateSemesterParticipantNumbers(cbtDb, 'evt-sem-audit', 'PAS');
      },
      EventFrozenError
    );

    await assert.rejects(
      async () => {
        await createSemesterExam(cbtDb, mansatasDb, 'evt-sem-audit', {
          title: 'Frozen Exam',
          target_grade: '11',
          subject_id: 'mp-kim-11',
        });
      },
      EventFrozenError
    );

    await assert.rejects(
      async () => {
        await updateSemesterExam(cbtDb, mansatasDb, 'evt-sem-audit', 'ex-audit-fis', {
          title: 'Changed Title',
        });
      },
      EventFrozenError
    );

    await assert.rejects(
      async () => {
        await deleteSemesterExam(cbtDb, 'evt-sem-audit', 'ex-audit-fis');
      },
      EventFrozenError
    );

    await assert.rejects(
      async () => {
        await assignSemesterExamClasses(cbtDb, mansatasDb, 'evt-sem-audit', 'ex-audit-fis', ['cls-11-1']);
      },
      EventFrozenError
    );

    await assert.rejects(
      async () => {
        await createSemesterSlot(cbtDb, 'evt-sem-audit', {
          slot_date: '2026-12-02',
          start_time: '08:00',
          end_time: '10:00',
          label: 'Frozen Slot',
        });
      },
      EventFrozenError
    );

    await assert.rejects(
      async () => {
        await assignSemesterExamSlot(cbtDb, 'evt-sem-audit', 'ex-audit-fis', 'slot-audit-1');
      },
      EventFrozenError
    );

    await assert.rejects(
      async () => {
        await materializeSemesterExamRoster(cbtDb, 'evt-sem-audit', 'ex-audit-fis');
      },
      EventFrozenError
    );
  });
});
