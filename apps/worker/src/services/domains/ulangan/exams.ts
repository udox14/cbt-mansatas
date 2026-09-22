// ============================================================
// Ulangan Exam Management Service
//
// Manages Ulangan Harian assessments with:
// 1. Server-authoritative teaching assignment validation
// 2. 1:1 lightweight canonical event pairing & compensation
// 3. Strict owner authorization & IDOR protection
// 4. Safe deletion policy preserving historical student attempts
// 5. Progressive lifecycle mapping onto canonical 6-stage lifecycle
// ============================================================

import { newId, now } from '../../../utils/helpers.ts';
import { validateEventTransition } from '../../platform/event-lifecycle.ts';
import { getTeachingAssignmentById } from '../../sources/teaching-assignments.ts';
import { createExam, updateExam } from '../../exam-engine/exams.ts';
import { generateExamTokens } from '../../exam-engine/tokens.ts';
import { checkUlanganReadiness } from './readiness.ts';

export class DomainMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainMismatchError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Checks whether the authenticated caller owns the Ulangan exam or has administrative override.
 * Centralized IDOR guard for all Ulangan routes.
 */
export async function assertUlanganOwnership(
  db: D1Database,
  examId: string,
  user: any
): Promise<{ exam: any; event: any }> {
  const exam = await db
    .prepare(
      `SELECT e.*, ev.status AS event_status, ev.code AS event_code, ev.name AS event_name,
              ev.academic_year_id AS event_academic_year_id, ev.academic_year_name AS event_academic_year_name,
              ev.term AS event_term
       FROM cbt_exams e
       JOIN cbt_events ev ON ev.id = e.event_id
       WHERE e.id = ?`
    )
    .bind(examId)
    .first<any>();

  if (!exam) {
    throw new NotFoundError('Ulangan tidak ditemukan');
  }

  if (exam.mode !== 'ulangan') {
    throw new DomainMismatchError(`Ujian '${examId}' bertipe '${exam.mode}', bukan 'ulangan'`);
  }

  const isGlobalAdmin =
    user?.role === 'admin' ||
    user?.roles?.includes('admin') ||
    user?.permissions?.includes('platform.manage') ||
    user?.permissions?.includes('ulangan.manage_all') ||
    user?.permissions?.includes('*');

  if (isGlobalAdmin) {
    return {
      exam,
      event: {
        id: exam.event_id,
        status: exam.event_status,
        code: exam.event_code,
        name: exam.event_name,
        academic_year_id: exam.event_academic_year_id,
        academic_year_name: exam.event_academic_year_name,
        term: exam.event_term,
      },
    };
  }

  // Sole persisted ownership authority: cbt_exams.owner_staff_id
  const staffId = user?.staff_id || user?.sub;
  if (!exam.owner_staff_id || exam.owner_staff_id !== staffId) {
    throw new ForbiddenError('Akses ditolak: Anda bukan pemilik ulangan ini');
  }

  return {
    exam,
    event: {
      id: exam.event_id,
      status: exam.event_status,
      code: exam.event_code,
      name: exam.event_name,
      academic_year_id: exam.event_academic_year_id,
      academic_year_name: exam.event_academic_year_name,
      term: exam.event_term,
    },
  };
}

/**
 * Creates a new Ulangan assessment paired 1:1 with an automatically provisioned
 * lightweight canonical cbt_events record.
 */
export async function createUlanganExam(
  db: D1Database,
  mansatasDb: D1Database | undefined,
  body: any,
  user: any
): Promise<{ success: boolean; data?: { id: string; event_id: string }; error?: string; status?: number }> {
  const assignmentId = String(body.teaching_assignment_id || '').trim();
  if (!assignmentId) {
    return { success: false, error: 'Penugasan mengajar (teaching_assignment_id) wajib dipilih', status: 400 };
  }

  if (!mansatasDb) {
    return { success: false, error: 'Koneksi database MANSATAS_DB belum tersedia', status: 500 };
  }

  // 1. Resolve Mansatas guru_id from CBT staff profile
  let guruId = user.mansatas_user_id;
  if (!guruId) {
    const staffProfile = await db
      .prepare('SELECT mansatas_user_id FROM cbt_staff_profiles WHERE id = ?')
      .bind(user.staff_id || user.sub)
      .first<any>();
    guruId = staffProfile?.mansatas_user_id;
  }

  const isGlobalAdmin =
    user?.role === 'admin' ||
    user?.roles?.includes('admin') ||
    user?.permissions?.includes('platform.manage') ||
    user?.permissions?.includes('*');

  // Verify teaching assignment ownership unless caller is an admin
  const assignment = await getTeachingAssignmentById(
    mansatasDb,
    assignmentId,
    isGlobalAdmin ? undefined : guruId
  );

  if (!assignment) {
    return {
      success: false,
      error: 'Penugasan mengajar tidak valid atau bukan penugasan mengajar Anda di Mansatas',
      status: 400,
    };
  }

  const title = String(body.title || '').trim();
  if (!title) {
    return { success: false, error: 'Judul ulangan wajib diisi', status: 400 };
  }

  // 2. Provision lightweight canonical cbt_events record
  const eventId = 'event-uh-' + newId();
  const eventCode = `UH-${(assignment.kode_mapel || 'MAPEL').toUpperCase()}-${assignment.tingkat}${(assignment.nomor_kelas || '').replace(/\s+/g, '')}-${Date.now().toString(36).toUpperCase()}-${newId().slice(0, 6).toUpperCase()}`;
  const eventName = `[UH] ${assignment.nama_mapel} — ${assignment.class_name}`;

  try {
    await db
      .prepare(
        `INSERT INTO cbt_events (
           id, code, name, mode, activity_type, participant_source, status,
           academic_year_id, academic_year_name, term,
           proctor_access_before_minutes, proctor_access_after_minutes,
           created_by, created_at, updated_at
         ) VALUES (?, ?, ?, 'ulangan', 'ulangan', 'mansatas', 'draft', ?, ?, ?, 30, 45, ?, ?, ?)`
      )
      .bind(
        eventId,
        eventCode,
        eventName,
        assignment.tahun_ajaran_id,
        assignment.tahun_ajaran_nama,
        assignment.tahun_ajaran_semester || null,
        user.sub,
        now(),
        now()
      )
      .run();
  } catch (err: any) {
    return { success: false, error: `Gagal membuat event kanonikal: ${err.message}`, status: 500 };
  }

  // 3. Delegate exam creation to shared engine (cbt_exams)
  const ownerStaffId = user.staff_id || user.sub;
  const duration = Number(body.duration_minutes || 60);
  const examPayload = {
    passing_score: 0,
    ...body,
    duration_minutes: duration,
    title,
    event_id: eventId,
    mode: 'ulangan',
    subject_name: assignment.nama_mapel,
    owner_staff_id: ownerStaffId,
  };

  const examResult = await createExam(db, examPayload, user);

  // Failure compensation: clean up orphan event if exam creation failed
  if (!examResult.success || !examResult.data?.id) {
    await db.prepare('DELETE FROM cbt_events WHERE id = ?').bind(eventId).run();
    return {
      success: false,
      error: examResult.error || 'Gagal membuat data ujian di shared engine',
      status: (examResult.status as number) || 400,
    };
  }

  const examId = examResult.data.id;

  // 4. Persist Ulangan domain context fields on cbt_exams
  await db
    .prepare(
      `UPDATE cbt_exams
       SET teaching_assignment_id = ?,
           subject_id = ?,
           class_id = ?,
           class_name = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .bind(
      assignment.id,
      assignment.mapel_id,
      assignment.kelas_id,
      assignment.class_name,
      now(),
      examId
    )
    .run();

  return {
    success: true,
    data: { id: examId, event_id: eventId },
  };
}

/**
 * Lists Ulangan assessments.
 * Scoped to the authenticated teacher's owned exams unless caller is global admin.
 */
export async function listUlanganExams(
  db: D1Database,
  user: any,
  filters: { active_status?: string; q?: string } = {}
): Promise<any[]> {
  const isGlobalAdmin =
    user?.role === 'admin' ||
    user?.roles?.includes('admin') ||
    user?.permissions?.includes('platform.manage') ||
    user?.permissions?.includes('ulangan.manage_all') ||
    user?.permissions?.includes('*');

  let sql = `
    SELECT e.id, e.title, e.description, e.duration_minutes, e.passing_score,
           e.randomize_questions, e.randomize_options, e.active_status,
           e.mode, e.owner_staff_id, e.subject_name, e.subject_id,
           e.teaching_assignment_id, e.class_id, e.class_name,
           e.event_id, ev.code AS event_code, ev.status AS event_status,
           ev.academic_year_id, ev.academic_year_name, ev.term,
           e.created_at, e.updated_at,
           COUNT(DISTINCT q.id) AS question_count,
           COUNT(DISTINCT r.id) AS roster_count
    FROM cbt_exams e
    JOIN cbt_events ev ON ev.id = e.event_id
    LEFT JOIN cbt_questions q ON q.exam_id = e.id
    LEFT JOIN cbt_exam_roster r ON r.exam_id = e.id
    WHERE e.mode = 'ulangan'
  `;

  const params: any[] = [];

  if (!isGlobalAdmin) {
    const staffId = user.staff_id || user.sub;
    sql += ' AND e.owner_staff_id = ?';
    params.push(staffId);
  }

  if (filters.active_status) {
    sql += ' AND e.active_status = ?';
    params.push(filters.active_status);
  }

  if (filters.q?.trim()) {
    const q = `%${filters.q.trim().toLowerCase()}%`;
    sql += ' AND (LOWER(e.title) LIKE ? OR LOWER(e.subject_name) LIKE ? OR LOWER(e.class_name) LIKE ?)';
    params.push(q, q, q);
  }

  sql += ' GROUP BY e.id ORDER BY e.created_at DESC';

  const { results } = await db.prepare(sql).bind(...params).all<any>();
  return results || [];
}

/**
 * Retrieves full Ulangan details with stored context.
 */
export async function getUlanganExamDetail(
  db: D1Database,
  examId: string,
  user: any
): Promise<any> {
  const { exam, event } = await assertUlanganOwnership(db, examId, user);

  const [qCount, rCount, tCount] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS total FROM cbt_questions WHERE exam_id = ?').bind(examId).first<any>(),
    db.prepare('SELECT COUNT(*) AS total FROM cbt_exam_roster WHERE exam_id = ?').bind(examId).first<any>(),
    db.prepare('SELECT COUNT(*) AS total FROM cbt_exam_tokens WHERE exam_id = ? AND is_active = 1').bind(examId).first<any>(),
  ]);

  return {
    ...exam,
    event,
    academic_year_id: exam.event_academic_year_id,
    academic_year_name: exam.event_academic_year_name,
    term: exam.event_term,
    question_count: Number(qCount?.total || 0),
    roster_count: Number(rCount?.total || 0),
    has_active_token: Number(tCount?.total || 0) > 0,
  };
}

/**
 * Updates Ulangan settings (ownership-checked).
 */
export async function updateUlanganExam(
  db: D1Database,
  examId: string,
  body: any,
  user: any
): Promise<{ success: boolean; error?: string; status?: number }> {
  await assertUlanganOwnership(db, examId, user);
  const result = await updateExam(db, examId, body);
  return {
    success: result.success,
    error: result.error,
    status: (result.status as number) || 400,
  };
}

/**
 * Deletes a draft Ulangan assessment safely.
 * Destructive deletion is strictly rejected if student attempts exist or status >= ready.
 */
export async function deleteUlanganExam(
  db: D1Database,
  examId: string,
  user: any
): Promise<{ success: boolean; error?: string; status?: number }> {
  const { exam, event } = await assertUlanganOwnership(db, examId, user);

  // 1. Check if any student attempts / sessions exist
  const sessionCheck = await db
    .prepare('SELECT COUNT(*) AS total FROM cbt_exam_sessions WHERE exam_id = ?')
    .bind(examId)
    .first<any>();

  if (Number(sessionCheck?.total || 0) > 0) {
    return {
      success: false,
      error: 'Ulangan ini sudah memiliki riwayat pengerjaan siswa dan tidak dapat dihapus',
      status: 409,
    };
  }

  // 2. Reject deletion if event status is ready, active, completed, or archived
  if (['ready', 'active', 'completed', 'archived'].includes(event.status)) {
    return {
      success: false,
      error: `Ulangan dengan status '${event.status}' tidak dapat dihapus. Hanya ulangan berstatus Draft yang dapat dihapus.`,
      status: 409,
    };
  }

  // 3. Clean up all child entities safely
  await db.batch([
    db.prepare('DELETE FROM cbt_exam_roster WHERE exam_id = ?').bind(examId),
    db.prepare('DELETE FROM cbt_question_options WHERE question_id IN (SELECT id FROM cbt_questions WHERE exam_id = ?)').bind(examId),
    db.prepare('DELETE FROM cbt_questions WHERE exam_id = ?').bind(examId),
    db.prepare('DELETE FROM cbt_exam_tokens WHERE exam_id = ?').bind(examId),
    db.prepare('DELETE FROM cbt_exams WHERE id = ?').bind(examId),
    db.prepare('DELETE FROM cbt_events WHERE id = ?').bind(exam.event_id),
  ]);

  return { success: true };
}

/**
 * Executes a simplified lifecycle action mapped onto canonical 6-stage lifecycle transitions.
 */
export async function transitionUlanganStatus(
  db: D1Database,
  examId: string,
  rawAction: string,
  user: any
): Promise<{ success: boolean; error?: string; status?: string; readiness?: any }> {
  const { exam, event } = await assertUlanganOwnership(db, examId, user);
  const currentEventStatus = event.status;

  const actionMap: Record<string, 'configuration' | 'ready' | 'active' | 'completed' | 'archived' | 'draft'> = {
    configuration: 'configuration',
    config: 'configuration',
    siap: 'ready',
    ready: 'ready',
    buka: 'active',
    active: 'active',
    selesai: 'completed',
    completed: 'completed',
    archived: 'archived',
    archive: 'archived',
    draft: 'draft',
  };

  const action = actionMap[String(rawAction).toLowerCase()];
  if (!action) {
    return { success: false, error: `Aksi status '${rawAction}' tidak dikenali` };
  }

  if (action === 'configuration') {
    if (currentEventStatus === 'draft') {
      const trans = validateEventTransition('draft', 'configuration');
      if (!trans.valid) return { success: false, error: trans.error };
      await db.batch([
        db.prepare("UPDATE cbt_events SET status = 'configuration', updated_at = datetime('now') WHERE id = ?").bind(exam.event_id),
        db.prepare("UPDATE cbt_exams SET active_status = 'configuration', updated_at = datetime('now') WHERE id = ?").bind(examId),
      ]);
      return { success: true, status: 'configuration' };
    } else if (currentEventStatus === 'ready') {
      const trans = validateEventTransition('ready', 'configuration');
      if (!trans.valid) return { success: false, error: trans.error };
      await db.batch([
        db.prepare("UPDATE cbt_events SET status = 'configuration', updated_at = datetime('now') WHERE id = ?").bind(exam.event_id),
        db.prepare("UPDATE cbt_exams SET active_status = 'configuration', updated_at = datetime('now') WHERE id = ?").bind(examId),
      ]);
      return { success: true, status: 'configuration' };
    } else if (currentEventStatus === 'configuration') {
      return { success: true, status: 'configuration' };
    }
    return { success: false, error: `Transisi ke 'configuration' tidak valid dari status '${currentEventStatus}'` };
  }

  if (action === 'ready') {
    // Canonical flow: draft -> configuration -> ready, or configuration -> ready
    if (currentEventStatus === 'draft') {
      const trans1 = validateEventTransition('draft', 'configuration');
      if (!trans1.valid) return { success: false, error: trans1.error };
    } else if (currentEventStatus !== 'configuration') {
      return { success: false, error: `Transisi ke 'ready' tidak valid dari status '${currentEventStatus}'` };
    }

    // Deterministic readiness check before locking into ready
    const readiness = await checkUlanganReadiness(db, examId);
    if (!readiness.ready) {
      return {
        success: false,
        error: 'Ulangan belum memenuhi syarat untuk ditandai Siap',
        readiness,
      };
    }

    const trans2 = validateEventTransition('configuration', 'ready');
    if (!trans2.valid) return { success: false, error: trans2.error };

    await db.batch([
      db.prepare("UPDATE cbt_events SET status = 'ready', updated_at = datetime('now') WHERE id = ?").bind(exam.event_id),
      db.prepare("UPDATE cbt_exams SET active_status = 'ready', updated_at = datetime('now') WHERE id = ?").bind(examId),
    ]);
    return { success: true, status: 'ready', readiness };
  }

  if (action === 'active') {
    // Canonical transition: ready -> active
    const trans = validateEventTransition(currentEventStatus, 'active');
    if (!trans.valid) return { success: false, error: trans.error };

    await db.batch([
      db.prepare("UPDATE cbt_events SET status = 'active', updated_at = datetime('now') WHERE id = ?").bind(exam.event_id),
      db.prepare("UPDATE cbt_exams SET active_status = 'active', updated_at = datetime('now') WHERE id = ?").bind(examId),
    ]);

    // Auto-generate a classroom token if none exists yet
    const tokenRow = await db.prepare('SELECT id FROM cbt_exam_tokens WHERE exam_id = ?').bind(examId).first();
    if (!tokenRow) {
      await generateExamTokens(db, examId, {});
    }

    return { success: true, status: 'active' };
  }

  if (action === 'completed') {
    // Canonical transition: active -> completed
    const trans = validateEventTransition(currentEventStatus, 'completed');
    if (!trans.valid) return { success: false, error: trans.error };

    await db.batch([
      db.prepare("UPDATE cbt_events SET status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(exam.event_id),
      db.prepare("UPDATE cbt_exams SET active_status = 'completed', updated_at = datetime('now') WHERE id = ?").bind(examId),
    ]);

    return { success: true, status: 'completed' };
  }

  if (action === 'archived') {
    // Canonical transition: completed -> archived
    const trans = validateEventTransition(currentEventStatus, 'archived');
    if (!trans.valid) return { success: false, error: trans.error };

    await db.batch([
      db.prepare("UPDATE cbt_events SET status = 'archived', updated_at = datetime('now') WHERE id = ?").bind(exam.event_id),
      db.prepare("UPDATE cbt_exams SET active_status = 'archived', updated_at = datetime('now') WHERE id = ?").bind(examId),
    ]);

    return { success: true, status: 'archived' };
  }

  if (action === 'draft') {
    // Canonical Rollback: ready -> configuration -> draft
    if (currentEventStatus === 'ready') {
      const rollback1 = validateEventTransition('ready', 'configuration');
      if (!rollback1.valid) return { success: false, error: rollback1.error };
      const rollback2 = validateEventTransition('configuration', 'draft');
      if (!rollback2.valid) return { success: false, error: rollback2.error };
      await db.batch([
        db.prepare("UPDATE cbt_events SET status = 'draft', updated_at = datetime('now') WHERE id = ?").bind(exam.event_id),
        db.prepare("UPDATE cbt_exams SET active_status = 'draft', updated_at = datetime('now') WHERE id = ?").bind(examId),
      ]);
      return { success: true, status: 'draft' };
    } else if (currentEventStatus === 'configuration') {
      const rollback = validateEventTransition('configuration', 'draft');
      if (!rollback.valid) return { success: false, error: rollback.error };
      await db.batch([
        db.prepare("UPDATE cbt_events SET status = 'draft', updated_at = datetime('now') WHERE id = ?").bind(exam.event_id),
        db.prepare("UPDATE cbt_exams SET active_status = 'draft', updated_at = datetime('now') WHERE id = ?").bind(examId),
      ]);
      return { success: true, status: 'draft' };
    } else if (currentEventStatus === 'draft') {
      return { success: true, status: 'draft' };
    }

    // Attempting to jump directly from active/completed/archived to draft is canonically illegal
    return {
      success: false,
      error: `Transisi rollback ke 'draft' tidak diizinkan dari status '${currentEventStatus}'`,
    };
  }

  return { success: false, error: `Aksi status '${rawAction}' tidak dikenali` };
}
