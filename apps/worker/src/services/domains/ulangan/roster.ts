// ============================================================
// Ulangan Roster Service
//
// Manages participant snapshots for teacher Ulangan Harian assessments.
// Snapshots are derived server-side strictly from the teacher's
// assigned class in Mansatas. Students in Ulangan have room_id = NULL.
// ============================================================

import { newId, now } from '../../../utils/helpers.ts';
import { listActiveStudentsInClass } from '../../sources/teaching-assignments.ts';
import { assertUlanganOwnership } from './exams.ts';

export interface RosterSnapshotResult {
  matched: number;
  added: number;
  skipped: number;
}

/**
 * Snapshots the whole assigned class into cbt_exam_roster.
 * Server-authoritative: class_id is derived from stored exam context.
 */
export async function snapshotWholeClassRoster(
  db: D1Database,
  mansatasDb: D1Database | undefined,
  examId: string,
  user: any
): Promise<RosterSnapshotResult> {
  const { exam } = await assertUlanganOwnership(db, examId, user);

  if (!exam.class_id) {
    throw new Error('Ulangan ini belum memiliki konteks kelas penugasan mengajar');
  }

  if (!mansatasDb) {
    throw new Error('Koneksi database MANSATAS_DB belum tersedia');
  }

  // Load active students from the assigned class
  const students = await listActiveStudentsInClass(mansatasDb, exam.class_id);

  if (students.length === 0) {
    return { matched: 0, added: 0, skipped: 0 };
  }

  // Batch insert statements with room_id = NULL (no fake rooms!)
  const statements = students.map((s) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO cbt_exam_roster
           (id, exam_id, event_id, source_key, source_id, username, nisn, full_name,
            class_name, grade, gender, is_active, metadata_json, room_id,
            tanggal_tes, sesi_tes, created_at, updated_at)
         VALUES (?, ?, ?, 'mansatas', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', '', ?, ?)`
      )
      .bind(
        newId(),
        examId,
        exam.event_id,
        s.source_id,
        s.username,
        s.nisn || null,
        s.full_name,
        s.class_name || exam.class_name || null,
        s.grade || null,
        s.gender || null,
        s.is_active ? 1 : 0,
        JSON.stringify(s.metadata || {}),
        now(),
        now()
      )
  );

  let added = 0;
  const CHUNK_SIZE = 50;
  for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
    const chunk = statements.slice(i, i + CHUNK_SIZE);
    const results = await db.batch(chunk);
    added += results.reduce((sum, res: any) => sum + Number(res?.meta?.changes || 0), 0);
  }

  const skipped = Math.max(0, students.length - added);
  return {
    matched: students.length,
    added,
    skipped,
  };
}

/**
 * Lists snapshotted roster participants for an Ulangan exam.
 */
export async function listUlanganRoster(
  db: D1Database,
  examId: string,
  user: any
): Promise<any[]> {
  await assertUlanganOwnership(db, examId, user);

  const { results } = await db
    .prepare(
      `SELECT id, exam_id, event_id, source_key, source_id, username, nisn, full_name,
              class_name, grade, gender, is_active, room_id, tanggal_tes, sesi_tes,
              created_at, updated_at
       FROM cbt_exam_roster
       WHERE exam_id = ?
       ORDER BY full_name ASC`
    )
    .bind(examId)
    .all<any>();

  return results || [];
}

/**
 * Removes a student from the Ulangan roster before any attempts have occurred.
 */
export async function removeStudentFromUlanganRoster(
  db: D1Database,
  examId: string,
  rosterId: string,
  user: any
): Promise<{ success: boolean; error?: string }> {
  await assertUlanganOwnership(db, examId, user);

  const rosterRow = await db
    .prepare('SELECT id, source_id, source_key FROM cbt_exam_roster WHERE id = ? AND exam_id = ?')
    .bind(rosterId, examId)
    .first<any>();

  if (!rosterRow) {
    return { success: false, error: 'Peserta roster tidak ditemukan' };
  }

  // Check if student has already started a session
  const sessionCheck = await db
    .prepare('SELECT id, status FROM cbt_exam_sessions WHERE exam_id = ? AND user_id = ?')
    .bind(examId, rosterRow.source_id)
    .first<any>();

  if (sessionCheck) {
    return {
      success: false,
      error: 'Peserta tidak dapat dihapus karena sudah memiliki sesi ujian',
    };
  }

  await db
    .prepare('DELETE FROM cbt_exam_roster WHERE id = ? AND exam_id = ?')
    .bind(rosterId, examId)
    .run();

  return { success: true };
}

/**
 * Clears all roster participants for an Ulangan exam before any attempts have occurred.
 */
export async function clearUlanganRoster(
  db: D1Database,
  examId: string,
  user: any
): Promise<{ success: boolean; removed_count: number }> {
  await assertUlanganOwnership(db, examId, user);

  const sessionCheck = await db
    .prepare('SELECT COUNT(*) as cnt FROM cbt_exam_sessions WHERE exam_id = ?')
    .bind(examId)
    .first<any>();

  if (Number(sessionCheck?.cnt || 0) > 0) {
    throw new Error('Peserta tidak dapat dikosongkan karena sudah ada pengerjaan ujian');
  }

  const info = await db
    .prepare('DELETE FROM cbt_exam_roster WHERE exam_id = ?')
    .bind(examId)
    .run();

  return { success: true, removed_count: info.meta.changes || 0 };
}

