// ============================================================
// Semester Domain — Academic Audience & Roster Service
//
// Manages the multi-class academic audience per Semester exam.
// Enforces:
// 1. Authoritative class discovery from penugasan_mengajar with deduplication
// 2. Class grade matching exam target_grade
// 3. Disjoint class audiences across exams for the same subject
// 4. Clean roster materialization (entitled participants matching audience)
// 5. Post-freeze independence
// ============================================================

import type { SemesterExamClass } from './types.ts';
import { assertSemesterEvent, EventFrozenError } from './events.ts';
import { formatStudentClassName } from '../../sources/students.ts';
import { newId, now } from '../../../utils/helpers.ts';

export interface ClassDiscoveryOption {
  class_id: string;
  class_name: string;
  grade: string;
  kelompok: string;
  nomor_kelas: string;
}

/**
 * Discovers available classes for a given grade and subject from MANSATAS_DB.
 * Deduplicates multiple teachers teaching the same class/subject.
 */
export async function discoverAvailableClasses(
  mansatasDb: D1Database,
  grade: string,
  subjectId?: string,
  academicYearId?: string
): Promise<ClassDiscoveryOption[]> {
  // If subjectId and academicYearId are provided, try penugasan_mengajar first
  if (subjectId && academicYearId) {
    const sql = `
      SELECT DISTINCT k.id AS class_id, k.tingkat, k.kelompok, k.nomor_kelas
      FROM penugasan_mengajar pm
      JOIN kelas k ON pm.kelas_id = k.id
      WHERE pm.mapel_id = ?
        AND pm.tahun_ajaran_id = ?
        AND k.tingkat = ?
      ORDER BY k.kelompok ASC, CAST(k.nomor_kelas AS INTEGER) ASC
    `;
    const { results } = await mansatasDb
      .prepare(sql)
      .bind(subjectId, academicYearId, grade)
      .all<any>();

    if (results && results.length > 0) {
      return results.map((r) => ({
        class_id: String(r.class_id),
        class_name: formatStudentClassName(r.tingkat, r.kelompok, r.nomor_kelas),
        grade: String(r.tingkat),
        kelompok: String(r.kelompok || ''),
        nomor_kelas: String(r.nomor_kelas || ''),
      }));
    }
  }

  // Fallback: list all classes for the target grade
  const sql = `
    SELECT id AS class_id, tingkat, kelompok, nomor_kelas
    FROM kelas
    WHERE tingkat = ?
    ORDER BY kelompok ASC, CAST(nomor_kelas AS INTEGER) ASC
  `;
  const { results } = await mansatasDb.prepare(sql).bind(grade).all<any>();

  return (results || []).map((r) => ({
    class_id: String(r.class_id),
    class_name: formatStudentClassName(r.tingkat, r.kelompok, r.nomor_kelas),
    grade: String(r.tingkat),
    kelompok: String(r.kelompok || ''),
    nomor_kelas: String(r.nomor_kelas || ''),
  }));
}

/**
 * Lists classes assigned to a specific Semester exam.
 */
export async function listSemesterExamClasses(
  db: D1Database,
  eventId: string,
  examId: string
): Promise<SemesterExamClass[]> {
  await assertSemesterEvent(db, eventId);

  const { results } = await db
    .prepare(
      `SELECT * FROM cbt_semester_exam_classes
       WHERE event_id = ? AND exam_id = ?
       ORDER BY class_name ASC`
    )
    .bind(eventId, examId)
    .all<SemesterExamClass>();

  return results || [];
}

/**
 * Assigns classes to a Semester exam, replacing or synchronizing the academic audience.
 */
export async function assignSemesterExamClasses(
  db: D1Database,
  mansatasDb: D1Database,
  eventId: string,
  examId: string,
  classIds: string[]
): Promise<{ assignedCount: number }> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Cakupan kelas ujian dibekukan pada status ready atau lebih tinggi.');
  }

  // Verify exam belongs to event and is semester
  const exam = await db
    .prepare('SELECT id, event_id, mode, subject_id, target_grade FROM cbt_exams WHERE id = ?')
    .bind(examId)
    .first<{ id: string; event_id: string; mode: string; subject_id: string; target_grade: string }>();

  if (!exam) {
    throw new Error('Ujian tidak ditemukan');
  }
  if (exam.event_id !== eventId || exam.mode !== 'semester') {
    throw new Error('Ujian tidak cocok dengan event semester ini');
  }
  if (!exam.target_grade) {
    throw new Error('Ujian semester harus memiliki target_grade yang valid sebelum menetapkan kelas');
  }

  // If empty classIds, delete existing audience
  if (!classIds || classIds.length === 0) {
    await db
      .prepare('DELETE FROM cbt_semester_exam_classes WHERE exam_id = ? AND event_id = ?')
      .bind(examId, eventId)
      .run();
    return { assignedCount: 0 };
  }

  // Reject empty or synthetic class IDs
  for (const cid of classIds) {
    const cleanId = String(cid || '').trim();
    if (!cleanId) {
      throw new Error('ID kelas tidak boleh kosong');
    }
    if (cleanId.startsWith('sem-') || cleanId.startsWith('fake-') || cleanId.startsWith('test-')) {
      throw new Error(`ID kelas sintetis '${cleanId}' ditolak. Gunakan ID kelas resmi dari Mansatas.`);
    }
  }

  // Verify classes from MANSATAS_DB
  const placeholders = classIds.map(() => '?').join(',');
  const { results: sourceClasses } = await mansatasDb
    .prepare(
      `SELECT id, tingkat, kelompok, nomor_kelas
       FROM kelas
       WHERE id IN (${placeholders})`
    )
    .bind(...classIds)
    .all<any>();

  const classMap = new Map<string, { id: string; name: string; grade: string }>();
  for (const c of sourceClasses || []) {
    classMap.set(String(c.id), {
      id: String(c.id),
      name: formatStudentClassName(c.tingkat, c.kelompok, c.nomor_kelas),
      grade: String(c.tingkat),
    });
  }

  for (const cid of classIds) {
    const verified = classMap.get(cid);
    if (!verified) {
      throw new Error(`Kelas dengan ID '${cid}' tidak ditemukan di database master Mansatas.`);
    }
    if (verified.grade !== exam.target_grade) {
      throw new Error(
        `Tingkat kelas '${verified.name}' (Tingkat ${verified.grade}) tidak sesuai dengan target_grade ujian (Tingkat ${exam.target_grade}).`
      );
    }
  }

  // Verify academic applicability from penugasan_mengajar if assigned for this subject & academic year
  if (event.academic_year_id && exam.subject_id) {
    const penugasanClasses = await mansatasDb
      .prepare(
        `SELECT DISTINCT kelas_id FROM penugasan_mengajar
         WHERE mapel_id = ? AND tahun_ajaran_id = ?`
      )
      .bind(exam.subject_id, event.academic_year_id)
      .all<{ kelas_id: string }>();

    if (penugasanClasses.results && penugasanClasses.results.length > 0) {
      const allowedClassIds = new Set(penugasanClasses.results.map((r) => String(r.kelas_id)));
      for (const cid of classIds) {
        if (!allowedClassIds.has(cid)) {
          const cls = classMap.get(cid);
          throw new Error(
            `Kelas '${cls?.name || cid}' tidak memiliki alokasi pembelajaran resmi untuk mata pelajaran ini pada Tahun Ajaran tersebut.`
          );
        }
      }
    }
  }

  // Check disjointness: check if any of these classes are already assigned to another exam for the same subject
  for (const cid of classIds) {
    const conflict = await db
      .prepare(
        `SELECT sec.exam_id, e.title
         FROM cbt_semester_exam_classes sec
         JOIN cbt_exams e ON e.id = sec.exam_id
         WHERE sec.event_id = ?
           AND sec.class_id = ?
           AND sec.exam_id != ?
           AND e.subject_id = ?
         LIMIT 1`
      )
      .bind(eventId, cid, examId, exam.subject_id)
      .first<{ exam_id: string; title: string }>();

    if (conflict) {
      const cls = classMap.get(cid);
      throw new Error(
        `Kelas '${cls?.name || cid}' sudah terdaftar pada ujian lain untuk mata pelajaran yang sama: '${conflict.title}'. Satu kelas hanya boleh memiliki satu ujian per mata pelajaran.`
      );
    }
  }

  // Atomic update: remove old classes not in list, insert new classes
  await db
    .prepare('DELETE FROM cbt_semester_exam_classes WHERE exam_id = ? AND event_id = ?')
    .bind(examId, eventId)
    .run();

  const currentTimestamp = now();
  for (const cid of classIds) {
    const cls = classMap.get(cid)!;
    await db
      .prepare(
        `INSERT INTO cbt_semester_exam_classes (
          id, event_id, exam_id, class_id, class_name, grade, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(newId(), eventId, examId, cls.id, cls.name, cls.grade, currentTimestamp)
      .run();
  }

  return { assignedCount: classIds.length };
}

/**
 * Materializes cbt_exam_roster for a Semester exam based strictly on assigned audience classes.
 */
export async function materializeSemesterExamRoster(
  db: D1Database,
  eventId: string,
  examId: string
): Promise<{ enrolledCount: number; removedCount: number }> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Roster ujian dibekukan pada status ready atau lebih tinggi.');
  }

  // 1. Get exam details
  const exam = await db
    .prepare('SELECT id, event_id, mode, target_grade FROM cbt_exams WHERE id = ?')
    .bind(examId)
    .first<{ id: string; event_id: string; mode: string; target_grade: string }>();

  if (!exam || exam.event_id !== eventId || exam.mode !== 'semester') {
    throw new Error('Ujian semester tidak valid');
  }

  // 2. Fetch assigned classes for this exam
  const { results: assignedClasses } = await db
    .prepare('SELECT class_id FROM cbt_semester_exam_classes WHERE exam_id = ? AND event_id = ?')
    .bind(examId, eventId)
    .all<{ class_id: string }>();

  const classIdList = (assignedClasses || []).map((c) => c.class_id);

  // 3. Remove existing roster entries that are no longer in the assigned classes (if no sessions exist)
  let removedCount = 0;
  if (classIdList.length > 0) {
    const placeholders = classIdList.map(() => '?').join(',');
    const deleteSql = `
      DELETE FROM cbt_exam_roster
      WHERE exam_id = ?
        AND event_id = ?
        AND source_id NOT IN (
          SELECT student_id FROM cbt_semester_participants
          WHERE event_id = ? AND class_id IN (${placeholders})
        )
        AND source_id NOT IN (
          SELECT s.user_id FROM cbt_exam_sessions s WHERE s.exam_id = ?
        )
    `;
    const res = await db.prepare(deleteSql).bind(examId, eventId, eventId, ...classIdList, examId).run();
    removedCount = res.meta?.changes || 0;
  } else {
    // If no classes assigned, remove all roster entries without sessions
    const deleteSql = `
      DELETE FROM cbt_exam_roster
      WHERE exam_id = ?
        AND event_id = ?
        AND source_id NOT IN (
          SELECT s.user_id FROM cbt_exam_sessions s WHERE s.exam_id = ?
        )
    `;
    const res = await db.prepare(deleteSql).bind(examId, eventId, examId).run();
    removedCount = res.meta?.changes || 0;
  }

  // 4. Materialize new/missing roster entries strictly from cbt_semester_participants matching assigned classes
  if (classIdList.length === 0) {
    return { enrolledCount: 0, removedCount };
  }

  const insertSql = `
    INSERT OR IGNORE INTO cbt_exam_roster (
      id, exam_id, event_id, source_key, source_id, username, nisn, full_name,
      class_name, grade, gender, is_active, room_id, tanggal_tes, sesi_tes,
      created_at, updated_at
    )
    SELECT
      lower(hex(randomblob(16))),
      sec.exam_id,
      sp.event_id,
      'mansatas',
      sp.student_id,
      COALESCE(sp.nisn, sp.student_id),
      sp.nisn,
      sp.nama_lengkap,
      sp.class_name,
      sp.grade,
      sp.gender,
      1,
      sp.room_id,
      COALESCE(sl.slot_date, ''),
      CASE WHEN sl.id IS NOT NULL THEN (sl.slot_label || ' (' || sl.start_time || ' - ' || sl.end_time || ' WIB)') ELSE '' END,
      datetime('now'),
      datetime('now')
    FROM cbt_semester_exam_classes sec
    JOIN cbt_exams e ON e.id = sec.exam_id
    JOIN cbt_semester_participants sp
      ON sp.event_id = sec.event_id AND sp.class_id = sec.class_id AND sp.grade = e.target_grade
    LEFT JOIN cbt_semester_schedules sch
      ON sch.exam_id = sec.exam_id AND sch.event_id = sec.event_id
    LEFT JOIN cbt_semester_slots sl
      ON sl.id = sch.slot_id AND sl.event_id = sec.event_id
    WHERE sec.exam_id = ?
  `;

  await db.prepare(insertSql).bind(examId).run();

  const countRow = await db
    .prepare('SELECT COUNT(*) as total FROM cbt_exam_roster WHERE exam_id = ?')
    .bind(examId)
    .first<{ total: number }>();

  return { enrolledCount: countRow?.total || 0, removedCount };
}

/**
 * Materializes rosters for all Semester exams in an event.
 */
export async function materializeAllSemesterRosters(
  db: D1Database,
  eventId: string
): Promise<{ totalExamsProcessed: number; totalRosterEntries: number }> {
  await assertSemesterEvent(db, eventId);

  const { results: exams } = await db
    .prepare("SELECT id FROM cbt_exams WHERE event_id = ? AND mode = 'semester'")
    .bind(eventId)
    .all<{ id: string }>();

  let totalRosterEntries = 0;

  for (const exam of exams || []) {
    const { enrolledCount } = await materializeSemesterExamRoster(db, eventId, exam.id);
    totalRosterEntries += enrolledCount;
  }

  return {
    totalExamsProcessed: (exams || []).length,
    totalRosterEntries,
  };
}
