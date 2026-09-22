// ============================================================
// Reporting Service — Participation Aggregations
// ============================================================

import type { ParticipationReport, ParticipationItem } from './types.ts';

export async function getExamParticipation(
  db: D1Database,
  examId: string
): Promise<ParticipationReport> {
  // Aggregate by Room
  const { results: roomRows } = await db.prepare(
    `SELECT
       COALESCE(r.id, 'roomless') as room_id,
       COALESCE(r.room_name, 'Tanpa Ruangan') as room_name,
       COUNT(rr.id) as total_enrolled,
       SUM(CASE WHEN es.id IS NULL THEN 1 ELSE 0 END) as not_started,
       SUM(CASE WHEN es.status = 'active' AND es.is_time_locked = 0 THEN 1 ELSE 0 END) as in_progress,
       SUM(CASE WHEN es.status = 'submitted' THEN 1 ELSE 0 END) as submitted,
       SUM(CASE WHEN es.is_time_locked = 1 AND es.status != 'submitted' THEN 1 ELSE 0 END) as locked,
       AVG(er.score) as avg_score
     FROM cbt_exam_roster rr
     LEFT JOIN cbt_rooms r ON r.id = rr.room_id
     LEFT JOIN cbt_exam_sessions es ON es.exam_id = rr.exam_id AND es.user_id = rr.source_id
     LEFT JOIN cbt_exam_results er ON er.session_id = es.id
     WHERE rr.exam_id = ?
     GROUP BY COALESCE(r.id, 'roomless'), COALESCE(r.room_name, 'Tanpa Ruangan')
     ORDER BY COALESCE(r.room_name, '')`
  ).bind(examId).all();

  const byRoom: ParticipationItem[] = (roomRows as any[]).map(row => ({
    key: row.room_id,
    label: row.room_name,
    type: 'room',
    totalEnrolled: Number(row.total_enrolled || 0),
    notStarted: Number(row.not_started || 0),
    inProgress: Number(row.in_progress || 0),
    submitted: Number(row.submitted || 0),
    locked: Number(row.locked || 0),
    averageScore: row.avg_score ? Math.round(Number(row.avg_score) * 100) / 100 : 0,
  }));

  // Aggregate by Class
  const { results: classRows } = await db.prepare(
    `SELECT
       COALESCE(rr.class_name, 'Tanpa Kelas') as class_name,
       COUNT(rr.id) as total_enrolled,
       SUM(CASE WHEN es.id IS NULL THEN 1 ELSE 0 END) as not_started,
       SUM(CASE WHEN es.status = 'active' AND es.is_time_locked = 0 THEN 1 ELSE 0 END) as in_progress,
       SUM(CASE WHEN es.status = 'submitted' THEN 1 ELSE 0 END) as submitted,
       SUM(CASE WHEN es.is_time_locked = 1 AND es.status != 'submitted' THEN 1 ELSE 0 END) as locked,
       AVG(er.score) as avg_score
     FROM cbt_exam_roster rr
     LEFT JOIN cbt_exam_sessions es ON es.exam_id = rr.exam_id AND es.user_id = rr.source_id
     LEFT JOIN cbt_exam_results er ON er.session_id = es.id
     WHERE rr.exam_id = ?
     GROUP BY COALESCE(rr.class_name, 'Tanpa Kelas')
     ORDER BY COALESCE(rr.class_name, '')`
  ).bind(examId).all();

  const byClass: ParticipationItem[] = (classRows as any[]).map(row => ({
    key: row.class_name,
    label: row.class_name,
    type: 'class',
    totalEnrolled: Number(row.total_enrolled || 0),
    notStarted: Number(row.not_started || 0),
    inProgress: Number(row.in_progress || 0),
    submitted: Number(row.submitted || 0),
    locked: Number(row.locked || 0),
    averageScore: row.avg_score ? Math.round(Number(row.avg_score) * 100) / 100 : 0,
  }));

  // Aggregate by Session / Sesi
  const { results: sessionRows } = await db.prepare(
    `SELECT
       COALESCE(rr.sesi_tes, 'Default') as sesi_tes,
       COUNT(rr.id) as total_enrolled,
       SUM(CASE WHEN es.id IS NULL THEN 1 ELSE 0 END) as not_started,
       SUM(CASE WHEN es.status = 'active' AND es.is_time_locked = 0 THEN 1 ELSE 0 END) as in_progress,
       SUM(CASE WHEN es.status = 'submitted' THEN 1 ELSE 0 END) as submitted,
       SUM(CASE WHEN es.is_time_locked = 1 AND es.status != 'submitted' THEN 1 ELSE 0 END) as locked,
       AVG(er.score) as avg_score
     FROM cbt_exam_roster rr
     LEFT JOIN cbt_exam_sessions es ON es.exam_id = rr.exam_id AND es.user_id = rr.source_id
     LEFT JOIN cbt_exam_results er ON er.session_id = es.id
     WHERE rr.exam_id = ?
     GROUP BY COALESCE(rr.sesi_tes, 'Default')
     ORDER BY COALESCE(rr.sesi_tes, '')`
  ).bind(examId).all();

  const bySession: ParticipationItem[] = (sessionRows as any[]).map(row => ({
    key: row.sesi_tes,
    label: row.sesi_tes,
    type: 'session',
    totalEnrolled: Number(row.total_enrolled || 0),
    notStarted: Number(row.not_started || 0),
    inProgress: Number(row.in_progress || 0),
    submitted: Number(row.submitted || 0),
    locked: Number(row.locked || 0),
    averageScore: row.avg_score ? Math.round(Number(row.avg_score) * 100) / 100 : 0,
  }));

  const totalEnrolled = byRoom.reduce((sum, item) => sum + item.totalEnrolled, 0);

  return {
    examId,
    totalEnrolled,
    byRoom,
    byClass,
    bySession,
  };
}
