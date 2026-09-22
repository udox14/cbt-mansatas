// ============================================================
// Reporting Service — Consolidated Results with Bounded Pagination
// ============================================================

import type {
  ReportFilter,
  PaginationOptions,
  PaginatedResult,
  ParticipantReportRow,
} from './types.ts';

export async function getConsolidatedResults(
  db: D1Database,
  examId: string,
  filters: ReportFilter = {},
  pagination: PaginationOptions = {}
): Promise<PaginatedResult<ParticipantReportRow>> {
  const page = Math.max(1, Number(pagination.page || 1));
  const limit = Math.max(1, Math.min(10000, Number(pagination.limit || 50)));
  const offset = (page - 1) * limit;

  // Base query fetching from canonical CBT roster and session/results
  let baseQuery = `
    FROM cbt_exam_roster rr
    LEFT JOIN cbt_rooms r ON r.id = rr.room_id
    LEFT JOIN cbt_exam_sessions es ON es.exam_id = rr.exam_id AND es.user_id = rr.source_id
      AND es.user_type = CASE WHEN rr.source_key = 'pmb' THEN 'pendaftar' ELSE rr.source_key END
    LEFT JOIN cbt_exam_results er ON er.session_id = es.id
    WHERE rr.exam_id = ?
  `;

  const params: any[] = [examId];

  // Filtering predicates
  if (filters.roomId) {
    baseQuery += ' AND rr.room_id = ?';
    params.push(filters.roomId);
  } else if (filters.roomName) {
    baseQuery += ' AND r.room_name = ?';
    params.push(filters.roomName);
  }

  if (filters.className) {
    baseQuery += ' AND rr.class_name = ?';
    params.push(filters.className);
  }

  if (filters.grade) {
    baseQuery += ' AND rr.grade = ?';
    params.push(filters.grade);
  }

  if (filters.tanggalTes) {
    baseQuery += ' AND rr.tanggal_tes = ?';
    params.push(filters.tanggalTes);
  }

  if (filters.sesiTes) {
    baseQuery += ' AND rr.sesi_tes = ?';
    params.push(filters.sesiTes);
  }

  if (filters.status && filters.status !== 'all') {
    switch (filters.status) {
      case 'not_started':
        baseQuery += ' AND es.id IS NULL';
        break;
      case 'in_progress':
        baseQuery += " AND es.status = 'active' AND (es.is_time_locked = 0 OR es.is_time_locked IS NULL)";
        break;
      case 'submitted':
        baseQuery += " AND (es.status = 'submitted' OR er.id IS NOT NULL)";
        break;
      case 'locked':
        baseQuery += " AND es.is_time_locked = 1 AND es.status != 'submitted'";
        break;
    }
  }

  if (filters.search) {
    const term = `%${filters.search.trim().toLowerCase()}%`;
    baseQuery += ' AND (LOWER(rr.full_name) LIKE ? OR LOWER(COALESCE(rr.nisn, \'\')) LIKE ? OR LOWER(rr.username) LIKE ?)';
    params.push(term, term, term);
  }

  // Count total matching items
  const countRow = await db.prepare(`SELECT COUNT(*) as total ${baseQuery}`).bind(...params).first<any>();
  const total = Number(countRow?.total || 0);
  const totalPages = Math.ceil(total / limit) || 1;

  // Query bounded page
  const selectQuery = `
    SELECT
      rr.source_id as user_id,
      CASE WHEN rr.source_key = 'pmb' THEN 'pendaftar' ELSE rr.source_key END as user_type,
      rr.full_name,
      COALESCE(rr.nisn, '') as nisn,
      rr.username,
      COALESCE(rr.class_name, '') as class_name,
      COALESCE(rr.grade, '') as grade,
      COALESCE(r.room_name, '-') as room_name,
      COALESCE(rr.tanggal_tes, '') as tanggal_tes,
      COALESCE(rr.sesi_tes, '') as sesi_tes,
      es.id as session_id,
      es.status as session_status,
      es.is_time_locked,
      es.cheat_warnings,
      es.started_at,
      es.finished_at,
      er.total_questions,
      er.total_correct,
      er.total_wrong,
      er.total_unanswered,
      er.score
    ${baseQuery}
    ORDER BY COALESCE(r.room_name, ''), COALESCE(rr.class_name, ''), rr.full_name, rr.source_id
    LIMIT ? OFFSET ?
  `;

  const { results: rows } = await db.prepare(selectQuery).bind(...params, limit, offset).all();

  const items: ParticipantReportRow[] = ((rows as any[]) || []).map(row => {
    const isSubmitted = row.session_status === 'submitted' || row.score !== null && row.score !== undefined;
    const isLocked = Number(row.is_time_locked || 0) === 1 && !isSubmitted;
    const hasSession = !!row.session_id;

    let status: 'not_started' | 'in_progress' | 'submitted' | 'locked' = 'not_started';
    let statusLabel = 'Belum Ikut';

    if (isSubmitted) {
      status = 'submitted';
      statusLabel = 'Selesai';
    } else if (isLocked) {
      status = 'locked';
      statusLabel = 'Dikunci';
    } else if (hasSession) {
      status = 'in_progress';
      statusLabel = 'Mengerjakan';
    }

    return {
      userId: row.user_id,
      userType: row.user_type,
      fullName: row.full_name || '',
      nisn: row.nisn || '',
      username: row.username || '',
      className: row.class_name || '',
      grade: row.grade || '',
      roomName: row.room_name || '-',
      tanggalTes: row.tanggal_tes || '',
      sesiTes: row.sesi_tes || '',
      status,
      statusLabel,
      totalQuestions: isSubmitted ? Number(row.total_questions || 0) : '',
      totalCorrect: isSubmitted ? Number(row.total_correct || 0) : '',
      totalWrong: isSubmitted ? Number(row.total_wrong || 0) : '',
      totalUnanswered: isSubmitted ? Number(row.total_unanswered || 0) : '',
      score: isSubmitted ? Number(row.score || 0) : '',
      startedAt: row.started_at || null,
      finishedAt: row.finished_at || null,
      isTimeLocked: isLocked,
      cheatWarnings: Number(row.cheat_warnings || 0),
    };
  });

  return {
    items,
    total,
    page,
    limit,
    totalPages,
  };
}
