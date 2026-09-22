// ============================================================
// Scale Simulation Test for Phase 7:
// 1,600-Student Scale, D1 Bounded Statements & Parameter Limits
// ============================================================

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { autoAllocateRooms } from '../src/services/domains/semester/room-allocation.ts';
import {
  configureRoomLayout,
  autoDistributeSeats,
  getRoomSeatAssignments,
} from '../src/services/domains/semester/seating.ts';
import {
  autoSolveTimetable,
} from '../src/services/domains/semester/timetable-solver.ts';
import {
  syncInvigilatorPoolFromStaff,
  autoAssignInvigilators,
  getInvigilatorAssignments,
} from '../src/services/domains/semester/invigilators.ts';
import { getGenerationLogs } from '../src/services/domains/semester/concurrency.ts';

// ── Instrumenting D1 Wrapper to Track D1 Limits & Measured Query Breakdown ──
export interface StageQueryMetrics {
  stageName: string;
  preflightReads: number;
  stagingStatements: number;
  promotionStatements: number;
  otherStatements: number;
  totalQueries: number;
  maxBoundParams: number;
  maxSqlLength: number;
  batchCount: number;
  batchSizes: number[];
}

function createInstrumentedD1(sqlite: DatabaseSync) {
  let stageLogs: Array<{ sql: string; category: 'read' | 'staging' | 'promotion' | 'other'; paramCount: number; sqlLength: number }> = [];
  let stageBatches: number[][] = [];
  let overallMaxParams = 0;
  let overallMaxSql = 0;

  const classifyQuery = (sql: string, isReadMethod: boolean): 'read' | 'staging' | 'promotion' | 'other' => {
    const trimmed = sql.trim().toUpperCase();
    if (isReadMethod || trimmed.startsWith('SELECT')) return 'read';
    if (trimmed.includes('_STAGING')) {
      if (trimmed.startsWith('INSERT INTO') || trimmed.startsWith('DELETE FROM')) {
        return 'staging';
      }
      return 'promotion';
    }
    if (
      trimmed.startsWith('INSERT INTO CBT_SEMESTER_SCHEDULES') ||
      trimmed.startsWith('INSERT INTO CBT_SEMESTER_SEAT_ASSIGNMENTS') ||
      trimmed.startsWith('INSERT INTO CBT_SEMESTER_INVIGILATOR_ASSIGNMENTS') ||
      trimmed.startsWith('UPDATE CBT_SEMESTER_PARTICIPANTS') ||
      trimmed.startsWith('UPDATE CBT_EXAM_ROSTER') ||
      trimmed.includes('FROM CBT_SEMESTER_')
    ) {
      return 'promotion';
    }
    return 'other';
  };

  const d1: any = {
    prepare: (sql: string) => {
      overallMaxSql = Math.max(overallMaxSql, sql.length);

      const exec = (params: any[], isReadMethod: boolean) => {
        const clean = params.map((p) => (p === undefined ? null : p));
        const cat = classifyQuery(sql, isReadMethod);
        overallMaxParams = Math.max(overallMaxParams, clean.length);
        stageLogs.push({
          sql,
          category: cat,
          paramCount: clean.length,
          sqlLength: sql.length,
        });

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
        bind: (...params: any[]) => exec(params, false),
        first: async <T>() => exec([], true).first<T>(),
        all: async <T>() => exec([], true).all<T>(),
        run: async () => exec([], false).run(),
      };
    },
    batch: async (stmts: any[]) => {
      stageBatches.push(stmts.map(() => 1));
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
  };

  const snapshotStage = (stageName: string): StageQueryMetrics => {
    const preflightReads = stageLogs.filter((l) => l.category === 'read').length;
    const stagingStatements = stageLogs.filter((l) => l.category === 'staging').length;
    const promotionStatements = stageLogs.filter((l) => l.category === 'promotion').length;
    const otherStatements = stageLogs.filter((l) => l.category === 'other').length;
    const totalQueries = stageLogs.length;
    const maxBoundParams = stageLogs.reduce((max, l) => Math.max(max, l.paramCount), 0);
    const maxSqlLength = stageLogs.reduce((max, l) => Math.max(max, l.sqlLength), 0);
    const batchSizes = stageBatches.map((b) => b.length);

    const report: StageQueryMetrics = {
      stageName,
      preflightReads,
      stagingStatements,
      promotionStatements,
      otherStatements,
      totalQueries,
      maxBoundParams,
      maxSqlLength,
      batchCount: stageBatches.length,
      batchSizes,
    };

    stageLogs = [];
    stageBatches = [];
    return report;
  };

  const resetMetrics = () => {
    stageLogs = [];
    stageBatches = [];
  };

  return { d1, snapshotStage, resetMetrics, getOverall: () => ({ overallMaxParams, overallMaxSql }) };
}

function createScaleTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE cbt_events (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
      activity_type TEXT NOT NULL DEFAULT 'other',
      participant_source TEXT NOT NULL DEFAULT 'mansatas',
      status TEXT NOT NULL DEFAULT 'draft',
      academic_year_id TEXT,
      starts_at TEXT,
      ends_at TEXT,
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
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      target_grade TEXT,
      event_id TEXT REFERENCES cbt_events(id),
      subject_id TEXT,
      mode TEXT CHECK (mode IN ('pmb', 'kegiatan', 'tka', 'semester', 'ulangan')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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

    CREATE TABLE cbt_semester_participants (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL,
      nisn TEXT,
      nis_lokal TEXT,
      nama_lengkap TEXT NOT NULL,
      grade TEXT NOT NULL,
      class_id TEXT NOT NULL,
      class_name TEXT NOT NULL,
      gender TEXT,
      room_id TEXT REFERENCES cbt_rooms(id),
      nomor_peserta TEXT,
      is_room_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
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
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_semester_schedules (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL REFERENCES cbt_semester_slots(id) ON DELETE CASCADE,
      is_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE cbt_semester_exam_classes (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES cbt_events(id) ON DELETE CASCADE,
      exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
      class_id TEXT NOT NULL,
      class_name TEXT NOT NULL,
      grade TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
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
  `);

  return sqlite;
}

// ── Test Suites ──────────────────────────────────────────────

describe('Phase 7 — 1,600-Student Scale Simulation & D1 Limits Verification', () => {

  it('1. Scale simulation: 1,600 students across 50 classes, 45 rooms, 110 staff members', async () => {
    const sqlite = createScaleTestDb();
    const { d1, snapshotStage, resetMetrics } = createInstrumentedD1(sqlite);
    const eventId = 'ev-scale-1600';

    // Seed event
    await d1.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status, starts_at, ends_at)
      VALUES (?, 'SEM-SCALE', 'Semester 1600 Scale Test', 'semester', 'draft', '2026-10-01', '2026-10-05')
    `).bind(eventId).run();

    // Seed 45 rooms with capacity 36 each (total capacity: 45 * 36 = 1,620)
    for (let r = 1; r <= 45; r++) {
      const roomId = `room-${String(r).padStart(2, '0')}`;
      const roomName = `Ruang ${String(r).padStart(2, '0')}`;
      await d1.prepare(`
        INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
        VALUES (?, ?, 36, ?)
      `).bind(roomId, roomName, eventId).run();
    }

    // Seed 110 active staff members
    for (let s = 1; s <= 110; s++) {
      const staffId = `staff-${String(s).padStart(3, '0')}`;
      const name = `Staff Pengawas ${s}`;
      const nip = `1980${String(s).padStart(6, '0')}`;
      await d1.prepare(`
        INSERT INTO cbt_staff_profiles (id, nama, nip, email, is_active)
        VALUES (?, ?, ?, ?, 1)
      `).bind(staffId, name, nip, `staff${s}@mansatas.sch.id`).run();
    }

    // Seed 1,600 participants across 50 classes (32 students per class)
    const grades: Array<'10' | '11' | '12'> = ['10', '11', '12'];
    let studentCounter = 1;

    // Use fast chunked inserts for scale test preparation
    for (let c = 1; c <= 50; c++) {
      const classId = `class-${c}`;
      const grade = grades[(c - 1) % 3];
      const className = `Kelas ${grade}-${((c - 1) % 17) + 1}`;

      const chunkParticipants: any[] = [];
      for (let s = 1; s <= 32; s++) {
        const studentId = `std-${studentCounter}`;
        const pId = `p-${studentCounter}`;
        const name = `Siswa ${studentCounter}`;
        const gender = studentCounter % 2 === 0 ? 'L' : 'P';
        chunkParticipants.push([pId, eventId, studentId, name, grade, classId, className, gender]);
        studentCounter++;
      }

      for (const p of chunkParticipants) {
        await d1.prepare(`
          INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name, gender)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(...p).run();
      }
    }

    // Verify 1,600 participants seeded
    const countCheck = await d1.prepare(
      'SELECT count(*) as count FROM cbt_semester_participants WHERE event_id = ?'
    ).bind(eventId).first<{ count: number }>();
    assert.equal(countCheck?.count, 1600);

    // Reset metrics to measure ONLY the automation pipeline execution
    resetMetrics();

    // ── STAGE 1: Automated Room Allocation at 1,600 Scale ──
    const allocRes = await autoAllocateRooms(d1, eventId, 'actor-admin', {
      strategy: 'balanced',
    });
    assert.equal(allocRes.success, true);
    assert.equal(allocRes.assignedCount, 1600);
    const allocReport = snapshotStage('Stage 1: Room Allocation (1,600 Students)');

    // Verify D1 Statement & Parameter Constraints
    assert.ok(
      allocReport.maxBoundParams <= 100,
      `Stage 1 maxBoundParams (${allocReport.maxBoundParams}) must NOT exceed Cloudflare D1 limit (100)`
    );
    assert.ok(
      allocReport.maxSqlLength <= 100 * 1024,
      `Stage 1 maxSqlLength (${allocReport.maxSqlLength}) must NOT exceed 100 KB`
    );
    assert.ok(
      allocReport.batchSizes.every((sz) => sz <= 50),
      'Stage 1 batch chunks must be bounded to <= 50 statements'
    );

    // Verify all 1,600 participants have a valid room assigned
    const unallocated = await d1.prepare(
      'SELECT count(*) as cnt FROM cbt_semester_participants WHERE event_id = ? AND room_id IS NULL'
    ).bind(eventId).first<{ cnt: number }>();
    assert.equal(unallocated?.cnt, 0);

    // ── STAGE 2: Room Geometry Layout & Anti-Copying Seating Distribution ──
    // Configure layout for all 45 rooms (6 rows x 6 cols = 36 seats, 18 desk pairs)
    for (let r = 1; r <= 45; r++) {
      const roomId = `room-${String(r).padStart(2, '0')}`;
      const layoutRes = await configureRoomLayout(d1, eventId, roomId, {
        rows_count: 6,
        cols_count: 6,
        desk_group_count: 18,
        is_irregular: false,
        required_invigilators: 1,
      });
      assert.equal(layoutRes.success, true);
    }

    // Reset metrics before seating distribution execution
    resetMetrics();

    // Run auto seating distribution across all 45 rooms (1,600 seats)
    const distRes = await autoDistributeSeats(d1, eventId, 'actor-admin', {
      anti_copying_desks: true,
      seed: 12345,
    });
    assert.equal(distRes.success, true);
    assert.equal(distRes.totalAssigned, 1600);
    const seatReport = snapshotStage('Stage 2: Seating Distribution (1,600 Seats, 45 Rooms)');

    // Verify D1 parameter limit on seating staging
    assert.ok(
      seatReport.maxBoundParams <= 100,
      `Stage 2 maxBoundParams (${seatReport.maxBoundParams}) must NOT exceed Cloudflare D1 limit (100)`
    );
    assert.ok(
      seatReport.maxSqlLength <= 100 * 1024,
      `Stage 2 maxSqlLength (${seatReport.maxSqlLength}) must NOT exceed 100 KB`
    );
    assert.ok(
      seatReport.batchSizes.every((sz) => sz <= 50),
      'Stage 2 batch chunks must be bounded to <= 50 statements'
    );

    // Verify total assignments in database
    const totalSeated = await d1.prepare(
      'SELECT count(*) as cnt FROM cbt_semester_seat_assignments WHERE event_id = ?'
    ).bind(eventId).first<{ cnt: number }>();
    assert.equal(totalSeated?.cnt, 1600);

    // ── STAGE 3: Timetable Solver & Atomic Roster Synchronization ──
    // Create 3 slots
    await d1.prepare(`
      INSERT INTO cbt_semester_slots (id, event_id, slot_label, slot_date, start_time, end_time)
      VALUES
        ('slot-1', ?, 'Sesi 1', '2026-10-01', '07:30', '09:30'),
        ('slot-2', ?, 'Sesi 2', '2026-10-01', '10:00', '12:00'),
        ('slot-3', ?, 'Sesi 3', '2026-10-02', '07:30', '09:30')
    `).bind(eventId, eventId, eventId).run();

    // Create exams (all grade 10 so they conflict and require 3 distinct slots)
    await d1.prepare(`
      INSERT INTO cbt_exams (id, title, duration_minutes, target_grade, event_id, mode)
      VALUES
        ('ex-1', 'Matematika Sesi 1', 60, '10', ?, 'semester'),
        ('ex-2', 'Fisika Sesi 2', 60, '10', ?, 'semester'),
        ('ex-3', 'Kimia Sesi 3', 60, '10', ?, 'semester')
    `).bind(eventId, eventId, eventId).run();

    // Link all 50 classes to each exam so every room has participants across all 3 slots
    for (const examId of ['ex-1', 'ex-2', 'ex-3']) {
      for (let c = 1; c <= 50; c++) {
        const classId = `class-${c}`;
        await d1.prepare(`
          INSERT INTO cbt_semester_exam_classes (id, event_id, exam_id, class_id, class_name, grade)
          VALUES (?, ?, ?, ?, 'Kelas', '10')
        `).bind(`sec-${examId}-${c}`, eventId, examId, classId).run();
      }
    }

    // Seed 1,600 exam roster rows across the exams
    for (let i = 1; i <= 1600; i++) {
      const examId = i <= 550 ? 'ex-1' : i <= 1100 ? 'ex-2' : 'ex-3';
      await d1.prepare(`
        INSERT INTO cbt_exam_roster (id, exam_id, event_id, source_key, source_id, full_name, username)
        VALUES (?, ?, ?, 'student', ?, ?, ?)
      `).bind(`rost-${i}`, examId, eventId, `std-${i}`, `Siswa ${i}`, `user-${i}`).run();
    }

    resetMetrics();

    // Execute atomic timetable solver
    const ttRes = await autoSolveTimetable(d1, eventId, 'actor-admin');
    assert.equal(ttRes.success, true);
    assert.equal(ttRes.scheduledCount, 3);
    const ttReport = snapshotStage('Stage 3: Timetable Solver (Atomic Publication & Roster Sync)');

    // Verify D1 parameter and query limits on timetable solver
    assert.ok(
      ttReport.maxBoundParams <= 100,
      `Stage 3 maxBoundParams (${ttReport.maxBoundParams}) must NOT exceed Cloudflare D1 limit (100)`
    );
    assert.ok(
      ttReport.maxSqlLength <= 100 * 1024,
      `Stage 3 maxSqlLength (${ttReport.maxSqlLength}) must NOT exceed 100 KB`
    );

    // Verify roster synchronization occurred
    const rosterUpdated = await d1.prepare(
      "SELECT count(*) as cnt FROM cbt_exam_roster WHERE event_id = ? AND tanggal_tes != ''"
    ).bind(eventId).first<{ cnt: number }>();
    assert.equal(rosterUpdated?.cnt, 1600);

    // ── STAGE 4: Invigilators Automation at 1,600 Scale ──
    // Sync 110 staff members to pool
    const poolRes = await syncInvigilatorPoolFromStaff(d1, eventId);
    assert.equal(poolRes.addedCount, 110);

    resetMetrics();

    // Auto-assign invigilators across all 45 rooms x 3 slots = 135 assignments
    const invigRes = await autoAssignInvigilators(d1, eventId, 'actor-admin', {
      invigilators_per_room: 1,
    });
    assert.equal(invigRes.success, true);
    assert.equal(invigRes.totalAssigned, 135);
    const invigReport = snapshotStage('Stage 4: Invigilator Solver (135 Slots across 110 Staff)');

    // Verify D1 parameter limit on invigilators staging
    assert.ok(
      invigReport.maxBoundParams <= 100,
      `Stage 4 maxBoundParams (${invigReport.maxBoundParams}) must NOT exceed Cloudflare D1 limit (100)`
    );
    assert.ok(
      invigReport.maxSqlLength <= 100 * 1024,
      `Stage 4 maxSqlLength (${invigReport.maxSqlLength}) must NOT exceed 100 KB`
    );
    assert.ok(
      invigReport.batchSizes.every((sz) => sz <= 50),
      'Stage 4 batch chunks must be bounded to <= 50 statements'
    );

    // Check workload balancing: with 135 slots and 110 staff members:
    // Every staff member should be assigned 1 or 2 times (variance <= 1)
    const { results: staffWorkloads } = await d1.prepare(`
      SELECT staff_id, COUNT(*) as assigned_count
      FROM cbt_semester_invigilator_assignments
      WHERE event_id = ?
      GROUP BY staff_id
    `).bind(eventId).all<{ staff_id: string; assigned_count: number }>();

    const counts = (staffWorkloads || []).map((w) => w.assigned_count);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    assert.ok(maxCount - minCount <= 1, `Workload must be evenly balanced (min=${minCount}, max=${maxCount})`);

    // Output measured query counts table for reporting
    console.log('\n================ SCALE SIMULATION MEASURED QUERY COUNTS (1,600 STUDENTS) ================');
    console.table([
      {
        'Stage': allocReport.stageName,
        'Preflight Reads': allocReport.preflightReads,
        'Staging Stmts': allocReport.stagingStatements,
        'Promotion Stmts': allocReport.promotionStatements,
        'Total Queries': allocReport.totalQueries,
        'Max Bound Params': allocReport.maxBoundParams,
        'Max SQL Length': `${allocReport.maxSqlLength} B`,
        'Batches': `${allocReport.batchCount} (size <= 50)`,
      },
      {
        'Stage': seatReport.stageName,
        'Preflight Reads': seatReport.preflightReads,
        'Staging Stmts': seatReport.stagingStatements,
        'Promotion Stmts': seatReport.promotionStatements,
        'Total Queries': seatReport.totalQueries,
        'Max Bound Params': seatReport.maxBoundParams,
        'Max SQL Length': `${seatReport.maxSqlLength} B`,
        'Batches': `${seatReport.batchCount} (size <= 50)`,
      },
      {
        'Stage': ttReport.stageName,
        'Preflight Reads': ttReport.preflightReads,
        'Staging Stmts': ttReport.stagingStatements,
        'Promotion Stmts': ttReport.promotionStatements,
        'Total Queries': ttReport.totalQueries,
        'Max Bound Params': ttReport.maxBoundParams,
        'Max SQL Length': `${ttReport.maxSqlLength} B`,
        'Batches': `${ttReport.batchCount} (size <= 50)`,
      },
      {
        'Stage': invigReport.stageName,
        'Preflight Reads': invigReport.preflightReads,
        'Staging Stmts': invigReport.stagingStatements,
        'Promotion Stmts': invigReport.promotionStatements,
        'Total Queries': invigReport.totalQueries,
        'Max Bound Params': invigReport.maxBoundParams,
        'Max SQL Length': `${invigReport.maxSqlLength} B`,
        'Batches': `${invigReport.batchCount} (size <= 50)`,
      },
    ]);
    console.log('=========================================================================================\n');
  });

  it('2. Impossible shortage handling: returns clean impossible status without partial state corruption', async () => {
    const sqlite = createScaleTestDb();
    const { d1 } = createInstrumentedD1(sqlite);
    const eventId = 'ev-shortage-test';

    await d1.prepare(`
      INSERT INTO cbt_events (id, code, name, mode, status)
      VALUES (?, 'SEM-SHORT', 'Semester Shortage Test', 'semester', 'draft')
    `).bind(eventId).run();

    // 10 rooms with capacity 20 each (total capacity 200)
    for (let r = 1; r <= 10; r++) {
      await d1.prepare(`
        INSERT INTO cbt_rooms (id, room_name, capacity, event_id)
        VALUES (?, ?, 20, ?)
      `).bind(`rm-${r}`, `Ruang ${r}`, eventId).run();
    }

    // 500 participants (shortage of 300 seats)
    for (let i = 1; i <= 500; i++) {
      await d1.prepare(`
        INSERT INTO cbt_semester_participants (id, event_id, student_id, nama_lengkap, grade, class_id, class_name)
        VALUES (?, ?, ?, ?, '10', 'cls-1', 'X-1')
      `).bind(`p-sh-${i}`, eventId, `std-sh-${i}`, `Siswa ${i}`).run();
    }

    // Run room allocation: must fail cleanly with status = 'impossible'
    const allocRes = await autoAllocateRooms(d1, eventId, 'actor-admin');
    assert.equal(allocRes.success, false);
    assert.equal(allocRes.status, 'impossible');
    assert.ok(allocRes.shortage);
    assert.equal(allocRes.shortage.deficit, 300);

    // Verify no partial writes occurred: 0 participants have room assigned
    const assignedCount = await d1.prepare(
      'SELECT count(*) as cnt FROM cbt_semester_participants WHERE event_id = ? AND room_id IS NOT NULL'
    ).bind(eventId).first<{ cnt: number }>();
    assert.equal(assignedCount?.cnt, 0);

    // Verify staging table is empty
    const stagingCount = await d1.prepare(
      'SELECT count(*) as cnt FROM cbt_semester_rooms_staging WHERE event_id = ?'
    ).bind(eventId).first<{ cnt: number }>();
    assert.equal(stagingCount?.cnt, 0);

    // Verify immutable generation audit log recorded the impossible state
    const logs = await getGenerationLogs(d1, eventId, 'room_allocation');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'impossible');
    assert.match(logs[0].summary, /insufficient/);
  });
});
