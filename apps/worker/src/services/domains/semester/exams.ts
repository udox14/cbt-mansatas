// ============================================================
// Semester Domain — Exam Management Service
//
// Manages Semester exam creation, updates, and subject verification.
// Enforces:
// 1. Structural integrity (mode = 'semester', non-null event_id, target_grade in 10,11,12)
// 2. Verified real Mansatas subject_id from MANSATAS_DB.mata_pelajaran
// 3. Subject grade compatibility when mata_pelajaran.tingkat is restrictive
// 4. Snapshots subject_name into CBT
// 5. Freeze boundary and session-aware deletion protection
// ============================================================

import type { CbtExam } from '../../../types.ts';
import { assertSemesterEvent, EventFrozenError } from './events.ts';
import { newId, now } from '../../../utils/helpers.ts';

export interface CreateSemesterExamInput {
  title: string;
  description?: string;
  duration_minutes: number;
  subject_id: string;
  target_grade: '10' | '11' | '12';
  passing_score?: number;
  randomize_questions?: boolean;
  randomize_options?: boolean;
  rules_text?: string;
}

export interface UpdateSemesterExamInput {
  title?: string;
  description?: string;
  duration_minutes?: number;
  subject_id?: string;
  target_grade?: '10' | '11' | '12';
  passing_score?: number;
  randomize_questions?: boolean;
  randomize_options?: boolean;
  rules_text?: string;
}

/**
 * Verifies that a subject exists in MANSATAS_DB and is compatible with target_grade.
 */
export async function verifyMansatasSubject(
  mansatasDb: D1Database,
  subjectId: string,
  targetGrade?: string
): Promise<{ id: string; nama_mapel: string; kode_mapel: string | null }> {
  const cleanId = subjectId?.trim();
  if (!cleanId) {
    throw new Error('subject_id wajib diisi');
  }

  // Reject synthetic IDs
  if (cleanId.startsWith('sem-') || cleanId.startsWith('test-') || cleanId.startsWith('fake-')) {
    throw new Error(`ID mata pelajaran sintetis '${cleanId}' ditolak. Gunakan ID mata pelajaran resmi dari Mansatas.`);
  }

  const row = await mansatasDb
    .prepare('SELECT id, nama_mapel, kode_mapel, tingkat FROM mata_pelajaran WHERE id = ?')
    .bind(cleanId)
    .first<any>();

  if (!row) {
    throw new Error(`Mata pelajaran dengan ID '${cleanId}' tidak ditemukan di database master Mansatas.`);
  }

  if (targetGrade && row.tingkat != null) {
    const mapelTingkat = String(row.tingkat).trim();
    if (mapelTingkat && mapelTingkat !== targetGrade) {
      throw new Error(
        `Mata pelajaran '${row.nama_mapel}' diperuntukkan khusus untuk Tingkat ${mapelTingkat}, tidak cocok dengan target_grade ujian (Tingkat ${targetGrade}).`
      );
    }
  }

  return {
    id: String(row.id),
    nama_mapel: String(row.nama_mapel || '').trim(),
    kode_mapel: row.kode_mapel ? String(row.kode_mapel).trim() : null,
  };
}

/**
 * Lists all Semester exams for a specific event.
 */
export async function listSemesterExams(
  db: D1Database,
  eventId: string,
  filters: { target_grade?: string } = {}
): Promise<CbtExam[]> {
  await assertSemesterEvent(db, eventId);

  let sql = "SELECT * FROM cbt_exams WHERE event_id = ? AND mode = 'semester'";
  const params: any[] = [eventId];

  if (filters.target_grade) {
    sql += ' AND target_grade = ?';
    params.push(filters.target_grade);
  }

  sql += ' ORDER BY target_grade ASC, title ASC';

  const { results } = await db.prepare(sql).bind(...params).all<CbtExam>();
  return results || [];
}

/**
 * Retrieves a single Semester exam by ID.
 */
export async function getSemesterExamById(
  db: D1Database,
  eventId: string,
  examId: string
): Promise<CbtExam> {
  await assertSemesterEvent(db, eventId);

  const exam = await db
    .prepare("SELECT * FROM cbt_exams WHERE id = ? AND event_id = ? AND mode = 'semester'")
    .bind(examId, eventId)
    .first<CbtExam>();

  if (!exam) {
    throw new Error('Ujian semester tidak ditemukan');
  }

  return exam;
}

/**
 * Creates a new Semester exam with verified Mansatas subject.
 */
export async function createSemesterExam(
  db: D1Database,
  mansatasDb: D1Database,
  eventId: string,
  input: CreateSemesterExamInput,
  createdBy?: string
): Promise<CbtExam> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Pembuatan ujian semester dibekukan pada status ready atau lebih tinggi.');
  }

  if (!['10', '11', '12'].includes(input.target_grade)) {
    throw new Error(`target_grade '${input.target_grade}' tidak valid. Harus salah satu dari ('10', '11', '12').`);
  }

  // Verify subject from Mansatas
  const verifiedSubject = await verifyMansatasSubject(mansatasDb, input.subject_id, input.target_grade);

  const id = newId();
  const currentTimestamp = now();
  const title = input.title?.trim() || `${verifiedSubject.nama_mapel} Kelas ${input.target_grade}`;
  const duration = Math.max(1, input.duration_minutes || 60);

  await db
    .prepare(
      `INSERT INTO cbt_exams (
        id, title, description, duration_minutes, rules_text, is_score_visible,
        randomize_questions, randomize_options, active_status, passing_score,
        event_id, subject_name, subject_id, target_grade, sequence_order,
        cheat_limit, cheat_action, enforce_fullscreen, mode, is_frozen,
        created_by, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, 0,
        ?, ?, ?, ?,
        ?, ?, ?, ?, 0,
        3, 'lock', 0, 'semester', 0,
        ?, ?, ?
      )`
    )
    .bind(
      id,
      title,
      input.description || null,
      duration,
      input.rules_text || null,
      input.randomize_questions ? 1 : 0,
      input.randomize_options ? 1 : 0,
      event.status,
      input.passing_score || 0,
      eventId,
      verifiedSubject.nama_mapel,
      verifiedSubject.id,
      input.target_grade,
      createdBy || null,
      currentTimestamp,
      currentTimestamp
    )
    .run();

  return (await getSemesterExamById(db, eventId, id))!;
}

/**
 * Updates an existing Semester exam.
 */
export async function updateSemesterExam(
  db: D1Database,
  mansatasDb: D1Database,
  eventId: string,
  examId: string,
  input: UpdateSemesterExamInput
): Promise<CbtExam> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Pembaruan ujian semester dibekukan pada status ready atau lebih tinggi.');
  }

  const existing = await getSemesterExamById(db, eventId, examId);

  const updates: string[] = [];
  const params: any[] = [];

  const targetGrade = input.target_grade || (existing.target_grade as '10' | '11' | '12');
  if (input.target_grade && !['10', '11', '12'].includes(input.target_grade)) {
    throw new Error(`target_grade '${input.target_grade}' tidak valid.`);
  }

  if (input.target_grade !== undefined) {
    updates.push('target_grade = ?');
    params.push(input.target_grade);
  }

  if (input.subject_id !== undefined) {
    const verified = await verifyMansatasSubject(mansatasDb, input.subject_id, targetGrade);
    updates.push('subject_id = ?', 'subject_name = ?');
    params.push(verified.id, verified.nama_mapel);
  }

  if (input.title !== undefined) {
    updates.push('title = ?');
    params.push(input.title.trim());
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    params.push(input.description);
  }
  if (input.duration_minutes !== undefined) {
    updates.push('duration_minutes = ?');
    params.push(Math.max(1, input.duration_minutes));
  }
  if (input.passing_score !== undefined) {
    updates.push('passing_score = ?');
    params.push(input.passing_score);
  }
  if (input.randomize_questions !== undefined) {
    updates.push('randomize_questions = ?');
    params.push(input.randomize_questions ? 1 : 0);
  }
  if (input.randomize_options !== undefined) {
    updates.push('randomize_options = ?');
    params.push(input.randomize_options ? 1 : 0);
  }
  if (input.rules_text !== undefined) {
    updates.push('rules_text = ?');
    params.push(input.rules_text);
  }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    params.push(now());
    params.push(examId);
    params.push(eventId);

    await db
      .prepare(`UPDATE cbt_exams SET ${updates.join(', ')} WHERE id = ? AND event_id = ?`)
      .bind(...params)
      .run();
  }

  return (await getSemesterExamById(db, eventId, examId))!;
}

/**
 * Safely deletes a Semester exam.
 */
export async function deleteSemesterExam(
  db: D1Database,
  eventId: string,
  examId: string
): Promise<void> {
  const event = await assertSemesterEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Penghapusan ujian dibekukan pada status ready atau lebih tinggi.');
  }

  await getSemesterExamById(db, eventId, examId);

  const sessionCheck = await db
    .prepare('SELECT COUNT(*) as count FROM cbt_exam_sessions WHERE exam_id = ?')
    .bind(examId)
    .first<{ count: number }>();

  if (sessionCheck && sessionCheck.count > 0) {
    throw new Error(`Ujian tidak dapat dihapus karena sudah memiliki ${sessionCheck.count} sesi siswa.`);
  }

  // Delete bound classes, schedules, tokens, and exam
  await db.prepare('DELETE FROM cbt_semester_exam_classes WHERE exam_id = ?').bind(examId).run();
  await db.prepare('DELETE FROM cbt_semester_schedules WHERE exam_id = ?').bind(examId).run();
  await db.prepare('DELETE FROM cbt_exam_tokens WHERE exam_id = ?').bind(examId).run();
  await db.prepare('DELETE FROM cbt_exam_roster WHERE exam_id = ?').bind(examId).run();
  await db.prepare('DELETE FROM cbt_exams WHERE id = ? AND event_id = ?').bind(examId, eventId).run();
}
