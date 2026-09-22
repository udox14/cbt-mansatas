// ============================================================
// Kegiatan Domain — Readiness Evaluation Service
//
// Minimal, deterministic, server-authoritative readiness checks
// evaluated before advancing a Kegiatan event from configuration to ready.
// ============================================================

export interface ReadinessCheckItem {
  key: 'event_config' | 'exams' | 'questions' | 'participants' | 'tokens';
  ok: boolean;
  message: string;
  blocking: boolean;
  details?: Record<string, unknown> | Array<unknown>;
}

export interface EventReadinessResult {
  ready: boolean;
  checks: ReadinessCheckItem[];
}

export async function checkKegiatanEventReadiness(
  db: D1Database,
  eventId: string
): Promise<EventReadinessResult> {
  const checks: ReadinessCheckItem[] = [];

  // 1. Check event configuration
  const event = await db
    .prepare('SELECT id, code, name, mode, status FROM cbt_events WHERE id = ?')
    .bind(eventId)
    .first<any>();

  if (!event) {
    checks.push({
      key: 'event_config',
      ok: false,
      message: 'Kegiatan tidak ditemukan',
      blocking: true,
    });
    return { ready: false, checks };
  }

  if (event.mode !== 'kegiatan') {
    checks.push({
      key: 'event_config',
      ok: false,
      message: `Kegiatan memiliki mode '${event.mode}', bukan 'kegiatan'`,
      blocking: true,
    });
    return { ready: false, checks };
  }

  const validCode = Boolean(event.code && String(event.code).trim().length > 0);
  const validName = Boolean(event.name && String(event.name).trim().length > 0);
  const configOk = validCode && validName;

  checks.push({
    key: 'event_config',
    ok: configOk,
    message: configOk
      ? `Konfigurasi kegiatan valid (${event.code} - ${event.name})`
      : 'Kode atau nama kegiatan belum lengkap',
    blocking: true,
  });

  // 2. Check exams belonging to event
  const { results: exams } = await db
    .prepare('SELECT id, title, active_status FROM cbt_exams WHERE event_id = ?')
    .bind(eventId)
    .all<any>();

  const examList = exams || [];
  const hasExams = examList.length > 0;

  checks.push({
    key: 'exams',
    ok: hasExams,
    message: hasExams
      ? `${examList.length} ujian terdaftar pada kegiatan ini`
      : 'Belum ada ujian yang dibuat pada kegiatan ini (minimal 1 ujian)',
    blocking: true,
    details: { total_exams: examList.length },
  });

  // 3. Check questions & answer keys for each exam
  let allQuestionsValid = true;
  const questionDetails: Array<{ exam_id: string; title: string; ok: boolean; reason?: string }> = [];

  if (hasExams) {
    for (const ex of examList) {
      const { results: questions } = await db
        .prepare(
          `SELECT q.id, q.points, q.question_type,
                  (SELECT COUNT(*) FROM cbt_question_options o WHERE o.question_id = q.id AND o.is_correct = 1) AS correct_options
           FROM cbt_questions q
           WHERE q.exam_id = ?`
        )
        .bind(ex.id)
        .all<any>();

      const qList = questions || [];
      if (qList.length === 0) {
        allQuestionsValid = false;
        questionDetails.push({ exam_id: ex.id, title: ex.title, ok: false, reason: 'Belum ada soal' });
        continue;
      }

      let examOk = true;
      for (const q of qList) {
        if (q.question_type === 'multiple_choice' && Number(q.correct_options || 0) < 1) {
          examOk = false;
          break;
        }
        if (Number(q.points || 0) <= 0) {
          examOk = false;
          break;
        }
      }

      if (!examOk) {
        allQuestionsValid = false;
        questionDetails.push({
          exam_id: ex.id,
          title: ex.title,
          ok: false,
          reason: 'Terdapat soal pilihan ganda tanpa kunci jawaban atau bobot <= 0',
        });
      } else {
        questionDetails.push({ exam_id: ex.id, title: ex.title, ok: true });
      }
    }
  } else {
    allQuestionsValid = false;
  }

  checks.push({
    key: 'questions',
    ok: allQuestionsValid,
    message: allQuestionsValid
      ? 'Seluruh ujian memiliki bank soal dan kunci jawaban yang valid'
      : hasExams
      ? 'Terdapat ujian yang belum memiliki soal lengkap atau kunci jawaban'
      : 'Ujian belum dibuat sehingga soal belum dapat diverifikasi',
    blocking: true,
    details: { exams: questionDetails },
  });

  // 4. Check participants roster in event (per-exam requirement)
  if (!hasExams) {
    checks.push({
      key: 'participants',
      ok: false,
      message: 'Ujian belum dibuat sehingga peserta belum dapat diverifikasi',
      blocking: true,
      details: [],
    });
  } else {
    const examParticipantCounts: Array<{
      exam_id: string;
      exam_title: string;
      participant_count: number;
    }> = [];

    for (const ex of examList) {
      const countRes = await db
        .prepare(
          `SELECT COUNT(DISTINCT source_key || ':' || source_id) AS total
           FROM cbt_exam_roster
           WHERE exam_id = ? AND event_id = ?`
        )
        .bind(ex.id, eventId)
        .first<any>();

      const count = Number(countRes?.total || 0);
      examParticipantCounts.push({
        exam_id: ex.id,
        exam_title: ex.title,
        participant_count: count,
      });
    }

    const missingExams = examParticipantCounts.filter((e) => e.participant_count === 0);
    const allExamsHaveParticipants = missingExams.length === 0;

    checks.push({
      key: 'participants',
      ok: allExamsHaveParticipants,
      message: allExamsHaveParticipants
        ? 'Seluruh ujian memiliki peserta terdaftar pada roster'
        : missingExams.length === examParticipantCounts.length
        ? 'Peserta belum dipilih / snapshot ke roster kegiatan (minimal 1 peserta per ujian)'
        : 'Masih ada ujian tanpa peserta',
      blocking: true,
      details: missingExams.length > 0 ? missingExams : examParticipantCounts,
    });
  }

  // 5. Check tokens (informational only; non-blocking)
  let tokenCount = 0;
  if (hasExams) {
    const examIds = examList.map((e) => e.id);
    const tokenResult = await db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM cbt_exam_tokens
         WHERE exam_id IN (${examIds.map(() => '?').join(',')}) AND is_active = 1`
      )
      .bind(...examIds)
      .first<any>();
    tokenCount = Number(tokenResult?.total || 0);
  }

  checks.push({
    key: 'tokens',
    ok: true, // Non-blocking in Phase 3
    message: tokenCount > 0
      ? `${tokenCount} token aktif telah dibuat untuk ujian kegiatan`
      : 'Token belum di-generate (dapat dibuat sebelum atau saat pelaksanaan)',
    blocking: false,
    details: { active_tokens: tokenCount },
  });

  const ready = checks.filter((c) => c.blocking).every((c) => c.ok);
  return { ready, checks };
}
