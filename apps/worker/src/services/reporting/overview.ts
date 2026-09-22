// ============================================================
// Reporting Service — Exam Overview & Score Summary
// ============================================================

import type { ExamOverviewReport } from './types.ts';

export async function getExamOverview(
  db: D1Database,
  examId: string
): Promise<ExamOverviewReport> {
  const exam = await db.prepare(
    `SELECT e.id, e.title, e.mode, e.event_id, e.subject_name, e.duration_minutes,
            e.passing_score, e.is_score_visible, e.active_status,
            ev.name as event_name
     FROM cbt_exams e
     LEFT JOIN cbt_events ev ON ev.id = e.event_id
     WHERE e.id = ?`
  ).bind(examId).first<any>();

  if (!exam) {
    throw new Error(`Ujian '${examId}' tidak ditemukan`);
  }

  // Count total enrolled via roster and assignments
  const rosterCountRow = await db.prepare(
    'SELECT COUNT(*) as cnt FROM cbt_exam_roster WHERE exam_id = ?'
  ).bind(examId).first<any>();
  let totalEnrolled = Number(rosterCountRow?.cnt || 0);

  const assignCountRow = await db.prepare(
    `SELECT COUNT(*) as cnt FROM cbt_exam_assignments
     WHERE exam_id = ? AND user_type = 'cbt_user'`
  ).bind(examId).first<any>();
  totalEnrolled += Number(assignCountRow?.cnt || 0);

  // Participant counts by session status
  const sessionStats = await db.prepare(
    `SELECT
       COUNT(*) as total_started,
       SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted_count,
       SUM(CASE WHEN status = 'active' AND is_time_locked = 0 THEN 1 ELSE 0 END) as in_progress_count,
       SUM(CASE WHEN is_time_locked = 1 AND status != 'submitted' THEN 1 ELSE 0 END) as locked_count
     FROM cbt_exam_sessions
     WHERE exam_id = ?`
  ).bind(examId).first<any>();

  const submittedCount = Number(sessionStats?.submitted_count || 0);
  const inProgressCount = Number(sessionStats?.in_progress_count || 0);
  const lockedCount = Number(sessionStats?.locked_count || 0);
  const totalStarted = Number(sessionStats?.total_started || 0);
  const notStartedCount = Math.max(0, totalEnrolled - totalStarted);

  // Score statistics
  const scoreStats = await db.prepare(
    `SELECT
       AVG(score) as avg_score,
       MAX(score) as max_score,
       MIN(score) as min_score
     FROM cbt_exam_results
     WHERE exam_id = ?`
  ).bind(examId).first<any>();

  const passingScore = Number(exam.passing_score || 0);
  let passedCount = 0;
  let failedCount = 0;

  if (submittedCount > 0) {
    const passRow = await db.prepare(
      `SELECT
         SUM(CASE WHEN score >= ? THEN 1 ELSE 0 END) as passed_cnt,
         SUM(CASE WHEN score < ? THEN 1 ELSE 0 END) as failed_cnt
       FROM cbt_exam_results
       WHERE exam_id = ?`
    ).bind(passingScore, passingScore, examId).first<any>();

    passedCount = Number(passRow?.passed_cnt || 0);
    failedCount = Number(passRow?.failed_cnt || 0);
  }

  // Calculate median score if scores exist
  let median = 0;
  if (submittedCount > 0) {
    const { results: scores } = await db.prepare(
      'SELECT score FROM cbt_exam_results WHERE exam_id = ? ORDER BY score ASC'
    ).bind(examId).all();
    const scoreList = (scores as any[]).map(s => Number(s.score || 0));
    const mid = Math.floor(scoreList.length / 2);
    median = scoreList.length % 2 !== 0
      ? scoreList[mid]
      : Math.round(((scoreList[mid - 1] + scoreList[mid]) / 2) * 100) / 100;
  }

  const avg = Number(scoreStats?.avg_score || 0);
  const average = Math.round(avg * 100) / 100;
  const highest = Number(scoreStats?.max_score || 0);
  const lowest = Number(scoreStats?.min_score || 0);
  const passRate = submittedCount > 0 ? Math.round((passedCount / submittedCount) * 10000) / 100 : 0;

  return {
    examId: exam.id,
    title: exam.title,
    mode: exam.mode,
    eventId: exam.event_id || undefined,
    eventName: exam.event_name || undefined,
    subjectName: exam.subject_name || undefined,
    durationMinutes: Number(exam.duration_minutes || 60),
    passingScore,
    isScoreVisible: !!exam.is_score_visible,
    activeStatus: exam.active_status,
    totalEnrolled,
    notStartedCount,
    inProgressCount,
    submittedCount,
    lockedCount,
    scoreSummary: {
      average,
      highest,
      lowest,
      median,
      passedCount,
      failedCount,
      passRate,
    },
  };
}
