// ============================================================
// Student Routes — supports pendaftar PMB & cbt_users
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { buildRandomMaps, newId, ok, err, now, parseSesiJam, cekJadwal } from '../utils/helpers';
import { checkRateLimit } from '../utils/ratelimit';

const student = new Hono<{ Bindings: Env }>();
student.use('*', authMiddleware, requireRole('student'));

// ── GET daftar ujian aktif ────────────────────────────────────
student.get('/exams', async (c) => {
  const user = c.get('user');
  const userType = user.source === 'pendaftar' ? 'pendaftar' : 'cbt_user';

  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.description, e.duration_minutes, e.rules_text, e.active_status, e.target_jalur,
            es.id as session_id, es.status as session_status, es.is_time_locked
     FROM cbt_exams e
     LEFT JOIN cbt_exam_sessions es ON es.exam_id = e.id AND es.user_id = ? AND es.user_type = ?
     WHERE e.active_status = 'active'
     ORDER BY e.title`
  ).bind(user.sub, userType).all();

  // Kalau pendaftar PMB, ambil jadwal dan jalur
  let jadwalData: { sesi_tes: string; tanggal_tes: string; jalur: string } | null = null;
  if (userType === 'pendaftar') {
    jadwalData = await c.env.DB.prepare(
      'SELECT sesi_tes, tanggal_tes, jalur FROM pendaftar WHERE id = ?'
    ).bind(user.sub).first<any>() || null;
  }

  // Cek exam assignments per-user
  const { results: assignments } = await c.env.DB.prepare(
    'SELECT exam_id FROM cbt_exam_assignments WHERE user_id = ? AND user_type = ?'
  ).bind(user.sub, userType).all();
  const assignedExamIds = new Set((assignments as any[]).map(a => a.exam_id));

  // Filter: cek assignment dulu, lalu target_jalur
  const filtered = (results as any[]).filter(exam => {
    if (assignedExamIds.has(exam.id)) return true;
    if (!exam.target_jalur) return true;
    if (!jadwalData?.jalur) return true;
    const targets = exam.target_jalur.split(',').map((t: string) => t.trim().toLowerCase());
    return targets.includes(jadwalData.jalur.trim().toLowerCase());
  });

  const enriched = filtered.map(exam => {
    let jadwal_status: 'aktif' | 'belum' | 'selesai' | 'no_schedule' = 'no_schedule';
    let jadwal_info: string | null = null;

    if (exam.is_time_locked) {
      jadwal_status = 'selesai';
      jadwal_info = 'Waktu ujian dikunci oleh pengawas';
    } else if (jadwalData?.sesi_tes && jadwalData?.tanggal_tes) {
      const parsed = parseSesiJam(jadwalData.sesi_tes);
      if (parsed) {
        jadwal_status = cekJadwal(jadwalData.tanggal_tes, parsed.jamMulai, parsed.jamSelesai);
        const tgl = new Date(jadwalData.tanggal_tes + 'T00:00:00+07:00');
        const tglStr = tgl.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        jadwal_info = `${tglStr}, ${parsed.jamMulai}–${parsed.jamSelesai} WIB`;
      }
    } else {
      jadwal_status = 'aktif';
    }

    return { ...exam, jadwal_status, jadwal_info, target_jalur: undefined };
  });

  return c.json(ok(enriched));
});

// ── POST validasi token & mulai ujian ─────────────────────────
student.post('/exams/:examId/validate-token', async (c) => {
  const examId = c.req.param('examId');
  const user = c.get('user');
  let body: { token_code?: string; device_id?: string };
  try {
    body = await c.req.json<{ token_code: string; device_id: string }>();
  } catch {
    return c.json(err('Request body tidak valid'), 400);
  }

  const { token_code, device_id } = body;
  const userType = user.source === 'pendaftar' ? 'pendaftar' : 'cbt_user';

  if (!user.room_id) return c.json(err('Anda belum di-assign ke ruangan'), 400);
  if (!token_code)   return c.json(err('Token wajib diisi'), 400);
  if (!device_id)    return c.json(err('Device ID diperlukan'), 400);

  // ── H4: Rate limit validate-token per user (3x per 5 menit) ──
  const rl = await checkRateLimit(c.env.RATE_LIMIT, `token:user:${user.sub}`, 3, 300);
  if (!rl.allowed) {
    return c.json(err('Terlalu banyak percobaan token. Coba lagi dalam 5 menit.'), 429);
  }

  // ── Validasi jadwal untuk pendaftar PMB ──
  if (userType === 'pendaftar') {
    const jadwal = await c.env.DB.prepare(
      'SELECT sesi_tes, tanggal_tes FROM pendaftar WHERE id = ?'
    ).bind(user.sub).first<any>();

    if (jadwal?.sesi_tes && jadwal?.tanggal_tes) {
      const parsed = parseSesiJam(jadwal.sesi_tes);
      if (parsed) {
        const status = cekJadwal(jadwal.tanggal_tes, parsed.jamMulai, parsed.jamSelesai);
        if (status === 'belum') return c.json(err(`Ujian belum dimulai. Jadwal Anda: ${jadwal.sesi_tes}`), 403);
        if (status === 'selesai') return c.json(err(`Waktu ujian Anda telah berakhir (${jadwal.sesi_tes})`), 403);
      }
    }
  }

  // ── H5: Validasi token + cek expires_at ──
  const tokenRow = await c.env.DB.prepare(
    `SELECT * FROM cbt_exam_tokens
     WHERE exam_id=? AND room_id=? AND token_code=? AND is_active=1
       AND (expires_at IS NULL OR expires_at > datetime('now'))`
  ).bind(examId, user.room_id, token_code).first();
  if (!tokenRow) return c.json(err('Token tidak valid atau sudah kedaluwarsa'), 401);

  // ── Cek ujian aktif ──
  const exam = await c.env.DB.prepare(
    `SELECT * FROM cbt_exams WHERE id=? AND active_status='active'`
  ).bind(examId).first<any>();
  if (!exam) return c.json(err('Ujian tidak tersedia'), 404);

  // ── H3: Anti race-condition — coba INSERT dulu, handle UNIQUE conflict ──
  const sessionId = newId();
  const { results: questions } = await c.env.DB.prepare(
    'SELECT id FROM cbt_questions WHERE exam_id=? ORDER BY question_order'
  ).bind(examId).all();
  const qIds = (questions as any[]).map(q => q.id);
  const { results: allOpts } = await c.env.DB.prepare(
    `SELECT qo.id, qo.question_id FROM cbt_question_options qo
     JOIN cbt_questions q ON q.id = qo.question_id WHERE q.exam_id=? ORDER BY qo.option_order`
  ).bind(examId).all();
  const optsByQ: Record<string, { id: string }[]> = {};
  for (const o of allOpts as any[]) {
    if (!optsByQ[o.question_id]) optsByQ[o.question_id] = [];
    optsByQ[o.question_id].push({ id: o.id });
  }
  const qData = qIds.map(id => ({ id, options: optsByQ[id] || [] }));
  const { questionMap, optionMap } = buildRandomMaps(qData, !!exam.randomize_questions, !!exam.randomize_options);

  try {
    await c.env.DB.prepare(
      `INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, device_id, question_map, option_map, ip_address, user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(sessionId, examId, user.sub, userType, user.room_id, device_id,
      JSON.stringify(questionMap), JSON.stringify(optionMap),
      c.req.header('CF-Connecting-IP') || '', c.req.header('User-Agent') || ''
    ).run();

    return c.json(ok({
      session_id: sessionId, resumed: false,
      question_map: questionMap, option_map: optionMap,
      started_at: now(), duration_minutes: exam.duration_minutes,
    }, 'Ujian dimulai'), 201);

  } catch (e: any) {
    // UNIQUE constraint → sesi sudah ada (race condition atau double-submit)
    if (e.message?.includes('UNIQUE') || e.message?.includes('unique')) {
      const existing = await c.env.DB.prepare(
        'SELECT * FROM cbt_exam_sessions WHERE exam_id=? AND user_id=? AND user_type=?'
      ).bind(examId, user.sub, userType).first<any>();

      if (!existing) throw e; // Error lain, re-throw

      if (existing.status === 'submitted' || existing.status === 'force_submitted')
        return c.json(err('Anda sudah menyelesaikan ujian ini'), 400);
      if (existing.is_time_locked)
        return c.json(err('Waktu ujian dikunci oleh pengawas. Hubungi pengawas untuk membuka.'), 403);
      if (existing.device_id && existing.device_id !== device_id)
        return c.json(err('Sesi terkunci di perangkat lain. Hubungi pengawas untuk reset.'), 403);

      await c.env.DB.prepare(
        'UPDATE cbt_exam_sessions SET device_id=?, last_heartbeat=?, is_time_locked=0 WHERE id=?'
      ).bind(device_id, now(), existing.id).run();

      return c.json(ok({
        session_id: existing.id, resumed: true,
        question_map: JSON.parse(existing.question_map || '[]'),
        option_map: JSON.parse(existing.option_map || '{}'),
        started_at: existing.started_at, duration_minutes: exam.duration_minutes,
      }, 'Sesi dilanjutkan'));
    }
    throw e;
  }
});

// ── GET soal ujian ────────────────────────────────────────────
student.get('/sessions/:sessionId/questions', async (c) => {
  const user = c.get('user');
  const session = await c.env.DB.prepare(
    'SELECT * FROM cbt_exam_sessions WHERE id=? AND user_id=?'
  ).bind(c.req.param('sessionId'), user.sub).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan'), 404);
  if (session.status === 'submitted' || session.status === 'force_submitted')
    return c.json(err('Ujian sudah selesai'), 400);
  if (session.is_time_locked)
    return c.json(err('Waktu ujian dikunci oleh pengawas'), 403);

  const qMap: string[] = JSON.parse(session.question_map || '[]');
  const oMap: Record<string, string[]> = JSON.parse(session.option_map || '{}');

  const { results: questions } = await c.env.DB.prepare(
    // Tidak mengambil is_correct! — hanya field yang dibutuhkan siswa
    'SELECT id, question_text, question_type, image_url, audio_url, points FROM cbt_questions WHERE exam_id=?'
  ).bind(session.exam_id).all();
  const qById = new Map((questions as any[]).map(q => [q.id, q]));

  const qIds = questions.map((q: any) => q.id);
  const ph = qIds.map(() => '?').join(',');
  const { results: options } = await c.env.DB.prepare(
    // Tidak mengambil is_correct! — hanya field yang dibutuhkan siswa
    `SELECT id, question_id, option_label, option_text, image_url FROM cbt_question_options WHERE question_id IN (${ph})`
  ).bind(...qIds).all();
  const oByQ = new Map<string, any[]>();
  for (const o of options as any[]) {
    if (!oByQ.has(o.question_id)) oByQ.set(o.question_id, []);
    oByQ.get(o.question_id)!.push(o);
  }

  const ordered = qMap.map((qId, idx) => {
    const q = qById.get(qId)!;
    const oIds = oMap[qId] || [];
    const oAll = oByQ.get(qId) || [];
    const oById = new Map(oAll.map((o: any) => [o.id, o]));
    const orderedOpts = oIds.length > 0 ? oIds.map(id => oById.get(id)).filter(Boolean) : oAll;
    return { index: idx, id: q.id, question_text: q.question_text, question_type: q.question_type,
      image_url: q.image_url, audio_url: q.audio_url, options: orderedOpts };
  });

  const { results: answers } = await c.env.DB.prepare(
    'SELECT question_id, selected_option_id, essay_answer, is_doubtful FROM cbt_student_answers WHERE session_id=?'
  ).bind(c.req.param('sessionId')).all();

  const examCfg = await c.env.DB.prepare(
    'SELECT cheat_limit, cheat_action, enforce_fullscreen FROM cbt_exams WHERE id=?'
  ).bind(session.exam_id).first<any>();

  return c.json(ok({ questions: ordered, answers,
    cheat_limit: examCfg?.cheat_limit ?? 3,
    cheat_action: examCfg?.cheat_action ?? 'lock',
    enforce_fullscreen: !!(examCfg?.enforce_fullscreen),
  }));
});

// ── POST batch save jawaban ───────────────────────────────────
student.post('/sessions/:sessionId/answers', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  let body: { answers?: any[] };
  try {
    body = await c.req.json<{ answers: any[] }>();
  } catch {
    return c.json(err('Request body tidak valid'), 400);
  }
  const { answers } = body;

  const session = await c.env.DB.prepare(
    'SELECT id, status, is_time_locked, started_at, exam_id FROM cbt_exam_sessions WHERE id=? AND user_id=?'
  ).bind(sessionId, user.sub).first<any>();
  if (!session || session.status === 'submitted' || session.status === 'force_submitted')
    return c.json(err('Sesi tidak aktif'), 400);
  if (session.is_time_locked)
    return c.json(err('Waktu ujian dikunci'), 403);

  // ── M7: Server-side timer check ──
  const exam = await c.env.DB.prepare(
    'SELECT duration_minutes FROM cbt_exams WHERE id=?'
  ).bind(session.exam_id).first<any>();
  if (exam) {
    const startMs = new Date(session.started_at).getTime();
    const durationMs = (exam.duration_minutes + 1) * 60 * 1000; // +1 menit grace period
    if (Date.now() > startMs + durationMs) {
      // Auto-lock sesi yang sudah habis waktu
      await c.env.DB.prepare(
        'UPDATE cbt_exam_sessions SET is_time_locked=1 WHERE id=?'
      ).bind(sessionId).run();
      return c.json(err('Waktu ujian sudah habis'), 403);
    }
  }

  await saveAnswers(c.env.DB, sessionId, answers || []);
  await c.env.DB.prepare('UPDATE cbt_exam_sessions SET last_heartbeat=? WHERE id=?').bind(now(), sessionId).run();
  return c.json(ok(null, 'Jawaban tersimpan'));
});

// ── POST heartbeat ────────────────────────────────────────────
student.post('/sessions/:sessionId/heartbeat', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const userType = user.source === 'pendaftar' ? 'pendaftar' : 'cbt_user';

  await c.env.DB.prepare(
    'UPDATE cbt_exam_sessions SET last_heartbeat=? WHERE id=? AND user_id=?'
  ).bind(now(), sessionId, user.sub).run();

  // Cek jadwal untuk pendaftar — kalau waktu habis, kunci otomatis
  if (userType === 'pendaftar') {
    const jadwal = await c.env.DB.prepare(
      'SELECT sesi_tes, tanggal_tes FROM pendaftar WHERE id = ?'
    ).bind(user.sub).first<any>();
    if (jadwal?.sesi_tes && jadwal?.tanggal_tes) {
      const parsed = parseSesiJam(jadwal.sesi_tes);
      if (parsed && cekJadwal(jadwal.tanggal_tes, parsed.jamMulai, parsed.jamSelesai) === 'selesai') {
        await c.env.DB.prepare(
          'UPDATE cbt_exam_sessions SET is_time_locked=1 WHERE id=? AND is_time_locked=0'
        ).bind(sessionId).run();
        return c.json(ok({ time_locked: true }, 'Waktu ujian berakhir'));
      }
    }
  }

  return c.json(ok({ time_locked: false }));
});

// ── POST cheat ────────────────────────────────────────────────
student.post('/sessions/:sessionId/cheat', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json<{ violation_type?: string }>().catch(() => ({} as { violation_type?: string }));
  const violationType = body.violation_type || 'tab_switch';

  const session = await c.env.DB.prepare(
    `SELECT es.*, e.cheat_limit, e.cheat_action
     FROM cbt_exam_sessions es
     JOIN cbt_exams e ON e.id = es.exam_id
     WHERE es.id = ? AND es.user_id = ?`
  ).bind(sessionId, user.sub).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan'), 404);

  const cheatLimit  = session.cheat_limit  ?? 3;
  const cheatAction = session.cheat_action ?? 'lock';
  const newW = (session.cheat_warnings || 0) + 1;
  const limitReached = newW >= cheatLimit;

  await c.env.DB.prepare(
    'INSERT INTO cbt_cheat_logs (id, session_id, violation_type, happened_at) VALUES (?,?,?,?)'
  ).bind(newId(), sessionId, violationType, now()).run();

  let actionTaken: string | null = null;

  if (limitReached) {
    if (cheatAction === 'auto_submit') {
      await c.env.DB.prepare(
        `UPDATE cbt_exam_sessions SET cheat_warnings=?, status='force_submitted', finished_at=?, last_heartbeat=? WHERE id=?`
      ).bind(newW, now(), now(), sessionId).run();
      try { await computeScore(c.env.DB, sessionId, session.exam_id, session.user_id, session.user_type); } catch {}
      actionTaken = 'auto_submit';
    } else {
      await c.env.DB.prepare(
        `UPDATE cbt_exam_sessions SET cheat_warnings=?, is_time_locked=1, last_heartbeat=? WHERE id=?`
      ).bind(newW, now(), sessionId).run();
      actionTaken = 'lock';
    }
  } else {
    await c.env.DB.prepare(
      `UPDATE cbt_exam_sessions SET cheat_warnings=?, last_heartbeat=? WHERE id=?`
    ).bind(newW, now(), sessionId).run();
  }

  return c.json(ok({
    warnings: newW,
    limit: cheatLimit,
    action_taken: actionTaken,
    locked: actionTaken === 'lock',
    force_submitted: actionTaken === 'auto_submit',
  }));
});

// ── POST submit ───────────────────────────────────────────────
student.post('/sessions/:sessionId/submit', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json<{ answers?: any[] }>().catch(() => ({} as { answers?: any[] }));
  const session = await c.env.DB.prepare(
    'SELECT * FROM cbt_exam_sessions WHERE id=? AND user_id=?'
  ).bind(sessionId, user.sub).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan'), 404);

  if (session.status !== 'submitted' && session.status !== 'force_submitted') {
    if (session.is_time_locked) {
      return c.json(err('Waktu ujian dikunci. Hubungi pengawas jika jawaban terakhir belum tersimpan.'), 403);
    }

    await saveAnswers(c.env.DB, sessionId, body.answers || []);
    await c.env.DB.prepare(
      `UPDATE cbt_exam_sessions SET status='submitted', finished_at=?, last_heartbeat=? WHERE id=? AND status NOT IN ('submitted','force_submitted')`
    ).bind(now(), now(), sessionId).run();
  }

  const result = await computeScore(c.env.DB, sessionId, session.exam_id, session.user_id, session.user_type);

  const exam = await c.env.DB.prepare(
    'SELECT completion_message, is_score_visible FROM cbt_exams WHERE id=?'
  ).bind(session.exam_id).first<any>();
  return c.json(ok({
    completion_message: exam?.completion_message || 'Ujian selesai.',
    score_visible: !!exam?.is_score_visible,
    ...(exam?.is_score_visible ? result : {}),
  }, 'Ujian berhasil diselesaikan'));
});

// ── COMPUTE SCORE ─────────────────────────────────────────────
async function saveAnswers(db: D1Database, sessionId: string, answers: any[]) {
  if (!answers?.length) return;

  const stmts = answers.map((a: any) =>
    db.prepare(
      `INSERT INTO cbt_student_answers (id, session_id, question_id, selected_option_id, essay_answer, is_doubtful, answered_at)
       VALUES (?,?,?,?,?,?,?) ON CONFLICT(session_id, question_id) DO UPDATE SET
       selected_option_id=excluded.selected_option_id, essay_answer=excluded.essay_answer,
       is_doubtful=excluded.is_doubtful, answered_at=excluded.answered_at`
    ).bind(newId(), sessionId, a.question_id, a.selected_option_id || null, a.essay_answer || null, a.is_doubtful ? 1 : 0, now())
  );
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
}

async function computeScore(db: D1Database, sessionId: string, examId: string, userId: string, userType: string) {
  const { results: answers } = await db.prepare(
    'SELECT question_id, selected_option_id FROM cbt_student_answers WHERE session_id=?'
  ).bind(sessionId).all();
  const { results: correctOpts } = await db.prepare(
    `SELECT qo.id as option_id, qo.question_id FROM cbt_question_options qo
     JOIN cbt_questions q ON q.id = qo.question_id WHERE q.exam_id=? AND qo.is_correct=1`
  ).bind(examId).all();
  const correctMap = new Map((correctOpts as any[]).map(o => [o.question_id, o.option_id]));
  const totalQ = await db.prepare('SELECT COUNT(*) as cnt FROM cbt_questions WHERE exam_id=?').bind(examId).first<any>();
  const total = totalQ?.cnt || 0;
  let correct = 0, wrong = 0;
  for (const a of answers as any[]) {
    if (a.selected_option_id === correctMap.get(a.question_id)) correct++;
    else if (a.selected_option_id) wrong++;
  }
  const unanswered = total - correct - wrong;
  const score = total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;

  // ── M1: Gunakan ON CONFLICT update agar tidak duplikasi row ──
  await db.prepare(
    `INSERT INTO cbt_exam_results (id, session_id, exam_id, user_id, user_type, total_questions, total_correct, total_wrong, total_unanswered, score)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(session_id) DO UPDATE SET
       total_questions=excluded.total_questions, total_correct=excluded.total_correct,
       total_wrong=excluded.total_wrong, total_unanswered=excluded.total_unanswered,
       score=excluded.score, computed_at=datetime('now')`
  ).bind(newId(), sessionId, examId, userId, userType, total, correct, wrong, unanswered, score).run();

  return { total_questions: total, total_correct: correct, total_wrong: wrong, total_unanswered: unanswered, score };
}

export default student;
