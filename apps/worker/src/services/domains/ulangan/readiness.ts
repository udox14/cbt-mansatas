// ============================================================
// Ulangan Readiness Service
//
// Evaluates deterministic readiness for teacher Ulangan Harian assessments.
// Uses stored CBT state to guarantee historical validity without
// requiring live Mansatas round-trips for already configured exams.
// ============================================================

export interface UlanganCheckItem {
  name: string;
  passed: boolean;
  message: string;
  is_blocker: boolean;
  count?: number;
}

export interface UlanganReadinessReport {
  ready: boolean;
  checks: Record<string, UlanganCheckItem>;
  blockers: string[];
}

/**
 * Deterministically checks whether an Ulangan assessment is ready to be locked ("Siap").
 */
export async function checkUlanganReadiness(
  db: D1Database,
  examId: string
): Promise<UlanganReadinessReport> {
  const exam = await db
    .prepare(
      `SELECT id, title, duration_minutes, active_status, mode,
              teaching_assignment_id, subject_id, class_id, class_name, subject_name
       FROM cbt_exams
       WHERE id = ?`
    )
    .bind(examId)
    .first<any>();

  if (!exam) {
    return {
      ready: false,
      checks: {},
      blockers: ['Ujian tidak ditemukan'],
    };
  }

  const checks: Record<string, UlanganCheckItem> = {};
  const blockers: string[] = [];

  // 1. Teaching Context Check
  const hasContext = Boolean(exam.teaching_assignment_id && exam.subject_id && exam.class_id);
  checks.teaching_context = {
    name: 'Konteks Penugasan Mengajar',
    passed: hasContext,
    message: hasContext
      ? `Terhubung ke penugasan: ${exam.subject_name || 'Mapel'} (${exam.class_name || 'Kelas'})`
      : 'Konteks penugasan mengajar Mansatas belum lengkap',
    is_blocker: true,
  };
  if (!hasContext) blockers.push(checks.teaching_context.message);

  // 2. Exam Duration Check
  const duration = Number(exam.duration_minutes || 0);
  const durationValid = duration >= 1 && duration <= 600;
  checks.duration = {
    name: 'Durasi Ujian',
    passed: durationValid,
    message: durationValid
      ? `Durasi: ${duration} menit`
      : 'Durasi ujian tidak valid (harus antara 1–600 menit)',
    is_blocker: true,
  };
  if (!durationValid) blockers.push(checks.duration.message);

  // 3. Questions Check
  const { results: questions } = await db
    .prepare(
      `SELECT id, question_type, points
       FROM cbt_questions
       WHERE exam_id = ?`
    )
    .bind(examId)
    .all<any>();

  const qList = questions || [];
  const questionCount = qList.length;
  const hasQuestions = questionCount > 0;

  checks.questions = {
    name: 'Ketersediaan Soal',
    passed: hasQuestions,
    count: questionCount,
    message: hasQuestions
      ? `${questionCount} butir soal tersedia`
      : 'Belum ada soal pada ulangan ini (tambahkan minimal 1 soal)',
    is_blocker: true,
  };
  if (!hasQuestions) blockers.push(checks.questions.message);

  // 4. Answer Key & Points Validation
  let answerKeysValid = true;
  let answerKeyError = '';

  if (hasQuestions) {
    const invalidPoints = qList.some((q) => Number(q.points || 0) <= 0);
    if (invalidPoints) {
      answerKeysValid = false;
      answerKeyError = 'Terdapat soal dengan bobot poin 0 atau tidak valid';
    }

    const mcQuestions = qList.filter((q) => (q.question_type || 'multiple_choice') === 'multiple_choice');
    if (mcQuestions.length > 0) {
      const qIds = mcQuestions.map((q) => q.id);
      const placeholders = qIds.map(() => '?').join(',');
      const { results: correctOptions } = await db
        .prepare(
          `SELECT question_id, COUNT(*) AS correct_count
           FROM cbt_question_options
           WHERE question_id IN (${placeholders}) AND is_correct = 1
           GROUP BY question_id`
        )
        .bind(...qIds)
        .all<any>();

      const correctMap = new Map<string, number>();
      for (const row of correctOptions || []) {
        correctMap.set(row.question_id, Number(row.correct_count || 0));
      }

      const missingKeyCount = mcQuestions.filter((q) => (correctMap.get(q.id) || 0) === 0).length;
      if (missingKeyCount > 0) {
        answerKeysValid = false;
        answerKeyError = `${missingKeyCount} soal pilihan ganda belum memiliki kunci jawaban benar`;
      }
    }
  }

  checks.answer_keys = {
    name: 'Kunci Jawaban & Poin',
    passed: hasQuestions && answerKeysValid,
    message: !hasQuestions
      ? 'Belum ada soal untuk diperiksa'
      : answerKeysValid
      ? 'Semua soal memiliki kunci jawaban dan poin yang valid'
      : answerKeyError,
    is_blocker: true,
  };
  if (hasQuestions && !answerKeysValid) blockers.push(checks.answer_keys.message);

  // 5. Participants Roster Check
  const rosterCountRow = await db
    .prepare('SELECT COUNT(*) AS total FROM cbt_exam_roster WHERE exam_id = ?')
    .bind(examId)
    .first<any>();

  const rosterCount = Number(rosterCountRow?.total || 0);
  const hasRoster = rosterCount > 0;

  checks.participants = {
    name: 'Peserta Ujian (Roster Snapshot)',
    passed: hasRoster,
    count: rosterCount,
    message: hasRoster
      ? `${rosterCount} siswa telah disnapshot ke roster ujian`
      : 'Belum ada peserta yang disnapshot (snapshot peserta dari kelas yang diajar)',
    is_blocker: true,
  };
  if (!hasRoster) blockers.push(checks.participants.message);

  // 6. Token Policy Check (Ulangan V1 requires an active classroom token)
  const tokenRow = await db
    .prepare('SELECT COUNT(*) AS total FROM cbt_exam_tokens WHERE exam_id = ? AND is_active = 1')
    .bind(examId)
    .first<any>();

  const tokenCount = Number(tokenRow?.total || 0);
  const hasToken = tokenCount > 0;

  checks.token = {
    name: 'Token Ujian Kelas',
    passed: hasToken,
    count: tokenCount,
    message: hasToken
      ? 'Token ujian aktif siap digunakan di kelas'
      : 'Token belum digenerate atau belum aktif (generate token untuk kelas)',
    is_blocker: true,
  };
  if (!hasToken) blockers.push(checks.token.message);

  return {
    ready: blockers.length === 0,
    checks,
    blockers,
  };
}
