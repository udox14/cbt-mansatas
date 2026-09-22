// ============================================================
// TKA Domain — Subject Exam Management Service
//
// Handles:
// 1. Subject exam creation enforcing:
//    "One TKA Exam Per Subject Per Event" invariant
// 2. Subject coverage calculation (participant counts per mapel)
// 3. Exam listing, updates, and safe pre-ready deletion
// ============================================================

import type { CbtExam } from '../../../types.ts';
import { newId, now } from '../../../utils/helpers.ts';
import { assertTkaEvent, EventFrozenError } from './events.ts';
import { generateTkaExamRosters } from './snapshot.ts';
import { assertAllowedTkaSubjectId } from './canonical-subjects.ts';
import { fetchMansatasSubjects } from '../../sources/tka.ts';
import { createExam, deleteExam } from '../../exam-engine/exams.ts';

export interface TkaSubjectCoverageItem {
  subject_id: string;
  subject_name: string;
  category: 'wajib' | 'pilihan';
  participant_count: number;
  exam_id: string | null;
  exam_title: string | null;
  exam_status: string | null;
  question_count: number;
  has_exam: boolean;
}

/**
 * Lists all subject exams under a TKA event.
 */
export async function listTkaExams(db: D1Database, eventId: string): Promise<any[]> {
  await assertTkaEvent(db, eventId);

  const { results: exams } = await db
    .prepare(
      `SELECT e.*,
              COUNT(DISTINCT q.id) as question_count,
              COUNT(DISTINCT r.id) as roster_count
       FROM cbt_exams e
       LEFT JOIN cbt_questions q ON e.id = q.exam_id
       LEFT JOIN cbt_exam_roster r ON e.id = r.exam_id
       WHERE e.event_id = ? AND e.mode = 'tka'
       GROUP BY e.id
       ORDER BY e.sequence_order ASC, e.subject_name ASC`
    )
    .bind(eventId)
    .all<any>();

  return exams || [];
}

/**
 * Computes exact subject coverage from valid snapshotted participants.
 */
export async function getTkaSubjectCoverage(
  db: D1Database,
  mansatasDb: D1Database,
  eventId: string
): Promise<TkaSubjectCoverageItem[]> {
  await assertTkaEvent(db, eventId);

  const mansatasSubjects = await fetchMansatasSubjects(mansatasDb);
  const subjectMap = new Map<string, string>();
  for (const s of mansatasSubjects) {
    subjectMap.set(s.id, s.nama_mapel);
  }

  // 1. Count valid participants
  const validPartsRow = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM cbt_tka_participants WHERE event_id = ? AND validation_status = 'valid'"
    )
    .bind(eventId)
    .first<any>();
  const totalValid = Number(validPartsRow?.cnt || 0);

  // 2. Identify Mandatory Subjects from Mansatas mata_pelajaran
  const mandatorySubjects: Array<{ id: string; nama_mapel: string }> = [];
  for (const s of mansatasSubjects) {
    const clean = s.nama_mapel.trim().toLowerCase();
    if (clean === 'matematika' || clean === 'bahasa indonesia' || clean === 'bahasa inggris') {
      mandatorySubjects.push(s);
    }
  }

  // 3. Count choices per elective subject
  const { results: p1Counts } = await db
    .prepare(
      `SELECT mapel_pilihan1_subject_id as sid, COUNT(*) as cnt
       FROM cbt_tka_participants
       WHERE event_id = ? AND validation_status = 'valid' AND mapel_pilihan1_subject_id IS NOT NULL
       GROUP BY mapel_pilihan1_subject_id`
    )
    .bind(eventId)
    .all<any>();

  const { results: p2Counts } = await db
    .prepare(
      `SELECT mapel_pilihan2_subject_id as sid, COUNT(*) as cnt
       FROM cbt_tka_participants
       WHERE event_id = ? AND validation_status = 'valid' AND mapel_pilihan2_subject_id IS NOT NULL
       GROUP BY mapel_pilihan2_subject_id`
    )
    .bind(eventId)
    .all<any>();

  const electiveCounts = new Map<string, number>();
  for (const r of p1Counts || []) {
    electiveCounts.set(r.sid, (electiveCounts.get(r.sid) || 0) + Number(r.cnt));
  }
  for (const r of p2Counts || []) {
    electiveCounts.set(r.sid, (electiveCounts.get(r.sid) || 0) + Number(r.cnt));
  }

  // 4. Fetch existing exams under this event
  const { results: existingExams } = await db
    .prepare(
      `SELECT e.id, e.title, e.subject_id, e.subject_name, e.active_status,
              COUNT(q.id) as question_count
       FROM cbt_exams e
       LEFT JOIN cbt_questions q ON e.id = q.exam_id
       WHERE e.event_id = ? AND e.mode = 'tka'
       GROUP BY e.id`
    )
    .bind(eventId)
    .all<any>();

  const examBySubjectId = new Map<string, any>();
  for (const x of existingExams || []) {
    if (x.subject_id) examBySubjectId.set(x.subject_id, x);
  }

  const coverage: TkaSubjectCoverageItem[] = [];

  // Add Mandatory Subjects
  for (const m of mandatorySubjects) {
    const exam = examBySubjectId.get(m.id);
    coverage.push({
      subject_id: m.id,
      subject_name: m.nama_mapel,
      category: 'wajib',
      participant_count: totalValid,
      exam_id: exam ? exam.id : null,
      exam_title: exam ? exam.title : null,
      exam_status: exam ? exam.active_status : null,
      question_count: exam ? Number(exam.question_count || 0) : 0,
      has_exam: Boolean(exam),
    });
  }

  // Add Elective Subjects chosen by participants
  for (const [sid, count] of electiveCounts.entries()) {
    const exam = examBySubjectId.get(sid);
    const sName = subjectMap.get(sid) || sid;
    coverage.push({
      subject_id: sid,
      subject_name: sName,
      category: 'pilihan',
      participant_count: count,
      exam_id: exam ? exam.id : null,
      exam_title: exam ? exam.title : null,
      exam_status: exam ? exam.active_status : null,
      question_count: exam ? Number(exam.question_count || 0) : 0,
      has_exam: Boolean(exam),
    });
  }

  return coverage;
}

/**
 * Creates a subject exam under a TKA event.
 * Enforces: One TKA exam per subject per event invariant!
 */
export async function createTkaExam(
  db: D1Database,
  mansatasDb: D1Database,
  eventId: string,
  input: {
    subject_id: string;
    title?: string;
    duration_minutes?: number;
    passing_score?: number;
    randomize_questions?: number;
    randomize_options?: number;
  },
  createdBy: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  const event = await assertTkaEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Tidak dapat menambah ujian pada event TKA yang sudah berstatus Ready atau lebih');
  }

  const cleanSubjectId = (input.subject_id || '').trim();
  if (!cleanSubjectId) {
    return { success: false, error: 'Mata pelajaran (subject_id) wajib dipilih dan tidak boleh kosong' };
  }

  // 1. Verify subject_id exists in Mansatas mata_pelajaran AND belongs to canonical TKA registry
  const subjectCheck = await assertAllowedTkaSubjectId(mansatasDb, cleanSubjectId);
  if (!subjectCheck.success) {
    return {
      success: false,
      error: subjectCheck.error,
    };
  }

  const subjectId = cleanSubjectId;
  const subjectName = subjectCheck.subjectName!;

  // 2. Application Guard: Invariant check (At most one exam per subject in TKA event)
  const existingExam = await db
    .prepare("SELECT id FROM cbt_exams WHERE event_id = ? AND subject_id = ? AND mode = 'tka'")
    .bind(eventId, subjectId)
    .first();

  if (existingExam) {
    return {
      success: false,
      error: `Ujian untuk mata pelajaran '${subjectName}' sudah ada dalam event TKA ini. Satu mapel hanya boleh memiliki 1 ujian.`,
    };
  }

  const examTitle = (input.title || '').trim() || `TKA ${subjectName}`;

  const examPayload = {
    title: examTitle,
    event_id: eventId,
    mode: 'tka',
    subject_id: subjectId,
    subject_name: subjectName,
    duration_minutes: input.duration_minutes || 60,
    passing_score: input.passing_score || 0,
    randomize_questions: input.randomize_questions ?? 1,
    randomize_options: input.randomize_options ?? 1,
    active_status: event.status === 'configuration' ? 'configuration' : 'draft',
  };

  const res = await createExam(db, examPayload, { sub: createdBy }, mansatasDb);
  if (!res.success) {
    return { success: false, error: res.error };
  }

  // 3. Immediately materialize roster rows for entitled participants
  await generateTkaExamRosters(db, eventId);

  return { success: true, id: res.data?.id };
}

/**
 * Batch-creates subject exams for all covered subjects that don't yet have exams.
 */
export async function batchCreateCoveredTkaExams(
  db: D1Database,
  mansatasDb: D1Database,
  eventId: string,
  createdBy: string
): Promise<{ created: number; skipped: number }> {
  const coverage = await getTkaSubjectCoverage(db, mansatasDb, eventId);

  let created = 0;
  let skipped = 0;

  for (const item of coverage) {
    if (item.has_exam) {
      skipped++;
      continue;
    }

    const res = await createTkaExam(
      db,
      mansatasDb,
      eventId,
      {
        subject_id: item.subject_id,
        title: `TKA ${item.subject_name}`,
        duration_minutes: 60,
      },
      createdBy
    );

    if (res.success) created++;
    else skipped++;
  }

  return { created, skipped };
}

/**
 * Deletes a subject exam from a TKA event.
 * Blocked if status >= ready or student sessions exist.
 */
export async function deleteTkaExam(
  db: D1Database,
  eventId: string,
  examId: string
): Promise<{ success: boolean; error?: string }> {
  const event = await assertTkaEvent(db, eventId);

  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    throw new EventFrozenError('Ujian tidak dapat dihapus setelah event mencapai status Ready');
  }

  const exam = await db
    .prepare("SELECT id FROM cbt_exams WHERE id = ? AND event_id = ? AND mode = 'tka'")
    .bind(examId, eventId)
    .first();

  if (!exam) return { success: false, error: 'Ujian tidak ditemukan dalam event TKA ini' };

  const res = await deleteExam(db, examId);
  if (!res.success) {
    return { success: false, error: res.error };
  }

  return { success: true };
}
