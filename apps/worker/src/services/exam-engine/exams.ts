import { newId, ok, err } from '../../utils/helpers.ts';
import { resolveExamEventAndMode } from '../platform/event-lifecycle.ts';
import { assertAllowedTkaSubjectId } from '../domains/tka/canonical-subjects.ts';

export const ALLOWED_EXAM_STATUSES = [
  'draft',
  'configuration',
  'ready',
  'active',
  'completed',
  'archived',
  'finished',
] as const;

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
  user: { sub: string; staff_id?: string | null },
  mansatasDb?: D1Database
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
  if (b.active_status && !ALLOWED_EXAM_STATUSES.includes(b.active_status)) {
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

  // Ulangan invariant: exactly 1 exam per event (1:1 event-exam rule)
  if (mode === 'ulangan') {
    const existingCount = await db
      .prepare('SELECT COUNT(*) as cnt FROM cbt_exams WHERE event_id = ?')
      .bind(eventId)
      .first<any>();
    if (Number(existingCount?.cnt || 0) >= 1) {
      return {
        success: false,
        error: 'Event Ulangan hanya boleh memiliki 1 ujian (aturan 1:1 event-exam)',
        status: 409,
      };
    }
  }

  let subjectId: string | null = b.subject_id !== undefined && b.subject_id !== null ? String(b.subject_id).trim() : null;
  let subjectName = b.subject_name == null ? null : String(b.subject_name).trim().slice(0, 120) || null;

  // TKA invariants:
  // 1. Parent event must not be frozen (status < ready)
  // 2. Non-null verified Mansatas subject_id
  // 3. Exactly 1 exam per subject per event
  if (mode === 'tka') {
    const parentEvent = await db.prepare('SELECT id, status FROM cbt_events WHERE id=?').bind(eventId).first<any>();
    if (parentEvent && ['ready', 'active', 'completed', 'archived'].includes(parentEvent.status)) {
      return {
        success: false,
        error: 'Tidak dapat menambahkan ujian ke event TKA yang sudah berstatus Ready atau lebih (subject set beku)',
        status: 409,
      };
    }

    if (!subjectId) {
      return {
        success: false,
        error: 'Ujian TKA wajib memiliki subject_id yang valid dan tidak boleh kosong',
        status: 400,
      };
    }

    if (mansatasDb) {
      const subjectCheck = await assertAllowedTkaSubjectId(mansatasDb, subjectId);
      if (!subjectCheck.success) {
        return {
          success: false,
          error: subjectCheck.error,
          status: 400,
        };
      }
      if (!subjectName) {
        subjectName = subjectCheck.subjectName || null;
      }
    } else {
      if (subjectId.toLowerCase().startsWith('tka-')) {
        return {
          success: false,
          error: 'Identifier subject_id sintetis dilarang untuk ujian TKA. Gunakan ID resmi mata pelajaran Mansatas.',
          status: 400,
        };
      }
    }

    const existingExamForSubject = await db
      .prepare("SELECT id FROM cbt_exams WHERE event_id = ? AND subject_id = ? AND mode = 'tka'")
      .bind(eventId, subjectId)
      .first<any>();
    if (existingExamForSubject) {
      return {
        success: false,
        error: 'Mata pelajaran ini sudah memiliki ujian pada event TKA ini (aturan 1 ujian per mapel per event)',
        status: 409,
      };
    }
  }

  const ownerStaffId = b.owner_staff_id || user.staff_id || null;
  const versionLabel = b.version_label ? String(b.version_label).trim().slice(0, 50) : 'v1.0';
  const isFrozen = b.is_frozen === 1 || b.is_frozen === true ? 1 : 0;

  const id = newId();
  try {
    await db.prepare(
      `INSERT INTO cbt_exams (id, title, description, duration_minutes, rules_text, completion_message,
       is_score_visible, randomize_questions, randomize_options, active_status, passing_score, created_by,
       target_jalur, event_id, subject_name, sequence_order, cheat_limit, cheat_action, enforce_fullscreen,
       mode, owner_staff_id, version_label, is_frozen, subject_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, b.title.trim(), b.description || null, duration,
      b.rules_text || null, b.completion_message || 'Ujian telah selesai. Terima kasih.',
      b.is_score_visible ? 1 : 0, b.randomize_questions ? 1 : 0,
      b.randomize_options ? 1 : 0, b.active_status || 'draft', b.passing_score || 0, user.sub,
      b.target_jalur || null, eventId, subjectName, sequenceOrder, cheatLimit, 'lock', b.enforce_fullscreen ? 1 : 0,
      mode, ownerStaffId, versionLabel, isFrozen, subjectId
    ).run();
  } catch (err: any) {
    if (String(err?.message || '').includes('UNIQUE constraint failed') && mode === 'ulangan') {
      return {
        success: false,
        error: 'Event Ulangan hanya boleh memiliki 1 ujian (aturan 1:1 event-exam)',
        status: 409,
      };
    }
    throw err;
  }

  return { success: true, data: { id }, message: 'Ujian dibuat' };
}

export async function updateExam(db: D1Database, id: string, b: any, mansatasDb?: D1Database) {
  const existingExam = await db.prepare(
    `SELECT event_id, mode, owner_staff_id, version_label, is_frozen,
            title, description, duration_minutes, rules_text, completion_message,
            is_score_visible, randomize_questions, randomize_options,
            active_status, passing_score, target_jalur, subject_name, subject_id,
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
  if (activeStatus && !ALLOWED_EXAM_STATUSES.includes(activeStatus)) {
    return { success: false, error: 'Status tidak valid', status: 400 };
  }

  // Canonical lifecycle authority guard: Ulangan status cannot be independently mutated via generic exam update
  if (existingExam.mode === 'ulangan') {
    if (b.active_status !== undefined && b.active_status !== existingExam.active_status) {
      return {
        success: false,
        error: 'Status ulangan harian dikelola secara kanonikal melalui lifecycle event (/api/ulangan/exams/:id/lifecycle) dan tidak dapat diubah secara langsung',
        status: 400,
      };
    }
  }

  // Canonical lifecycle authority & subject guards for TKA
  if (existingExam.mode === 'tka') {
    if (b.active_status !== undefined && b.active_status !== existingExam.active_status) {
      return {
        success: false,
        error: 'Status ujian TKA dikelola secara kanonikal melalui lifecycle event (/api/tka/events/:id/status) dan tidak dapat diubah secara langsung',
        status: 400,
      };
    }

    if (b.subject_id !== undefined && b.subject_id !== existingExam.subject_id) {
      const parentEvent = await db
        .prepare('SELECT id, status FROM cbt_events WHERE id = ?')
        .bind(existingExam.event_id)
        .first<any>();

      if (parentEvent && ['ready', 'active', 'completed', 'archived'].includes(parentEvent.status)) {
        return {
          success: false,
          error: 'Mata pelajaran ujian TKA tidak dapat diubah setelah event mencapai status Ready atau lebih (subject set beku)',
          status: 409,
        };
      }

      const sessionCount = await db
        .prepare('SELECT COUNT(*) as cnt FROM cbt_exam_sessions WHERE exam_id = ?')
        .bind(id)
        .first<any>();
      if (Number(sessionCount?.cnt || 0) > 0) {
        return {
          success: false,
          error: 'Mata pelajaran ujian TKA tidak dapat diubah karena sudah ada sesi ujian siswa',
          status: 409,
        };
      }

      const cleanSubjectId = typeof b.subject_id === 'string' ? b.subject_id.trim() : '';
      if (!cleanSubjectId) {
        return {
          success: false,
          error: 'Ujian TKA wajib memiliki subject_id yang valid',
          status: 400,
        };
      }

      if (mansatasDb) {
        const subjectCheck = await assertAllowedTkaSubjectId(mansatasDb, cleanSubjectId);
        if (!subjectCheck.success) {
          return {
            success: false,
            error: subjectCheck.error,
            status: 400,
          };
        }
      } else {
        if (cleanSubjectId.toLowerCase().startsWith('tka-')) {
          return {
            success: false,
            error: 'Identifier subject_id sintetis dilarang untuk ujian TKA. Gunakan ID resmi mata pelajaran Mansatas.',
            status: 400,
          };
        }
      }

      const duplicateExam = await db
        .prepare("SELECT id FROM cbt_exams WHERE event_id = ? AND subject_id = ? AND id != ? AND mode = 'tka'")
        .bind(existingExam.event_id, cleanSubjectId, id)
        .first<any>();
      if (duplicateExam) {
        return {
          success: false,
          error: 'Mata pelajaran ini sudah memiliki ujian lain pada event TKA ini',
          status: 409,
        };
      }
    }
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
  const subjectId = b.subject_id !== undefined
    ? (b.subject_id ? String(b.subject_id).trim() : null)
    : (existingExam.subject_id || null);

  await db.prepare(
    `UPDATE cbt_exams SET title=?, description=?, duration_minutes=?, rules_text=?,
     completion_message=?, is_score_visible=?, randomize_questions=?, randomize_options=?,
     active_status=?, passing_score=?, target_jalur=?, event_id=?, subject_name=?, sequence_order=?,
     cheat_limit=?, cheat_action=?, enforce_fullscreen=?, mode=?, owner_staff_id=?, version_label=?, is_frozen=?,
     subject_id=?, updated_at=datetime('now') WHERE id=?`
  ).bind(
    title, description, duration, rulesText, completionMessage,
    isScoreVisible, randomizeQuestions, randomizeOptions,
    activeStatus, passingScore, targetJalur, targetEventId, subjectName, sequenceOrder,
    cheatLimit, 'lock', enforceFullscreen,
    mode, ownerStaffId, versionLabel, isFrozen,
    subjectId, id
  ).run();

  return { success: true, data: null, message: 'Ujian diperbarui' };
}

export async function deleteExam(db: D1Database, id: string) {
  const exam = await db.prepare('SELECT id, mode, event_id FROM cbt_exams WHERE id=?').bind(id).first<any>();
  if (exam?.mode === 'tka' && exam.event_id) {
    const event = await db.prepare('SELECT status FROM cbt_events WHERE id=?').bind(exam.event_id).first<any>();
    if (event && ['ready', 'active', 'completed', 'archived'].includes(event.status)) {
      return { success: false, error: 'Ujian TKA tidak dapat dihapus setelah event mencapai status Ready atau lebih (subject set beku)', status: 409 };
    }
    const sessionCount = await db.prepare('SELECT COUNT(*) as cnt FROM cbt_exam_sessions WHERE exam_id=?').bind(id).first<any>();
    if (Number(sessionCount?.cnt || 0) > 0) {
      return { success: false, error: 'Ujian TKA tidak dapat dihapus karena sudah ada sesi ujian siswa', status: 409 };
    }
  }

  await db.batch([
    db.prepare('DELETE FROM cbt_exam_roster WHERE exam_id = ?').bind(id),
    db.prepare('DELETE FROM cbt_exam_tokens WHERE exam_id = ?').bind(id),
    db.prepare('DELETE FROM cbt_questions WHERE exam_id = ?').bind(id),
    db.prepare('DELETE FROM cbt_exams WHERE id = ?').bind(id),
  ]);
  return { success: true, data: null, message: 'Ujian dihapus' };
}
