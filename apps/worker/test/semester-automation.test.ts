// ============================================================
// Comprehensive Automated Test Suite for Phase 7:
// Semester Automation & Seating Distribution
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  acquireGenerationLock,
  releaseGenerationLock,
  invalidateDownstreamRevisions,
  logGenerationResult,
  getGenerationControl,
} from '../src/services/domains/semester/concurrency.ts';
import {
  autoAllocateRooms,
  setParticipantRoomLock,
  manualAssignParticipantRoom,
} from '../src/services/domains/semester/room-allocation.ts';
import {
  configureRoomLayout,
  getRoomLayout,
  getRoomSeats,
  autoDistributeSeats,
  manualAssignParticipantSeat,
  setSeatAssignmentLock,
  getRoomSeatAssignments,
} from '../src/services/domains/semester/seating.ts';
import {
  autoSolveTimetable,
  setScheduleLock,
} from '../src/services/domains/semester/timetable-solver.ts';
import {
  syncInvigilatorPoolFromStaff,
  listInvigilatorPool,
  addStaffBlackout,
  listStaffBlackouts,
  deleteStaffBlackout,
  autoAssignInvigilators,
  getInvigilatorAssignments,
} from '../src/services/domains/semester/invigilators.ts';
import {
  resolveProctorContext,
  getRoomSlotTokens,
  getRoomSlotSessions,
  unlockProctorSession,
  resetProctorSessionDevice,
  forceSubmitProctorSession,
} from '../src/services/domains/semester/proctor-auth.ts';
import { checkSemesterEventReadiness } from '../src/services/domains/semester/readiness.ts';
import { updateRoom } from '../src/services/exam-engine/rooms.ts';

// ── SQLite + D1 Mock Wrapper ─────────────────────────────────
function wrapSqliteAsD1(sqlite: DatabaseSync) {
  const d1: any = {
    prepare: (sql: string) => {
      const exec = (params: any[]) => {
        const clean = params.map((p) => (p === undefined ? null : p));
        return {
          first: async <T>() => {
            const stmt = sqlite.prepare(sql);
            return (stmt.get(...clean) as T) || null;
          },
          all: async <T>() => {
            const stmt = sqlite.prepare(sql);
            return { results: (stmt.all(...clean) as T[]) || [] };
          },
          run: async () => {
            const stmt = sqlite.prepare(sql);
            const info = stmt.run(...clean);
            return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
          },
        };
      };

      return {
        bind: (...params: any[]) => exec(params),
        first: async <T>() => exec([]).first<T>(),
        all: async <T>() => exec([]).all<T>(),
        run: async () => exec([]).run(),
      };
    },
    batch: async (stmts: any[]) => {
      const results = [];
      for (const s of stmts) {
        results.push(await s.run());
      }
      return results;
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
    _sqlite: sqlite,
  };
  return d1;
}

function createAutomationTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys = ON;`);
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

    CREATE TABLE cbt_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'guru',
      staff_id TEXT
    );

    CREATE TABLE cbt_staff_profiles (
      id TEXT PRIMARY KEY,
      nama TEXT NOT NULL,
      nip TEXT,
      email TEXT,
      mansatas_user_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
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
      target_grade TEXT CHECK (target_grade IS NULL OR target_grade IN ('10', '11', '12')),
      event_id TEXT REFERENCES cbt_events(id),
      subject_id TEXT,
      subject_name TEXT,
      mode TEXT CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_questions (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      question_order INTEGER NOT NULL DEFAULT 0,
      question_text TEXT NOT NULL,
      question_type TEXT DEFAULT 'multiple_choice',
      points REAL DEFAULT 1
    );

    CREATE TABLE cbt_question_options (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES cbt_questions(id) ON DELETE CASCADE,
      option_label TEXT NOT NULL,
      option_text TEXT NOT NULL,
      is_correct INTEGER DEFAULT 0
    );

    CREATE TABLE cbt_exam_roster (
      id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_id TEXT NOT NULL,
      username TEXT NOT NULL,
      full_name TEXT NOT NULL,
      class_name TEXT,
      grade TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      room_id TEXT,
      nomor_peserta TEXT,
      tanggal_tes TEXT NOT NULL DEFAULT '',
      sesi_tes TEXT NOT NULL DEFAULT '',
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
      gender TEXT CHECK (gender IS NULL OR gender IN ('L', 'P')),
      room_id TEXT REFERENCES cbt_rooms(id),
      nomor_peserta TEXT,
      is_room_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, student_id)
    );

    CREATE TABLE cbt_semester_slots (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      slot_label TEXT NOT NULL,
      slot_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      sequence_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, slot_date, start_time, end_time)
    );

    CREATE TABLE cbt_semester_schedules (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL REFERENCES cbt_semester_slots(id) ON DELETE CASCADE,
      is_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, exam_id),
      UNIQUE(slot_id, exam_id)
    );

    CREATE TABLE cbt_semester_exam_classes (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      class_id TEXT NOT NULL,
      class_name TEXT NOT NULL,
      grade TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(exam_id, class_id)
    );

    CREATE TABLE cbt_semester_generation_controls (
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

    CREATE TABLE cbt_semester_room_layouts (
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

    CREATE TABLE cbt_semester_seats (
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

    CREATE TABLE cbt_semester_seat_assignments (
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

    CREATE TABLE cbt_semester_rooms_staging (
      batch_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      is_locked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (batch_id, participant_id)
    );

    CREATE TABLE cbt_semester_seat_assignments_staging (
      batch_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      seat_id TEXT NOT NULL,
      is_locked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (batch_id, participant_id)
    );

    CREATE TABLE cbt_semester_invig_staging (
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

    CREATE TABLE cbt_semester_invigilator_pool (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      is_eligible INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(event_id, staff_id)
    );

    CREATE TABLE cbt_semester_staff_blackouts (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      staff_id TEXT NOT NULL,
      slot_id TEXT,
      blackout_date TEXT,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_semester_invigilator_assignments (
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

    CREATE TABLE cbt_semester_generation_logs (
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
      device_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      UNIQUE(exam_id, user_id, user_type)
    );

    -- Phase 7 DB Integrity Triggers
    CREATE TRIGGER trg_cbt_semester_participants_room_change_integrity
    BEFORE UPDATE OF room_id ON cbt_semester_participants
    WHEN OLD.room_id IS NOT NULL AND NEW.room_id IS NOT NULL AND OLD.room_id != NEW.room_id
    BEGIN
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM cbt_semester_seat_assignments sa
          WHERE sa.participant_id = OLD.id AND sa.is_locked = 1
        )
        THEN RAISE(ABORT, 'Cannot move participant room while assigned seat is locked. Unlock or remove the seat first.')
      END;
    END;

    CREATE TRIGGER trg_cbt_semester_seat_assignments_room_match
    BEFORE INSERT ON cbt_semester_seat_assignments
    BEGIN
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM cbt_semester_participants p
          WHERE p.id = NEW.participant_id AND p.room_id = NEW.room_id
        )
        THEN RAISE(ABORT, 'Participant must be assigned to the same room as the seat.')
        WHEN NOT EXISTS (
          SELECT 1 FROM cbt_semester_seats s
          WHERE s.id = NEW.seat_id AND s.room_id = NEW.room_id
        )
        THEN RAISE(ABORT, 'Seat must belong to the specified room.')
      END;
    END;

    CREATE TRIGGER trg_cbt_semester_seats_immutable_when_assigned
    BEFORE DELETE ON cbt_semester_seats
    BEGIN
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM cbt_semester_seat_assignments
          WHERE seat_id = OLD.id
        )
        THEN RAISE(ABORT, 'Cannot delete seat while an active assignment references it.')
      END;
    END;

    CREATE TRIGGER trg_cbt_semester_gen_logs_immutable_update
    BEFORE UPDATE ON cbt_semester_generation_logs
    BEGIN
      SELECT RAISE(ABORT, 'cbt_semester_generation_logs is immutable and cannot be updated');
    END;

    CREATE TRIGGER trg_cbt_semester_gen_logs_immutable_delete
    BEFORE DELETE ON cbt_semester_generation_logs
    BEGIN
      SELECT RAISE(ABORT, 'cbt_semester_generation_logs is immutable and cannot be deleted');
    END;

    CREATE TRIGGER trg_cbt_semester_schedules_locked_protect
    BEFORE UPDATE ON cbt_semester_schedules
    BEGIN
      SELECT CASE
        WHEN OLD.is_locked = 1 AND (OLD.slot_id != NEW.slot_id OR OLD.exam_id != NEW.exam_id OR OLD.event_id != NEW.event_id)
          THEN RAISE(ABORT, 'Transitioning schedule from locked to unlocked must be a pure unlock. Structural fields cannot be modified in the same operation.')
      END;
    END;

    CREATE TRIGGER trg_cbt_semester_seat_assign_integrity_update
    BEFORE UPDATE ON cbt_semester_seat_assignments
    BEGIN
      SELECT CASE
        WHEN OLD.is_locked = 1 AND (OLD.participant_id != NEW.participant_id OR OLD.room_id != NEW.room_id OR OLD.seat_id != NEW.seat_id)
          THEN RAISE(ABORT, 'Transitioning seat assignment from locked to unlocked must be a pure unlock. Structural fields cannot be modified in the same operation.')
      END;
    END;

    CREATE TRIGGER trg_cbt_semester_invig_integrity_update
    BEFORE UPDATE ON cbt_semester_invigilator_assignments
    BEGIN
      SELECT CASE
        WHEN OLD.is_locked = 1 AND (OLD.staff_id != NEW.staff_id OR OLD.slot_id != NEW.slot_id OR OLD.room_id != NEW.room_id OR OLD.invigilator_order != NEW.invigilator_order)
          THEN RAISE(ABORT, 'Transitioning invigilator assignment from locked to unlocked must be a pure unlock. Structural fields cannot be modified in the same operation.')
      END;
    END;

    CREATE TRIGGER trg_cbt_rooms_semester_capacity_integrity
    BEFORE UPDATE OF capacity ON cbt_rooms
    BEGIN
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM cbt_semester_room_layouts
          WHERE room_id = OLD.id AND layout_type = 'physical_configured' AND total_seats != NEW.capacity
        ) THEN RAISE(ABORT, 'Room capacity cannot differ from configured physical layout seats. Reconfigure layout first.')
        WHEN EXISTS (
          SELECT 1 FROM (
            SELECT COUNT(*) as cnt FROM cbt_semester_participants WHERE room_id = OLD.id GROUP BY event_id
          ) WHERE cnt > NEW.capacity
        ) THEN RAISE(ABORT, 'Room capacity cannot be reduced below the number of assigned participants.')
      END;
    END;
  `);

  return wrapSqliteAsD1(sqlite);
}

// ── Test Suites ──────────────────────────────────────────────

describe('Phase 7 — Semester Automation & Seating Distribution Test Suite', () => {

  it('1. Concurrency control: locks, race prevention, stale recovery, downstream invalidation', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-lock-test';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-LOCK-1', 'Semester Lock Test', 'semester', 'draft')
    `).bind(eventId).run();

    // Stage 1 lock acquisition
    const lock1 = await acquireGenerationLock(db, eventId, 'room_allocation', 'actor-admin-1');
    assert.equal(lock1.acquired, true);
    assert.ok(lock1.batchId);

    // Second lock attempt on same stage should be blocked
    const lock2 = await acquireGenerationLock(db, eventId, 'room_allocation', 'actor-admin-2');
    assert.equal(lock2.acquired, false);
    assert.match(lock2.error || '', /currently in progress/);

    // Downstream revision invalidation
    // Mutating room_allocation should invalidate seating and invigilators
    await invalidateDownstreamRevisions(db, eventId, 'room_allocation');
    const seatingCtrl = await getGenerationControl(db, eventId, 'seating');
    assert.equal(seatingCtrl?.revision, 2);

    // Release lock
    await releaseGenerationLock(db, eventId, 'room_allocation', lock1.batchId!, 'idle');
    const afterRelease = await getGenerationControl(db, eventId, 'room_allocation');
    assert.equal(afterRelease?.status, 'idle');
  });

  it('2. Room allocation automation: capacity check, strategy comparison, lock pin, and manual moves', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-rooms-test';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-ROOM-1', 'Semester Room Allocation Test', 'semester', 'draft')
    `).bind(eventId).run();

    // Seed 2 rooms with capacity 20 each (total capacity 40)
    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES ('rm-01', 'Ruang 01', 20, ?), ('rm-02', 'Ruang 02', 20, ?)
    `).bind(eventId, eventId).run();

    // Seed 30 participants (15 in Grade 10, 15 in Grade 11)
    for (let i = 1; i <= 30; i++) {
      const grade = i <= 15 ? '10' : '11';
      const className = i <= 15 ? 'X-1' : 'XI-1';
      await db.prepare(`
        INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name)
        VALUES (?, ?, ?, ?, ?, 'cls-1', ?)
      `).bind(`p-${i}`, eventId, `std-${i}`, `Siswa ${String(i).padStart(2, '0')}`, grade, className).run();
    }

    // Run automated room allocation with 'balanced' strategy
    const allocRes = await autoAllocateRooms(db, eventId, 'actor-admin-1', {
      strategy: 'balanced',
      prefix_room_names: false,
    });
    assert.equal(allocRes.success, true);
    assert.equal(allocRes.assignedCount, 30);

    // Verify balanced distribution: each room should have 15 students
    const rm1Count = await db.prepare(
      'SELECT count(*) as count FROM cbt_semester_participants WHERE event_id = ? AND room_id = ?'
    ).bind(eventId, 'rm-01').first<{ count: number }>();
    const rm2Count = await db.prepare(
      'SELECT count(*) as count FROM cbt_semester_participants WHERE event_id = ? AND room_id = ?'
    ).bind(eventId, 'rm-02').first<{ count: number }>();

    assert.equal(rm1Count?.count, 15);
    assert.equal(rm2Count?.count, 15);

    // Test Pin Lock: lock participant p-1 to rm-01
    await setParticipantRoomLock(db, eventId, 'p-1', true);
    const p1 = await db.prepare(
      'SELECT is_room_locked FROM cbt_semester_participants WHERE id = ?'
    ).bind('p-1').first<{ is_room_locked: number }>();
    assert.equal(p1?.is_room_locked, 1);

    // Manual move: move p-2 to rm-02
    const moveRes = await manualAssignParticipantRoom(db, eventId, 'p-2', 'rm-02');
    assert.equal(moveRes.success, true);
    const p2 = await db.prepare(
      'SELECT room_id, is_room_locked FROM cbt_semester_participants WHERE id = ?'
    ).bind('p-2').first<{ room_id: string; is_room_locked: number }>();
    assert.equal(p2?.room_id, 'rm-02');
    assert.equal(p2?.is_room_locked, 1); // manual move automatically pins room lock
  });

  it('3. Physical room geometry, anti-copying cross-grade desk pairing, and manual seat swap', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-seat-test';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-SEAT-1', 'Semester Seating Test', 'semester', 'draft')
    `).bind(eventId).run();

    // Create room with capacity 10
    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES ('rm-seat-1', 'Ruang 01', 10, ?)
    `).bind(eventId).run();

    // Configure physical layout: 5 rows, 2 cols (total 10 seats)
    const layoutRes = await configureRoomLayout(db, eventId, 'rm-seat-1', {
      rows_count: 5,
      cols_count: 2,
      desk_group_count: 5,
      is_irregular: false,
      required_invigilators: 1,
    });
    assert.equal(layoutRes.success, true);

    // Ensure seats table is materialized
    const seats = await getRoomSeats(db, eventId, 'rm-seat-1');
    assert.equal(seats.length, 10);

    // Seed 10 participants assigned to rm-seat-1: 5 Grade 10 and 5 Grade 11
    for (let i = 1; i <= 10; i++) {
      const grade = i <= 5 ? '10' : '11';
      await db.prepare(`
        INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name, room_id)
        VALUES (?, ?, ?, ?, ?, 'cls-1', 'X-1', 'rm-seat-1')
      `).bind(`p-st-${i}`, eventId, `std-${i}`, `Student ${i}`, grade).run();
    }

    // Distribute seats with anti-copying algorithm
    const distRes = await autoDistributeSeats(db, eventId, 'actor-admin-1', {
      anti_copying_desks: true,
      seed: 42,
    });
    assert.equal(distRes.success, true);
    assert.equal(distRes.totalAssigned, 10);

    // Verify anti-copying: on each desk group (pair of seats), grades should be alternating/different
    const assignments = await getRoomSeatAssignments(db, eventId, 'rm-seat-1');
    assert.equal(assignments.length, 10);

    // Group assignments by desk_group
    const byDesk: Record<number, any[]> = {};
    for (const a of assignments) {
      if (a.desk_group != null) {
        byDesk[a.desk_group] = byDesk[a.desk_group] || [];
        byDesk[a.desk_group].push(a);
      }
    }

    // Each 2-seat desk should have 1 Grade 10 and 1 Grade 11
    for (const [deskGroup, deskSeats] of Object.entries(byDesk)) {
      if (deskSeats.length === 2) {
        assert.notEqual(deskSeats[0].grade, deskSeats[1].grade, `Desk ${deskGroup} should pair different grades`);
      }
    }

    // Manual Swap test: swap seat of p-st-1 with p-st-2
    const seat1 = assignments.find((a) => a.participant_id === 'p-st-1')?.seat_id!;
    const seat2 = assignments.find((a) => a.participant_id === 'p-st-2')?.seat_id!;

    const swapRes = await manualAssignParticipantSeat(db, eventId, 'p-st-1', seat2, { swap: true });
    assert.equal(swapRes.success, true);

    // Verify p-st-1 now has seat2, and p-st-2 has seat1
    const p1Seat = await db.prepare(
      'SELECT seat_id, is_locked FROM cbt_semester_seat_assignments WHERE participant_id = ?'
    ).bind('p-st-1').first<{ seat_id: string; is_locked: number }>();
    assert.equal(p1Seat?.seat_id, seat2);
    assert.equal(p1Seat?.is_locked, 1); // manual seat pin
  });

  it('4. Timetable solver: MRV coloring, conflict avoidance, pinned lock, and token purge', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-time-test';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-TIME-1', 'Semester Timetable Test', 'semester', 'draft')
    `).bind(eventId).run();

    // Create 2 slots
    await db.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time, sequence_order)
      VALUES
        ('slot-1', ?, 'Sesi 1', '2026-10-01', '07:30', '09:30', 1),
        ('slot-2', ?, 'Sesi 2', '2026-10-01', '10:00', '12:00', 2)
    `).bind(eventId, eventId).run();

    // Create 2 exams for Grade 10
    await db.prepare(`
      INSERT INTO cbt_exams (id, title, duration_minutes, target_grade, event_id, mode)
      VALUES
        ('ex-mat-10', 'Matematika X', 90, '10', ?, 'semester'),
        ('ex-fis-10', 'Fisika X', 90, '10', ?, 'semester')
    `).bind(eventId, eventId).run();

    // Audience: both exams target class 'cls-x-1'
    await db.prepare(`
      INSERT INTO cbt_semester_exam_classes (id, exam_id, event_id, class_id, class_name, grade)
      VALUES
        ('sec-1', 'ex-mat-10', ?, 'cls-x-1', 'X-1', '10'),
        ('sec-2', 'ex-fis-10', ?, 'cls-x-1', 'X-1', '10')
    `).bind(eventId, eventId).run();

    // Run timetable solver
    const solveRes = await autoSolveTimetable(db, eventId, 'actor-admin-1', {
      max_exams_per_day: 2,
      clear_existing: true,
    });
    assert.equal(solveRes.success, true);
    assert.equal(solveRes.scheduledCount, 2);

    // Because both exams share class X-1, they must be assigned to different slots
    const sched1 = await db.prepare(
      'SELECT slot_id FROM cbt_semester_schedules WHERE exam_id = ?'
    ).bind('ex-mat-10').first<{ slot_id: string }>();
    const sched2 = await db.prepare(
      'SELECT slot_id FROM cbt_semester_schedules WHERE exam_id = ?'
    ).bind('ex-fis-10').first<{ slot_id: string }>();

    assert.notEqual(sched1?.slot_id, sched2?.slot_id, 'Conflicting exams must be in separate slots');

    // Test Pinned Lock: pin ex-mat-10 to its slot
    const schedMat = await db.prepare(
      'SELECT id FROM cbt_semester_schedules WHERE exam_id = ?'
    ).bind('ex-mat-10').first<{ id: string }>();
    await setScheduleLock(db, eventId, schedMat?.id!, true);

    const checkLock = await db.prepare(
      'SELECT is_locked FROM cbt_semester_schedules WHERE id = ?'
    ).bind(schedMat?.id!).first<{ is_locked: number }>();
    assert.equal(checkLock?.is_locked, 1);
  });

  it('5. Invigilator pool sync, semantic blackout validation, hard blackout respect, and workload balance', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-invig-test';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status, starts_at, ends_at)
      VALUES (?, 'SEM-INVIG-1', 'Semester Invig Test', 'semester', 'draft', '2026-10-01', '2026-10-05')
    `).bind(eventId).run();

    // Seed cbt_staff_profiles in DB
    await db.prepare(`
      INSERT INTO cbt_staff_profiles (id, nama, nip, email, mansatas_user_id, is_active)
      VALUES
        ('guru-1', 'Budi Santoso, M.Pd.', '19750101', 'budi@example.com', 'usr-1', 1),
        ('guru-2', 'Siti Aminah, S.Pd.', '19800202', 'siti@example.com', 'usr-2', 1),
        ('guru-3', 'Ahmad Fauzi, M.Si.', '19820303', 'ahmad@example.com', 'usr-3', 1),
        ('guru-4', 'Dewi Lestari, S.Pd.', '19850404', 'dewi@example.com', 'usr-4', 1),
        ('guru-5', 'Eko Prasetyo, S.Kom.', '19900505', 'eko@example.com', 'usr-5', 1),
        ('staf-1', 'Hendro Wibowo', '19880606', 'hendro@example.com', 'usr-6', 1);
    `).run();

    // 1. Sync pool from staff profiles
    const syncRes = await syncInvigilatorPoolFromStaff(db, eventId);
    assert.equal(syncRes.addedCount, 6);

    // 2. Semantic blackout validation:
    // Out-of-window date should be rejected
    const badBlackout = await addStaffBlackout(db, eventId, 'guru-1', null, '2026-12-31', 'Liburan');
    assert.equal(badBlackout.success, false);
    assert.match(badBlackout.error!, /rentang tanggal pelaksanaan/);

    // Valid blackout on slot-inv-1
    await db.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES ('slot-inv-1', ?, 'Sesi 1', '2026-10-01', '07:30', '09:30')
    `).bind(eventId).run();

    const goodBlackout = await addStaffBlackout(db, eventId, 'guru-1', 'slot-inv-1', null, 'Dinas Luar');
    assert.equal(goodBlackout.success, true);

    // Create 2 operational rooms with layouts
    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES ('rm-inv-1', 'Ruang 01', 20, ?), ('rm-inv-2', 'Ruang 02', 20, ?)
    `).bind(eventId, eventId).run();

    // Add layouts
    await configureRoomLayout(db, eventId, 'rm-inv-1', { rows_count: 5, cols_count: 4, required_invigilators: 1 });
    await configureRoomLayout(db, eventId, 'rm-inv-2', { rows_count: 5, cols_count: 4, required_invigilators: 1 });

    // Seed exam, schedule, exam class, and participants in both rooms for slot-inv-1
    await db.prepare(`
      INSERT INTO cbt_exams (id, title, duration_minutes, target_grade, event_id, mode)
      VALUES ('ex-inv-1', 'Ujian Invig', 60, '10', ?, 'semester')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_schedules (id, event_id, exam_id, slot_id)
      VALUES ('sc-inv-1', ?, 'ex-inv-1', 'slot-inv-1')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_exam_classes (id, exam_id, event_id, class_id, class_name, grade)
      VALUES ('sec-inv-1', 'ex-inv-1', ?, 'cls-1', 'X-1', '10')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name, room_id)
      VALUES
        ('p-inv-1', ?, 'std-i1', 'Siswa 1', '10', 'cls-1', 'X-1', 'rm-inv-1'),
        ('p-inv-2', ?, 'std-i2', 'Siswa 2', '10', 'cls-1', 'X-1', 'rm-inv-2')
    `).bind(eventId, eventId).run();

    // Run auto-invigilator assignment
    const assignRes = await autoAssignInvigilators(db, eventId, 'actor-admin-1', {
      invigilators_per_room: 1,
    });
    assert.equal(assignRes.success, true);
    assert.equal(assignRes.totalAssigned, 2);

    // Verify hard blackout: guru-1 must NOT be assigned to slot-inv-1
    const guru1Assigned = await db.prepare(`
      SELECT * FROM cbt_semester_invigilator_assignments
      WHERE event_id = ? AND slot_id = 'slot-inv-1' AND staff_id = 'guru-1'
    `).bind(eventId).first();
    assert.equal(guru1Assigned, null, 'guru-1 must not be assigned due to blackout');
  });

  it('6. Contextual proctor auth: WIB time window, token exposure, and IDOR-safe actions', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-proctor-test';

    // Event with 30m before and 45m after window
    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status, proctor_access_before_minutes, proctor_access_after_minutes)
      VALUES (?, 'SEM-PROC-1', 'Semester Proctor Auth Test', 'semester', 'active', 30, 45)
    `).bind(eventId).run();

    // Create room and slot
    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES ('rm-proc-1', 'Ruang 01', 20, ?), ('rm-proc-2', 'Ruang 02', 20, ?)
    `).bind(eventId, eventId).run();

    // Seed staff profile and user
    await db.prepare(`
      INSERT INTO cbt_staff_profiles (id, nama, nip, email, mansatas_user_id, is_active)
      VALUES ('guru-1', 'Budi Santoso', '19750101', 'budi@example.com', 'usr-1', 1)
    `).run();

    await db.prepare(`
      INSERT INTO cbt_users (id, username, role, staff_id)
      VALUES ('usr-1', 'guru1', 'guru', 'guru-1')
    `).run();

    // Generate date and time matching current WIB
    const nowUtc = new Date();
    const wibMs = nowUtc.getTime() + 7 * 3600 * 1000;
    const wibDateObj = new Date(wibMs);
    const wibDate = wibDateObj.toISOString().slice(0, 10);
    const curH = wibDateObj.getUTCHours();
    const startHour = String(Math.max(0, curH - 1)).padStart(2, '0');
    const endHour = String(Math.min(23, curH + 2)).padStart(2, '0');

    await db.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES ('slot-proc-1', ?, 'Sesi 1', ?, ?, ?)
    `).bind(eventId, wibDate, `${startHour}:00`, `${endHour}:00`).run();

    // Assign guru-1 to rm-proc-1 at slot-proc-1
    await db.prepare(`
      INSERT INTO cbt_semester_invigilator_assignments (id, event_id, slot_id, room_id, invigilator_order, staff_id, staff_name, mansatas_user_id)
      VALUES ('asgn-1', ?, 'slot-proc-1', 'rm-proc-1', 1, 'guru-1', 'Budi Santoso', 'usr-1')
    `).bind(eventId).run();

    // Authorize proctor context
    const authResult = await resolveProctorContext(db, eventId, 'rm-proc-1', 'slot-proc-1', {
      id: 'usr-1',
      role: 'guru',
      staff_id: 'guru-1',
    });
    assert.equal(authResult.authorized, true);
    assert.ok(authResult.context);
    assert.equal(authResult.context.room_id, 'rm-proc-1');
    assert.equal(authResult.context.is_window_active, true);

    // Seed exam & token in rm-proc-1 and rm-proc-2
    await db.prepare(`
      INSERT INTO cbt_exams (id, title, duration_minutes, target_grade, event_id, mode)
      VALUES ('ex-proc-1', 'Ujian Proctor', 60, '10', ?, 'semester')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_exam_tokens (id, exam_id, room_id, tanggal_tes, sesi_tes, token_code)
      VALUES
        ('tok-1', 'ex-proc-1', 'rm-proc-1', ?, 'Sesi 1', 'TOK-ROOM-1'),
        ('tok-2', 'ex-proc-1', 'rm-proc-2', ?, 'Sesi 1', 'TOK-ROOM-2')
    `).bind(wibDate, wibDate).run();

    // Link exam to slot-proc-1 and participant
    await db.prepare(`
      INSERT INTO cbt_semester_schedules (id, event_id, exam_id, slot_id)
      VALUES ('sc-proc-1', ?, 'ex-proc-1', 'slot-proc-1')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_exam_classes (id, exam_id, event_id, class_id, class_name, grade)
      VALUES ('sec-proc-1', 'ex-proc-1', ?, 'cls-1', 'X-1', '10')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name, room_id)
      VALUES
        ('p-proc-1', ?, 'std-1', 'Student 1', '10', 'cls-1', 'X-1', 'rm-proc-1'),
        ('p-proc-2', ?, 'std-2', 'Student 2', '10', 'cls-1', 'X-1', 'rm-proc-2')
    `).bind(eventId, eventId).run();

    // Verify token query: proctor only sees tokens for their room (rm-proc-1)
    const tokens = await getRoomSlotTokens(db, eventId, 'rm-proc-1', 'slot-proc-1');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].token, 'TOK-ROOM-1');

    // Seed active session in rm-proc-1 and rm-proc-2
    await db.prepare(`
      INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, status, is_time_locked)
      VALUES
        ('sess-1', 'ex-proc-1', 'std-1', 'student', 'rm-proc-1', 'active', 1),
        ('sess-2', 'ex-proc-1', 'std-2', 'student', 'rm-proc-2', 'active', 1)
    `).run();

    // IDOR Protection: guru-1 (in rm-proc-1) tries to unlock sess-2 (which belongs to std-2 in rm-proc-2)
    const idorUnlock = await unlockProctorSession(db, eventId, 'rm-proc-1', 'slot-proc-1', 'sess-2', 'guru-1');
    assert.equal(idorUnlock.success, false);
    assert.match(idorUnlock.error || '', /tidak ditemukan pada ruangan dan jadwal/);

    // Valid unlock: guru-1 unlocks sess-1 in rm-proc-1
    const validUnlock = await unlockProctorSession(db, eventId, 'rm-proc-1', 'slot-proc-1', 'sess-1', 'guru-1');
    assert.equal(validUnlock.success, true);
    const updatedSess = await db.prepare(
      'SELECT is_time_locked FROM cbt_exam_sessions WHERE id = ?'
    ).bind('sess-1').first<{ is_time_locked: number }>();
    assert.equal(updatedSess?.is_time_locked, 0);
  });

  it('7. Canonical Readiness Gate: seating and invigilator checks', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-ready-test';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status, academic_year_id)
      VALUES (?, 'SEM-READY-1', 'Semester Readiness Test', 'semester', 'draft', 'ay-1')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES ('rm-r-1', 'Ruang 01', 20, ?)
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES ('slot-r-1', ?, 'Sesi 1', '2026-10-01', '07:30', '09:30')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_exams (id, title, duration_minutes, target_grade, event_id, mode, subject_id, active_status)
      VALUES ('ex-r-1', 'Ujian Ready', 60, '10', ?, 'semester', 'sub-1', 'active')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_schedules (id, event_id, exam_id, slot_id)
      VALUES ('sc-r-1', ?, 'ex-r-1', 'slot-r-1')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_exam_classes (id, event_id, exam_id, class_id, class_name, grade)
      VALUES ('sec-r-1', ?, 'ex-r-1', 'cls-1', 'X-1', '10')
    `).bind(eventId).run();

    // 1 participant without seat
    await db.prepare(`
      INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name, room_id)
      VALUES ('p-r-1', ?, 'std-r-1', 'Student R1', '10', 'cls-1', 'X-1', 'rm-r-1')
    `).bind(eventId).run();

    // Check readiness: Gate 9 (seating) and Gate 10 (invigilators) must FAIL
    const rResult1 = await checkSemesterEventReadiness(db, eventId);
    assert.equal(rResult1.eligible, false);
    assert.equal(rResult1.categories.seating.status, 'failed');
    assert.equal(rResult1.categories.invigilators.status, 'failed');

    // Assign seat
    await db.prepare(`
      INSERT INTO cbt_semester_seats (id, event_id, room_id, seat_number, seat_label)
      VALUES ('seat-r-1', ?, 'rm-r-1', 1, 'K-01')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_seat_assignments (id, event_id, participant_id, room_id, seat_id)
      VALUES ('asgn-seat-1', ?, 'p-r-1', 'rm-r-1', 'seat-r-1')
    `).bind(eventId).run();

    // Assign invigilator
    await db.prepare(`
      INSERT INTO cbt_semester_invigilator_assignments (id, event_id, slot_id, room_id, invigilator_order, staff_id, staff_name)
      VALUES ('asgn-inv-1', ?, 'slot-r-1', 'rm-r-1', 1, 'guru-1', 'Guru Pengawas')
    `).bind(eventId).run();

    // Check readiness again: Gates 9 and 10 should now PASS
    const rResult2 = await checkSemesterEventReadiness(db, eventId);
    assert.equal(rResult2.categories.seating.status, 'passed');
    assert.equal(rResult2.categories.invigilators.status, 'passed');
  });

  it('8. Database triggers: immutable audit logs and room/seat integrity', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-trg-test';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-TRG-1', 'Semester Trigger Test', 'semester', 'draft')
    `).bind(eventId).run();

    // Insert generation log
    await logGenerationResult(db, eventId, 'room_allocation', 'actor-admin', null, {}, 'success', 'Initial room allocation');

    // Attempt to UPDATE generation log must fail via trigger
    await assert.rejects(
      async () => {
        await db.prepare('UPDATE cbt_semester_generation_logs SET summary = ? WHERE event_id = ?')
          .bind('Modified summary', eventId).run();
      },
      /cbt_semester_generation_logs is immutable/
    );

    // Attempt to DELETE generation log must fail via trigger
    await assert.rejects(
      async () => {
        await db.prepare('DELETE FROM cbt_semester_generation_logs WHERE event_id = ?')
          .bind(eventId).run();
      },
      /cbt_semester_generation_logs is immutable/
    );

    // Verify foreign key integrity across SQLite database
    const fkErrors = (db as any)._sqlite.prepare('PRAGMA foreign_key_check;').all();
    assert.equal(fkErrors.length, 0, `Expected 0 foreign key errors, found: ${JSON.stringify(fkErrors)}`);
  });

  it('9. PRAGMA foreign_key_check verification on complex populated relations', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-fk-test';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-FK-1', 'Semester FK Test', 'semester', 'draft')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES ('rm-fk-1', 'Lab FK 1', 30, ?)
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_room_layouts (id, event_id, room_id, layout_type, total_seats, rows_count, cols_count, required_invigilators)
      VALUES ('layout-fk-1', ?, 'rm-fk-1', 'grid', 30, 5, 6, 1)
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_seats (id, event_id, room_id, seat_number, seat_label, row_num, col_num)
      VALUES ('seat-fk-1', ?, 'rm-fk-1', 1, 'K-01', 1, 1)
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, nomor_peserta, class_id, class_name, grade, room_id)
      VALUES ('part-fk-1', ?, 'stu-fk-1', 'Budi Santoso', '07-001', 'k1', 'X-A', '10', 'rm-fk-1')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_seat_assignments (id, event_id, participant_id, room_id, seat_id)
      VALUES ('asgn-fk-1', ?, 'part-fk-1', 'rm-fk-1', 'seat-fk-1')
    `).bind(eventId).run();

    // Check PRAGMA foreign_key_check
    const sqlite = (db as any)._sqlite;
    const fkErrors = sqlite.prepare('PRAGMA foreign_key_check;').all();
    assert.equal(fkErrors.length, 0, `PRAGMA foreign_key_check should have 0 errors, got: ${JSON.stringify(fkErrors)}`);
  });

  it('10. Negative test: Logical fallback uses sequential seats only and does not create or evaluate fake desk adjacency', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-fallback-test';
    const roomId = 'rm-fallback-1';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-FALLBACK-1', 'Semester Logical Fallback Test', 'semester', 'draft')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES (?, 'Ruang Fallback', 10, ?)
    `).bind(roomId, eventId).run();

    // Fetch room layout: must be logical_fallback
    const layout = await getRoomLayout(db, eventId, roomId);
    assert.equal(layout.layout_type, 'logical_fallback');
    assert.equal(layout.total_seats, 10);

    // Fetch seats: all seats must have desk_group = null
    const seats = await getRoomSeats(db, eventId, roomId);
    assert.equal(seats.length, 10);
    for (const s of seats) {
      assert.equal(s.desk_group, null, `Seat ${s.seat_number} must have desk_group = null in logical fallback`);
    }

    // Insert 4 participants with different grades: 2 Grade 10, 2 Grade 11
    await db.prepare(`
      INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, nomor_peserta, class_id, class_name, grade, room_id)
      VALUES
        ('p-fb-1', ?, 's-1', 'Ahmad 10', '07-001', 'c1', 'X-A', '10', ?),
        ('p-fb-2', ?, 's-2', 'Budi 10', '07-002', 'c1', 'X-A', '10', ?),
        ('p-fb-3', ?, 's-3', 'Citra 11', '07-003', 'c2', 'XI-A', '11', ?),
        ('p-fb-4', ?, 's-4', 'Dewi 11', '07-004', 'c2', 'XI-A', '11', ?)
    `).bind(eventId, roomId, eventId, roomId, eventId, roomId, eventId, roomId).run();

    // Run auto distribution with cross_grade_pairing enabled in config
    const res = await autoDistributeSeats(db, eventId, 'actor-test', { cross_grade_pairing: true });
    assert.equal(res.success, true);

    // Verify seat assignments in room
    const assignments = await getRoomSeatAssignments(db, eventId, roomId);
    assert.equal(assignments.length, 4);

    // Prove that in logical fallback, participants are assigned sequentially 1..4 without fake desk interleaving
    const assignedSeatNumbers = assignments.map((a) => a.seat_number);
    assert.deepEqual(assignedSeatNumbers, [1, 2, 3, 4]);
  });

  it('11. Canonical event proctor access windows with non-default values', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-proctor-custom-win';
    const roomId = 'rm-proc-win';
    const slotId = 'slot-proc-win';
    const staffId = 'staff-proc-win';

    // Non-default window: 60 minutes before, 90 minutes after
    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status, proctor_access_before_minutes, proctor_access_after_minutes)
      VALUES (?, 'SEM-PROC-WIN', 'Semester Proctor Custom Window', 'semester', 'draft', 60, 90)
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES (?, 'Lab Komputer 1', 30, ?)
    `).bind(roomId, eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES (?, ?, 'Sesi 1', '2026-10-01', '08:00', '09:30')
    `).bind(slotId, eventId).run();

    await db.prepare(`
      INSERT INTO cbt_staff_profiles (id, nama, is_active)
      VALUES (?, 'Ustadz Pengawas', 1)
    `).bind(staffId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_invigilator_pool (id, event_id, staff_id, is_eligible)
      VALUES ('pool-pw-1', ?, ?, 1)
    `).bind(eventId, staffId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_invigilator_assignments (id, event_id, slot_id, room_id, invigilator_order, staff_id, staff_name)
      VALUES ('asgn-pw-1', ?, ?, ?, 1, ?, 'Ustadz Pengawas')
    `).bind(eventId, slotId, roomId, staffId).run();

    const user = { id: staffId, role: 'guru', staff_id: staffId };

    // Case A: 45 minutes before start (07:15 WIB = 00:15 UTC on 2026-10-01)
    // Under default 30 min, 07:15 would be early (before 07:30).
    // Under custom 60 min window, 07:15 is inside [07:00, 11:00] -> ACTIVE!
    const time45mBefore = new Date(Date.UTC(2026, 9, 1, 0, 15)); // 07:15 WIB
    const authBefore = await resolveProctorContext(db, eventId, roomId, slotId, user, time45mBefore);
    assert.equal(authBefore.authorized, true);
    assert.equal(authBefore.context?.window_status, 'active');
    assert.equal(authBefore.context?.is_window_active, true);

    // Case B: 75 minutes after end (10:45 WIB = 03:45 UTC on 2026-10-01)
    // Under default 45 min, 10:45 would be expired (after 10:15).
    // Under custom 90 min window, 10:45 is inside [07:00, 11:00] -> ACTIVE!
    const time75mAfter = new Date(Date.UTC(2026, 9, 1, 3, 45)); // 10:45 WIB
    const authAfter = await resolveProctorContext(db, eventId, roomId, slotId, user, time75mAfter);
    assert.equal(authAfter.authorized, true);
    assert.equal(authAfter.context?.window_status, 'active');
    assert.equal(authAfter.context?.is_window_active, true);

    // Case C: 100 minutes after end (11:10 WIB = 04:10 UTC on 2026-10-01) -> Expired!
    const time100mAfter = new Date(Date.UTC(2026, 9, 1, 4, 10)); // 11:10 WIB
    const authExpired = await resolveProctorContext(db, eventId, roomId, slotId, user, time100mAfter);
    assert.equal(authExpired.authorized, false);
    assert.equal(authExpired.context?.window_status, 'expired');
    assert.equal(authExpired.context?.is_window_active, false);
  });

  it('12. Room capacity and layout integrity (increase, decrease, physical reject, logical reconcile)', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-cap-integ';
    const roomPhysId = 'rm-phys-1';
    const roomLogId = 'rm-log-1';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-CAP-1', 'Semester Capacity Integrity', 'semester', 'draft')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES (?, 'Lab Fisik', 20, ?), (?, 'Lab Logis', 10, ?)
    `).bind(roomPhysId, eventId, roomLogId, eventId).run();

    // Configure physical layout on roomPhysId
    await configureRoomLayout(db, eventId, roomPhysId, { rows_count: 5, cols_count: 4 });
    const physLayout = await getRoomLayout(db, eventId, roomPhysId);
    assert.equal(physLayout.layout_type, 'physical_configured');
    assert.equal(physLayout.total_seats, 20);

    // 12.1 Attempt to update physical room capacity directly -> Must be rejected by service and trigger
    const updatePhysRes = await updateRoom(db, roomPhysId, { capacity: 25 });
    assert.equal(updatePhysRes.success, false);
    assert.match(updatePhysRes.error || '', /denah fisik terkonfigurasi/);

    // Raw SQL bypass attempt on physical room must be blocked by trigger
    await assert.rejects(
      async () => {
        await db.prepare('UPDATE cbt_rooms SET capacity = 25 WHERE id = ?').bind(roomPhysId).run();
      },
      /Room capacity cannot differ from configured physical layout seats/
    );

    // 12.2 Logical layout: initial ensure
    await getRoomLayout(db, eventId, roomLogId);
    const initialLogSeats = await getRoomSeats(db, eventId, roomLogId);
    assert.equal(initialLogSeats.length, 10);

    // Increase logical capacity from 10 to 14 via updateRoom
    const updateLogRes = await updateRoom(db, roomLogId, { capacity: 14 });
    assert.equal(updateLogRes.success, true);

    const expandedLogSeats = await getRoomSeats(db, eventId, roomLogId);
    assert.equal(expandedLogSeats.length, 14);
    assert.equal(expandedLogSeats[13].seat_number, 14);
    assert.equal(expandedLogSeats[13].seat_label, 'K-14');

    // Decrease logical capacity from 14 to 12 via updateRoom
    const shrinkLogRes = await updateRoom(db, roomLogId, { capacity: 12 });
    assert.equal(shrinkLogRes.success, true);

    const shrunkLogSeats = await getRoomSeats(db, eventId, roomLogId);
    assert.equal(shrunkLogSeats.length, 12);

    // 12.3 Attempt to reduce capacity below assigned participants count -> Must fail
    await db.prepare(`
      INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, nomor_peserta, class_id, class_name, grade, room_id)
      VALUES
        ('p-cap-1', ?, 'stu-c1', 'Siswa 1', '07-001', 'c1', 'X', '10', ?),
        ('p-cap-2', ?, 'stu-c2', 'Siswa 2', '07-002', 'c1', 'X', '10', ?),
        ('p-cap-3', ?, 'stu-c3', 'Siswa 3', '07-003', 'c1', 'X', '10', ?),
        ('p-cap-4', ?, 'stu-c4', 'Siswa 4', '07-004', 'c1', 'X', '10', ?)
    `).bind(eventId, roomLogId, eventId, roomLogId, eventId, roomLogId, eventId, roomLogId).run();

    // Trying to reduce roomLogId capacity to 3 (below 4 assigned) must fail
    const underCapRes = await updateRoom(db, roomLogId, { capacity: 3 });
    assert.equal(underCapRes.success, false);
    assert.match(underCapRes.error || '', /Kapasitas tidak dapat dikurangi di bawah jumlah siswa/);

    // Raw SQL must also be rejected by trigger
    await assert.rejects(
      async () => {
        await db.prepare('UPDATE cbt_rooms SET capacity = 3 WHERE id = ?').bind(roomLogId).run();
      },
      /Room capacity cannot be reduced below the number of assigned participants/
    );
  });

  it('13. Pure unlock-and-mutate bypass prevention (raw-SQL negative tests)', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-pure-unlock';
    const roomId = 'rm-pure-unlock';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-PU-1', 'Semester Pure Unlock', 'semester', 'draft')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES (?, 'Ruang Pure Unlock', 20, ?)
    `).bind(roomId, eventId).run();

    // 13.1 Seat assignments: unlock + mutate in one UPDATE must fail
    await db.prepare(`
      INSERT INTO cbt_semester_seats (id, event_id, room_id, seat_number, seat_label, row_num, col_num)
      VALUES ('seat-pu-1', ?, ?, 1, 'K-01', 1, 1), ('seat-pu-2', ?, ?, 2, 'K-02', 1, 2)
    `).bind(eventId, roomId, eventId, roomId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, nomor_peserta, class_id, class_name, grade, room_id)
      VALUES ('part-pu-1', ?, 'stu-pu-1', 'Siswa PU 1', '07-001', 'c1', 'X', '10', ?)
    `).bind(eventId, roomId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_seat_assignments (id, event_id, participant_id, room_id, seat_id, is_locked)
      VALUES ('asgn-pu-1', ?, 'part-pu-1', ?, 'seat-pu-1', 1)
    `).bind(eventId, roomId).run();

    // Negative raw-SQL test: unlock + change seat in one UPDATE
    await assert.rejects(
      async () => {
        await db.prepare('UPDATE cbt_semester_seat_assignments SET is_locked = 0, seat_id = ? WHERE id = ?')
          .bind('seat-pu-2', 'asgn-pu-1').run();
      },
      /Transitioning seat assignment from locked to unlocked must be a pure unlock/
    );

    // Pure unlock must succeed
    await db.prepare('UPDATE cbt_semester_seat_assignments SET is_locked = 0 WHERE id = ?')
      .bind('asgn-pu-1').run();
    const unlockedAsgn = await db.prepare('SELECT is_locked, seat_id FROM cbt_semester_seat_assignments WHERE id = ?')
      .bind('asgn-pu-1').first<any>();
    assert.equal(unlockedAsgn?.is_locked, 0);
    assert.equal(unlockedAsgn?.seat_id, 'seat-pu-1');

    // 13.2 Schedules: unlock + move schedule in one UPDATE must fail
    await db.prepare(`
      INSERT INTO cbt_exams (id, title, duration_minutes, active_status, target_grade, event_id, mode)
      VALUES ('exam-pu-1', 'Matematika PU', 60, 'draft', '10', ?, 'semester')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES
        ('slot-pu-1', ?, 'S1', '2026-10-01', '08:00', '09:00'),
        ('slot-pu-2', ?, 'S2', '2026-10-01', '09:30', '10:30')
    `).bind(eventId, eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_schedules (id, event_id, exam_id, slot_id, is_locked)
      VALUES ('sch-pu-1', ?, 'exam-pu-1', 'slot-pu-1', 1)
    `).bind(eventId).run();

    // Negative raw-SQL test: unlock + move schedule in one UPDATE
    await assert.rejects(
      async () => {
        await db.prepare('UPDATE cbt_semester_schedules SET is_locked = 0, slot_id = ? WHERE id = ?')
          .bind('slot-pu-2', 'sch-pu-1').run();
      },
      /Transitioning schedule from locked to unlocked must be a pure unlock/
    );

    // Pure unlock must succeed
    await db.prepare('UPDATE cbt_semester_schedules SET is_locked = 0 WHERE id = ?')
      .bind('sch-pu-1').run();
    const unlockedSch = await db.prepare('SELECT is_locked, slot_id FROM cbt_semester_schedules WHERE id = ?')
      .bind('sch-pu-1').first<any>();
    assert.equal(unlockedSch?.is_locked, 0);

    // 13.3 Invigilator assignments: unlock + replace invigilator in one UPDATE must fail
    await db.prepare(`
      INSERT INTO cbt_staff_profiles (id, nama, is_active)
      VALUES ('guru-pu-1', 'Guru 1', 1), ('guru-pu-2', 'Guru 2', 1)
    `).bind().run();

    await db.prepare(`
      INSERT INTO cbt_semester_invigilator_pool (id, event_id, staff_id, is_eligible)
      VALUES ('pool-pu-1', ?, 'guru-pu-1', 1), ('pool-pu-2', ?, 'guru-pu-2', 1)
    `).bind(eventId, eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_invigilator_assignments (id, event_id, slot_id, room_id, invigilator_order, staff_id, staff_name, is_locked)
      VALUES ('inv-pu-1', ?, 'slot-pu-1', ?, 1, 'guru-pu-1', 'Guru 1', 1)
    `).bind(eventId, roomId).run();

    // Negative raw-SQL test: unlock + replace invigilator in one UPDATE
    await assert.rejects(
      async () => {
        await db.prepare('UPDATE cbt_semester_invigilator_assignments SET is_locked = 0, staff_id = ? WHERE id = ?')
          .bind('guru-pu-2', 'inv-pu-1').run();
      },
      /Transitioning invigilator assignment from locked to unlocked must be a pure unlock/
    );

    // Pure unlock must succeed
    await db.prepare('UPDATE cbt_semester_invigilator_assignments SET is_locked = 0 WHERE id = ?')
      .bind('inv-pu-1').run();
    const unlockedInv = await db.prepare('SELECT is_locked, staff_id FROM cbt_semester_invigilator_assignments WHERE id = ?')
      .bind('inv-pu-1').first<any>();
    assert.equal(unlockedInv?.is_locked, 0);
  });

  it('14. Genuinely irregular physical layout implementation without phantom seats', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-irreg';
    const roomId = 'rm-irreg-1';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-IRR-1', 'Semester Irregular Test', 'semester', 'draft')
    `).bind(eventId).run();

    // Room capacity 5, but non-rectangular geometry (e.g. L-shaped room: 3 seats row 1, 2 seats row 2)
    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES (?, 'Lab L-Shape', 5, ?)
    `).bind(roomId, eventId).run();

    const customSeats = [
      { seat_number: 1, seat_label: 'L1-A', row_num: 1, col_num: 1, desk_group: 1 },
      { seat_number: 2, seat_label: 'L1-B', row_num: 1, col_num: 2, desk_group: 1 },
      { seat_number: 3, seat_label: 'L1-C', row_num: 1, col_num: 3, desk_group: 2 },
      { seat_number: 4, seat_label: 'L2-A', row_num: 2, col_num: 1, desk_group: 3 },
      { seat_number: 5, seat_label: 'L2-B', row_num: 2, col_num: 2, desk_group: 3 },
    ];

    const cfgRes = await configureRoomLayout(db, eventId, roomId, {
      is_irregular: true,
      custom_seats: customSeats,
      required_invigilators: 1,
    });
    assert.equal(cfgRes.success, true);
    assert.equal(cfgRes.layout?.layout_type, 'physical_configured');
    assert.equal(cfgRes.layout?.is_irregular, 1);

    // Fetch room seats: must be exactly 5 custom seats with 0 phantom seats
    const savedSeats = await getRoomSeats(db, eventId, roomId);
    assert.equal(savedSeats.length, 5);
    assert.deepEqual(
      savedSeats.map((s) => ({ num: s.seat_number, label: s.seat_label, r: s.row_num, c: s.col_num, d: s.desk_group })),
      [
        { num: 1, label: 'L1-A', r: 1, c: 1, d: 1 },
        { num: 2, label: 'L1-B', r: 1, c: 2, d: 1 },
        { num: 3, label: 'L1-C', r: 1, c: 3, d: 2 },
        { num: 4, label: 'L2-A', r: 2, c: 1, d: 3 },
        { num: 5, label: 'L2-B', r: 2, c: 2, d: 3 },
      ]
    );

    // Seat participants into this irregular room
    await db.prepare(`
      INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, nomor_peserta, class_id, class_name, grade, room_id)
      VALUES
        ('p-irr-1', ?, 'stu-i1', 'Siswa Irr 1', '07-001', 'c1', 'X', '10', ?),
        ('p-irr-2', ?, 'stu-i2', 'Siswa Irr 2', '07-002', 'c2', 'XI', '11', ?)
    `).bind(eventId, roomId, eventId, roomId).run();

    const distRes = await autoDistributeSeats(db, eventId, 'actor-test', { cross_grade_pairing: true });
    assert.equal(distRes.success, true);

    const asgns = await getRoomSeatAssignments(db, eventId, roomId);
    assert.equal(asgns.length, 2);
    // Verified: no phantom seats created
  });

  it('15. Timetable generation atomicity, roster synchronization, and injected-failure rollback', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-tt-atomic';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-TT-ATOMIC', 'Semester Timetable Atomic Test', 'semester', 'draft')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_exams (id, title, duration_minutes, active_status, target_grade, event_id, mode)
      VALUES
        ('ex-tt-1', 'Biologi X', 60, 'draft', '10', ?, 'semester'),
        ('ex-tt-2', 'Fisika X', 60, 'draft', '10', ?, 'semester')
    `).bind(eventId, eventId).run();

    // Roster participant for ex-tt-1
    await db.prepare(`
      INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, full_name, username)
      VALUES ('rost-tt-1', 'ex-tt-1', ?, 'student', 'stu-tt-1', 'Siswa Roster TT', 'user-tt')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES
        ('sl-tt-1', ?, 'Sesi 1', '2026-10-01', '08:00', '09:30'),
        ('sl-tt-2', ?, 'Sesi 2', '2026-10-01', '10:00', '11:30')
    `).bind(eventId, eventId).run();

    // Successful atomic solve
    const solveRes = await autoSolveTimetable(db, eventId, 'actor-admin');
    assert.equal(solveRes.success, true);

    // Verify roster tanggal_tes and sesi_tes were atomically updated
    const updatedRoster = await db.prepare('SELECT tanggal_tes, sesi_tes FROM cbt_exam_roster WHERE id = ?')
      .bind('rost-tt-1').first<any>();
    assert.equal(updatedRoster?.tanggal_tes, '2026-10-01');
    assert.ok(updatedRoster?.sesi_tes);

    // Verify initial timetable count
    const initialSchedules = await db.prepare('SELECT COUNT(*) as cnt FROM cbt_semester_schedules WHERE event_id = ?')
      .bind(eventId).first<{ cnt: number }>();
    assert.equal(initialSchedules?.cnt, 2);

    // Lock one schedule
    await setScheduleLock(db, eventId, 'ex-tt-1', true);

    // Injected failure scenario: pass max_exams_per_day: 1 where 2 grade 10 exams exist on the same date -> impossible!
    const failedSolve = await autoSolveTimetable(db, eventId, 'actor-admin', { max_exams_per_day: 1 });
    assert.equal(failedSolve.success, false);
    assert.equal(failedSolve.status, 'impossible');

    // Rollback verification: locked schedule and previous schedules must remain completely untouched
    const afterRollbackSchedules = await db.prepare('SELECT COUNT(*) as cnt FROM cbt_semester_schedules WHERE event_id = ?')
      .bind(eventId).first<{ cnt: number }>();
    assert.equal(afterRollbackSchedules?.cnt, 2);
  });

  it('16. Invigilator generation atomicity and injected-failure rollback', async () => {
    const db = createAutomationTestDb();
    const eventId = 'ev-sem-inv-atomic';
    const roomId = 'rm-inv-at';
    const slotId = 'sl-inv-at';
    const examId = 'ex-inv-at';
    const staffId = 'st-inv-at-1';

    await db.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-INV-AT', 'Semester Invigilator Atomic Test', 'semester', 'draft')
    `).bind(eventId).run();

    await db.prepare(`
      INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
      VALUES (?, 'Lab Atomic', 20, ?)
    `).bind(roomId, eventId).run();

    await db.prepare(`
      INSERT INTO cbt_exams (id, title, duration_minutes, active_status, target_grade, event_id, mode)
      VALUES (?, 'Kimia Atomic', 60, 'draft', '10', ?, 'semester')
    `).bind(examId, eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES (?, ?, 'Sesi 1', '2026-10-01', '08:00', '09:30')
    `).bind(slotId, eventId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_schedules (id, event_id, exam_id, slot_id)
      VALUES ('sch-inv-at', ?, ?, ?)
    `).bind(eventId, examId, slotId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_exam_classes (id, event_id, exam_id, class_id, class_name, grade)
      VALUES ('cls-inv-at', ?, ?, 'c1', 'X-A', '10')
    `).bind(eventId, examId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, nomor_peserta, class_id, class_name, grade, room_id)
      VALUES ('p-inv-at', ?, 's-inv-1', 'Siswa Atomic', '07-001', 'c1', 'X-A', '10', ?)
    `).bind(eventId, roomId).run();

    await db.prepare(`
      INSERT INTO cbt_staff_profiles (id, nama, is_active)
      VALUES (?, 'Guru Atomic 1', 1)
    `).bind(staffId).run();

    await db.prepare(`
      INSERT INTO cbt_semester_invigilator_pool (id, event_id, staff_id, is_eligible)
      VALUES ('pool-at-1', ?, ?, 1)
    `).bind(eventId, staffId).run();

    // Successful run
    const res1 = await autoAssignInvigilators(db, eventId, 'actor-admin');
    assert.equal(res1.success, true);

    const initialAssignments = await getInvigilatorAssignments(db, eventId);
    assert.equal(initialAssignments.length, 1);

    // Injected failure scenario: add a hard blackout for the only eligible staff member on this date
    await addStaffBlackout(db, eventId, staffId, null, '2026-10-01', 'Izin tugas luar');

    // Next run must report impossible without corrupting or modifying previous assignments
    const res2 = await autoAssignInvigilators(db, eventId, 'actor-admin');
    assert.equal(res2.success, false);
    assert.equal(res2.status, 'impossible');

    // Rollback verification: previous assignments remain 100% untouched
    const afterFailedAssignments = await getInvigilatorAssignments(db, eventId);
    assert.equal(afterFailedAssignments.length, 1);
  });
});
