import { newId, ok, err } from '../../utils/helpers.ts';
import { resolveExamEventAndMode } from '../platform/event-lifecycle.ts';


export async function listExams(
  db: D1Database,
  query: { event_id?: string; active_status?: string; mode?: string }
) {
  let sql = `
    SELECT e.*,
           ev.name AS event_name, ev.code AS event_code, ev.mode AS event_mode,
           COUNT(DISTINCT q.id) AS question_count
    FROM cbt_exams e
    LEFT JOIN cbt_events ev ON ev.id = e.event_id
    LEFT JOIN cbt_questions q ON q.exam_id = e.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (query.event_id) {
    sql += ' AND e.event_id = ?';
    params.push(query.event_id);
  }
  if (query.active_status) {
    sql += ' AND e.active_status = ?';
    params.push(query.active_status);
  }
  if (query.mode) {
    sql += ' AND e.mode = ?';
    params.push(query.mode);
  }

  sql += ' GROUP BY e.id ORDER BY e.created_at DESC';
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

export async function getExamById(db: D1Database, id: string) {
  const exam = await db.prepare(
    `SELECT e.*, ev.name AS event_name, ev.code AS event_code, ev.mode AS event_mode
     FROM cbt_exams e
     LEFT JOIN cbt_events ev ON ev.id = e.event_id
     WHERE e.id=?`
  ).bind(id).first<any>();
  return exam || null;
}

export async function createExam(
  db: D1Database,
  b: any,
  user: { sub: string; staff_id?: string | null }
) {
  if (!b.title || typeof b.title !== 'string' || b.title.trim().length === 0) {
    return { success: false, error: 'Judul ujian wajib diisi', status: 400 };
  }
  const duration = Number(b.duration_minutes);
  if (!Number.isInteger(duration) || duration < 1 || duration > 600) {
    return { success: false, error: 'Durasi ujian harus antara 1–600 menit', status: 400 };
  }
  const cheatLimit = Number(b.cheat_limit ?? 3);
  if (!Number.isInteger(cheatLimit) || cheatLimit < 1 || cheatLimit > 50) {
    return { success: false, error: 'Cheat limit harus antara 1–50', status: 400 };
  }
  const sequenceOrder = Number(b.sequence_order ?? 0);
  if (!Number.isInteger(sequenceOrder) || sequenceOrder < 0 || sequenceOrder > 999) {
    return { success: false, error: 'Urutan mapel harus antara 0–999', status: 400 };
  }
  if (b.cheat_action && b.cheat_action !== 'lock') {
    return { success: false, error: 'Cheat action tidak valid', status: 400 };
  }
  if (b.active_status && !['draft', 'active', 'finished'].includes(b.active_status)) {
    return { success: false, error: 'Status tidak valid', status: 400 };
  }

  const resolution = await resolveExamEventAndMode(
    {
      event_id: b.event_id,
      mode: b.mode,
    },
    async (id) => {
      return db.prepare('SELECT id, mode FROM cbt_events WHERE id=?').bind(id).first<{ id: string; mode: any }>();
    }
  );
  if (!resolution.success) {
    return { success: false, error: resolution.error || 'Validasi kegiatan ujian gagal', status: 400 };
  }

  const eventId = resolution.eventId!;
  const mode = resolution.mode!;
  const ownerStaffId = b.owner_staff_id || user.staff_id || null;
  const versionLabel = b.version_label ? String(b.version_label).trim().slice(0, 50) : 'v1.0';
  const isFrozen = b.is_frozen === 1 || b.is_frozen === true ? 1 : 0;
  const subjectName = b.subject_name == null ? null : String(b.subject_name).trim().slice(0, 120) || null;

  const id = newId();
  await db.prepare(
    `INSERT INTO cbt_exams (id, title, description, duration_minutes, rules_text, completion_message,
     is_score_visible, randomize_questions, randomize_options, active_status, passing_score, created_by,
     target_jalur, event_id, subject_name, sequence_order, cheat_limit, cheat_action, enforce_fullscreen,
     mode, owner_staff_id, version_label, is_frozen)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, b.title.trim(), b.description || null, duration,
    b.rules_text || null, b.completion_message || 'Ujian telah selesai. Terima kasih.',
    b.is_score_visible ? 1 : 0, b.randomize_questions ? 1 : 0,
    b.randomize_options ? 1 : 0, b.active_status || 'draft', b.passing_score || 0, user.sub,
    b.target_jalur || null, eventId, subjectName, sequenceOrder, cheatLimit, 'lock', b.enforce_fullscreen ? 1 : 0,
    mode, ownerStaffId, versionLabel, isFrozen
  ).run();

  return { success: true, data: { id }, message: 'Ujian dibuat' };
}

export async function updateExam(db: D1Database, id: string, b: any) {
  const existingExam = await db.prepare(
    `SELECT event_id, mode, owner_staff_id, version_label, is_frozen,
            title, description, duration_minutes, rules_text, completion_message,
            is_score_visible, randomize_questions, randomize_options,
            active_status, passing_score, target_jalur, subject_name,
            sequence_order, cheat_limit, enforce_fullscreen
     FROM cbt_exams WHERE id=?`
  ).bind(id).first<any>();
  if (!existingExam) {
    return { success: false, error: 'Ujian tidak ditemukan', status: 404 };
  }

  const title = b.title !== undefined ? String(b.title).trim() : existingExam.title;
  if (!title) {
    return { success: false, error: 'Judul ujian wajib diisi', status: 400 };
  }
  const duration = b.duration_minutes !== undefined ? Number(b.duration_minutes) : Number(existingExam.duration_minutes);
  if (!Number.isInteger(duration) || duration < 1 || duration > 600) {
    return { success: false, error: 'Durasi ujian harus antara 1–600 menit', status: 400 };
  }
  const cheatLimit = Number(b.cheat_limit !== undefined ? b.cheat_limit : (existingExam.cheat_limit ?? 3));
  if (!Number.isInteger(cheatLimit) || cheatLimit < 1 || cheatLimit > 50) {
    return { success: false, error: 'Cheat limit harus antara 1–50', status: 400 };
  }
  const sequenceOrder = Number(b.sequence_order !== undefined ? b.sequence_order : (existingExam.sequence_order ?? 0));
  if (!Number.isInteger(sequenceOrder) || sequenceOrder < 0 || sequenceOrder > 999) {
    return { success: false, error: 'Urutan mapel harus antara 0–999', status: 400 };
  }
  if (b.cheat_action && b.cheat_action !== 'lock') {
    return { success: false, error: 'Cheat action tidak valid', status: 400 };
  }
  const activeStatus = b.active_status !== undefined ? b.active_status : (existingExam.active_status ?? 'draft');
  if (activeStatus && !['draft', 'active', 'finished'].includes(activeStatus)) {
    return { success: false, error: 'Status tidak valid', status: 400 };
  }

  let targetEventId = existingExam.event_id;
  if (b.event_id !== undefined) {
    const trimmed = String(b.event_id).trim();
    if (!trimmed) {
      return { success: false, error: 'Kegiatan (event_id) tidak boleh kosong', status: 400 };
    }
    targetEventId = trimmed;
  }

  if (!targetEventId) {
    return { success: false, error: 'Kegiatan (event_id) tidak ditemukan pada ujian ini', status: 400 };
  }

  const event = await db.prepare('SELECT id, mode FROM cbt_events WHERE id=?').bind(targetEventId).first<any>();
  if (!event) {
    return { success: false, error: 'Kegiatan tidak ditemukan', status: 400 };
  }

  if (b.mode && b.mode !== event.mode) {
    return {
      success: false,
      error: `Mode ujian '${b.mode}' tidak sesuai dengan mode kegiatan '${event.mode}'. Mode ujian harus mengikuti kegiatan.`,
      status: 400,
    };
  }

  if (existingExam.event_id && existingExam.event_id !== targetEventId) {
    const rosterCount = await db.prepare('SELECT COUNT(*) AS total FROM cbt_exam_roster WHERE exam_id=?').bind(id).first<any>();
    const assignmentCount = await db.prepare('SELECT COUNT(*) AS total FROM cbt_exam_assignments WHERE exam_id=?').bind(id).first<any>();
    if (Number(rosterCount?.total || 0) > 0 || Number(assignmentCount?.total || 0)) {
      return { success: false, error: 'Kegiatan tidak dapat diubah setelah peserta ditugaskan', status: 409 };
    }
  }

  const mode = event.mode;
  const ownerStaffId = b.owner_staff_id !== undefined ? (b.owner_staff_id || null) : (existingExam.owner_staff_id || null);
  const versionLabel = b.version_label !== undefined ? String(b.version_label).trim().slice(0, 50) : (existingExam.version_label || 'v1.0');
  const isFrozen = b.is_frozen === 1 || b.is_frozen === true ? 1 : (existingExam.is_frozen ? 1 : 0);
  const subjectName = b.subject_name == null ? null : String(b.subject_name).trim().slice(0, 120) || null;
  const description = b.description ?? null;
  const rulesText = b.rules_text ?? null;
  const completionMessage = b.completion_message ?? null;
  const isScoreVisible = b.is_score_visible ? 1 : 0;
  const randomizeQuestions = b.randomize_questions ? 1 : 0;
  const randomizeOptions = b.randomize_options ? 1 : 0;
  const passingScore = Number(b.passing_score) || 0;
  const targetJalur = b.target_jalur || null;
  const enforceFullscreen = b.enforce_fullscreen ? 1 : 0;

  await db.prepare(
    `UPDATE cbt_exams SET title=?, description=?, duration_minutes=?, rules_text=?,
     completion_message=?, is_score_visible=?, randomize_questions=?, randomize_options=?,
     active_status=?, passing_score=?, target_jalur=?, event_id=?, subject_name=?, sequence_order=?,
     cheat_limit=?, cheat_action=?, enforce_fullscreen=?, mode=?, owner_staff_id=?, version_label=?, is_frozen=?, updated_at=datetime('now') WHERE id=?`
  ).bind(
    title, description, duration, rulesText, completionMessage,
    isScoreVisible, randomizeQuestions, randomizeOptions,
    activeStatus, passingScore, targetJalur, targetEventId, subjectName, sequenceOrder,
    cheatLimit, 'lock', enforceFullscreen,
    mode, ownerStaffId, versionLabel, isFrozen, id
  ).run();

  return { success: true, data: null, message: 'Ujian diperbarui' };
}

export async function deleteExam(db: D1Database, id: string) {
  await db.prepare('DELETE FROM cbt_exams WHERE id=?').bind(id).run();
  return { success: true, data: null, message: 'Ujian dihapus' };
}
