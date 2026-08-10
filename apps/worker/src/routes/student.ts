// ============================================================
// Student Routes — supports pendaftar PMB & cbt_users
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { buildRandomMaps, newId, ok, err, now, parseSesiJam, cekJadwal } from '../utils/helpers';
import { checkRateLimit } from '../utils/ratelimit';
import { sourceToSessionUserType, sourceToRosterKey } from '../services/participants';
import { getPmbDb, getPmbTable } from '../utils/pmb';

const student = new Hono<{ Bindings: Env }>();
student.use('*', authMiddleware, requireRole('student'));

function parseServerTime(value?: string | null) {
  if (!value) return NaN;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(normalized).getTime();
}

// ── GET daftar ujian aktif ────────────────────────────────────
student.get('/exams', async (c) => {
  const user = c.get('user');
  const userType = sourceToSessionUserType(user.source);

  const { results } = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.subject_name, e.sequence_order, e.description, e.duration_minutes, e.rules_text, e.active_status, e.target_jalur, e.enforce_fullscreen,
            e.event_id, ev.name as event_name, ev.code as event_code,
            es.id as session_id, es.status as session_status, es.is_time_locked,
            COALESCE(ac.answered_count, 0) as answered_count,
            COALESCE(qc.total_questions, 0) as total_questions
     FROM cbt_exams e
     LEFT JOIN cbt_events ev ON ev.id = e.event_id
     LEFT JOIN cbt_exam_sessions es ON es.exam_id = e.id AND es.user_id = ? AND es.user_type = ?
     LEFT JOIN (
       SELECT session_id, COUNT(*) as answered_count
       FROM cbt_student_answers
       GROUP BY session_id
     ) ac ON ac.session_id = es.id
     LEFT JOIN (
       SELECT exam_id, COUNT(*) as total_questions
       FROM cbt_questions
       GROUP BY exam_id
     ) qc ON qc.exam_id = e.id
     WHERE e.active_status = 'active'
     ORDER BY COALESCE(ev.code, ''), COALESCE(e.sequence_order, 0), LOWER(e.title)`
  ).bind(user.sub, userType).all();

  // Kalau pendaftar PMB, ambil jadwal, jalur, dan ruangan
  let jadwalData: { sesi_tes: string; tanggal_tes: string; jalur: string; ruang_tes: string } | null = null;
  let studentRoom: string | null = null;
  let studentSesi: string | null = null;
  let studentGroupKey: string | null = null; // composite key "tanggal_tes|sesi_tes"
  const rosterByExam = new Map<string, { room_id: string | null; tanggal_tes: string; sesi_tes: string }>();

  if (userType === 'pendaftar') {
    const pmbDb = getPmbDb(c.env);
    const pmbTable = getPmbTable(c.env);
    jadwalData = await pmbDb.prepare(
      `SELECT sesi_tes, tanggal_tes, jalur, ruang_tes FROM ${pmbTable} WHERE id = ?`
    ).bind(user.sub).first<any>() || null;
    studentRoom = jadwalData?.ruang_tes || null;
    studentSesi = jadwalData?.sesi_tes || null;
    if (jadwalData?.tanggal_tes && jadwalData?.sesi_tes) {
      studentGroupKey = `${jadwalData.tanggal_tes}|${jadwalData.sesi_tes}`;
    }
  } else if (userType === 'mansatas') {
    const { results: rosterRows } = await c.env.DB.prepare(
      `SELECT exam_id, room_id, tanggal_tes, sesi_tes
       FROM cbt_exam_roster
       WHERE source_key = ? AND source_id = ?`
    ).bind(sourceToRosterKey(user.source), user.sub).all();
    for (const row of rosterRows as any[]) {
      rosterByExam.set(row.exam_id, {
        room_id: row.room_id || null,
        tanggal_tes: row.tanggal_tes || '',
        sesi_tes: row.sesi_tes || '',
      });
    }
  } else if (user.room_id) {
    // cbt_user — resolve room_name dari room_id
    const roomRow = await c.env.DB.prepare(
      'SELECT room_name FROM cbt_rooms WHERE id = ?'
    ).bind(user.room_id).first<any>();
    studentRoom = roomRow?.room_name || null;
  }

  // Cek exam assignments: per-user, per-ruangan, per-sesi, per-kelompok (tanggal×sesi)
  const { results: assignments } = await c.env.DB.prepare(
    `SELECT DISTINCT exam_id FROM cbt_exam_assignments
     WHERE (user_id = ? AND user_type = ?)
        OR (user_type = 'room' AND ? IS NOT NULL AND user_id = ?)
        OR (user_type = 'sesi' AND ? IS NOT NULL AND user_id = ?)
        OR (user_type = 'tanggal_sesi' AND ? IS NOT NULL AND user_id = ?)`
  ).bind(user.sub, userType, studentRoom, studentRoom, studentSesi, studentSesi, studentGroupKey, studentGroupKey).all();
  const assignedExamIds = new Set((assignments as any[]).map(a => a.exam_id));

  const isDummy = ['percobaan', 'dummy'].some(k => String(user.username || '').toLowerCase().startsWith(k));
  const hasSpecificAssignments = isDummy && assignedExamIds.size > 0;

  // Filter: Jika dummy memiliki assignment spesifik dari Admin, hanya tampilkan ujian tersebut. Jika belum di-assign spesifik, tampilkan seluruh ujian aktif.
  const filtered = (results as any[]).filter(exam => {
    if (isDummy) {
      if (hasSpecificAssignments) return assignedExamIds.has(exam.id);
      return true;
    }
    if (userType === 'mansatas') return rosterByExam.has(exam.id);
    if (assignedExamIds.has(exam.id)) return true;
    if (!exam.target_jalur) return true;
    if (!jadwalData?.jalur) return true;
    const targets = exam.target_jalur.split(',').map((t: string) => t.trim().toLowerCase());
    return targets.includes(jadwalData.jalur.trim().toLowerCase());
  });

  const enriched = filtered.map(exam => {
    let jadwal_status: 'aktif' | 'belum' | 'selesai' | 'dikunci' | 'no_schedule' = 'no_schedule';
    let jadwal_info: string | null = null;
    const schedule = userType === 'mansatas' ? rosterByExam.get(exam.id) : jadwalData;

    if (isDummy) {
      jadwal_status = 'aktif';
      jadwal_info = 'Akun Dummy / Trial (Dapat diulang sesuka hati)';
    } else if (exam.is_time_locked) {
      jadwal_status = 'dikunci';
      jadwal_info = 'Ujian dikunci. Hubungi proktor untuk membuka kembali.';
    } else if (schedule?.sesi_tes && schedule?.tanggal_tes) {
      const parsed = parseSesiJam(schedule.sesi_tes);
      if (parsed) {
        jadwal_status = cekJadwal(schedule.tanggal_tes, parsed.jamMulai, parsed.jamSelesai);
        const tgl = new Date(schedule.tanggal_tes + 'T00:00:00+07:00');
        const tglStr = tgl.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        jadwal_info = `${tglStr}, ${parsed.jamMulai}–${parsed.jamSelesai} WIB`;
      }
    } else {
      jadwal_status = 'aktif';
    }

    // Untuk akun dummy, hilangkan status session_status agar tombol 'Mulai Ujian' selalu aktif
    const sessionStatus = isDummy ? null : exam.session_status;

    return {
      ...exam,
      session_status: sessionStatus,
      enforce_fullscreen: !isDummy && !!exam.enforce_fullscreen,
      jadwal_status,
      jadwal_info,
      target_jalur: undefined,
      is_dummy: isDummy,
    };
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
  const cleanToken = (token_code || '').trim().toUpperCase();
  const userType = sourceToSessionUserType(user.source);
  const isDummy = ['percobaan', 'dummy'].some(k => String(user.username || '').toLowerCase().startsWith(k));
  let roomId = user.room_id || (isDummy ? 'dummy_room' : null);

  let tanggalTes = '';
  let sesiTes = '';

  const roster = await c.env.DB.prepare(
    `SELECT room_id, tanggal_tes, sesi_tes
     FROM cbt_exam_roster
     WHERE exam_id = ? AND source_key = ? AND source_id = ?`
  ).bind(examId, sourceToRosterKey(user.source), user.sub).first<any>();

  if (roster) {
    if (roster.room_id) roomId = roster.room_id || roomId;
    if (roster.tanggal_tes) tanggalTes = roster.tanggal_tes;
    if (roster.sesi_tes) sesiTes = roster.sesi_tes;
  } else if (userType === 'mansatas' && !isDummy) {
    return c.json(err('Anda belum di-assign ke roster ujian ini'), 403);
  }

  if (!roomId && !isDummy) return c.json(err('Anda belum di-assign ke ruangan'), 400);
  if (!cleanToken)   return c.json(err('Token wajib diisi'), 400);
  if (!device_id)    return c.json(err('Device ID diperlukan'), 400);

  // ── Rate limit ──
  if (!isDummy) {
    const rl = await checkRateLimit(c.env.RATE_LIMIT, `token:user:${user.sub}`, 3, 300);
    if (!rl.allowed) {
      return c.json(err('Terlalu banyak percobaan token. Coba lagi dalam 5 menit.'), 429);
    }
  }

  // ── Validasi jadwal untuk pendaftar PMB jika belum ada di roster ──
  if (userType === 'pendaftar' && !isDummy && (!tanggalTes || !sesiTes)) {
    const pmbDb = getPmbDb(c.env);
    const pmbTable = getPmbTable(c.env);
    const jadwal = await pmbDb.prepare(
      `SELECT sesi_tes, tanggal_tes FROM ${pmbTable} WHERE id = ?`
    ).bind(user.sub).first<any>();

    if (jadwal?.sesi_tes && jadwal?.tanggal_tes) {
      tanggalTes = jadwal.tanggal_tes;
      sesiTes = jadwal.sesi_tes;
      const parsed = parseSesiJam(jadwal.sesi_tes);
      if (parsed) {
        const status = cekJadwal(jadwal.tanggal_tes, parsed.jamMulai, parsed.jamSelesai);
        if (status === 'belum') return c.json(err(`Ujian belum dimulai. Jadwal Anda: ${jadwal.sesi_tes}`), 403);
        if (status === 'selesai') return c.json(err(`Waktu ujian Anda telah berakhir (${jadwal.sesi_tes})`), 403);
      }
    }
  }

  // ── Validasi token + cek expires_at ──
  // Step 1: Cari token aktif berdasarkan exam_id, room_id, dan UPPER(token_code)
  let tokenRow = await c.env.DB.prepare(
    `SELECT * FROM cbt_exam_tokens
     WHERE exam_id=? AND room_id=? AND UPPER(token_code)=? AND is_active=1
       AND (expires_at IS NULL OR expires_at > datetime('now'))
     ORDER BY created_at DESC LIMIT 1`
  ).bind(examId, roomId, cleanToken).first();

  // Step 2: Fallback ke token tingkat exam jika token di-set global / tanpa filter ruangan khusus
  if (!tokenRow) {
    tokenRow = await c.env.DB.prepare(
      `SELECT * FROM cbt_exam_tokens
       WHERE exam_id=? AND UPPER(token_code)=? AND is_active=1
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY created_at DESC LIMIT 1`
    ).bind(examId, cleanToken).first();
  }

  // Step 3: Akun dummy diperbolehkan pakai token 'DUMMY' atau '1234' atau token ujian aktif apa saja
  if (!tokenRow && isDummy) {
    const anyToken = await c.env.DB.prepare(
      `SELECT * FROM cbt_exam_tokens WHERE exam_id=? AND is_active=1 LIMIT 1`
    ).bind(examId).first();
    if (anyToken || ['PERCOBAAN', 'DUMMY', '1234'].includes(cleanToken)) {
      tokenRow = { token_code: cleanToken };
    }
  }

  // Step 4: Jika token tetap tidak ketemu, periksa apakah token ada tapi non-aktif (is_active = 0)
  if (!tokenRow) {
    const inactiveToken = await c.env.DB.prepare(
      `SELECT * FROM cbt_exam_tokens WHERE exam_id=? AND UPPER(token_code)=? LIMIT 1`
    ).bind(examId, cleanToken).first();
    if (inactiveToken) {
      return c.json(err('Token belum diaktifkan oleh proktor atau panitia'), 401);
    }
    return c.json(err('Token tidak valid atau salah'), 401);
  }

  // ── Jika akun dummy, reset percobaan sebelumnya secara otomatis agar bisa diulang sesuka hati ──
  if (isDummy) {
    const oldSessions = await c.env.DB.prepare(
      'SELECT id FROM cbt_exam_sessions WHERE exam_id=? AND user_id=? AND user_type=?'
    ).bind(examId, user.sub, userType).all();
    for (const s of (oldSessions.results || [])) {
      await c.env.DB.prepare('DELETE FROM cbt_student_answers WHERE session_id=?').bind(s.id).run();
      await c.env.DB.prepare('DELETE FROM cbt_exam_results WHERE session_id=?').bind(s.id).run();
      await c.env.DB.prepare('DELETE FROM cbt_cheat_logs WHERE session_id=?').bind(s.id).run();
    }
    await c.env.DB.prepare(
      'DELETE FROM cbt_exam_sessions WHERE exam_id=? AND user_id=? AND user_type=?'
    ).bind(examId, user.sub, userType).run();
  }

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
    const startedAt = now();
    await c.env.DB.prepare(
      `INSERT INTO cbt_exam_sessions (id, exam_id, user_id, user_type, room_id, device_id, question_map, option_map, started_at, last_heartbeat, ip_address, user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(sessionId, examId, user.sub, userType, roomId, device_id,
      JSON.stringify(questionMap), JSON.stringify(optionMap), startedAt, startedAt,
      c.req.header('CF-Connecting-IP') || '', c.req.header('User-Agent') || ''
    ).run();

    return c.json(ok({
      session_id: sessionId, resumed: false,
      question_map: questionMap, option_map: optionMap,
      started_at: startedAt, duration_minutes: exam.duration_minutes,
    }, 'Ujian dimulai'), 201);

  } catch (e: any) {
    // UNIQUE constraint → sesi sudah ada (race condition atau double-submit)
    if (e.message?.includes('UNIQUE') || e.message?.includes('unique')) {
      const existing = await c.env.DB.prepare(
        'SELECT * FROM cbt_exam_sessions WHERE exam_id=? AND user_id=? AND user_type=?'
      ).bind(examId, user.sub, userType).first<any>();

      if (!existing) throw e; // Error lain, re-throw

      if (existing.status === 'submitted')
        return c.json(err('Anda sudah menyelesaikan ujian ini'), 400);
      if (existing.is_time_locked && !isLockedByCheat(existing, exam))
        return c.json(err('Waktu ujian dikunci oleh pengawas. Hubungi pengawas untuk membuka.'), 403);
      if (existing.device_id && existing.device_id !== device_id)
        return c.json(err('Sesi terkunci di perangkat lain. Hubungi pengawas untuk reset.'), 403);

      await c.env.DB.prepare(
        'UPDATE cbt_exam_sessions SET device_id=?, last_heartbeat=? WHERE id=?'
      ).bind(device_id, now(), existing.id).run();

      return c.json(ok({
        session_id: existing.id, resumed: true,
        question_map: JSON.parse(existing.question_map || '[]'),
        option_map: JSON.parse(existing.option_map || '{}'),
        started_at: existing.started_at, duration_minutes: exam.duration_minutes,
        locked: !!existing.is_time_locked,
        cheat_locked: isLockedByCheat(existing, exam),
        cheat_warnings: existing.cheat_warnings ?? 0,
      }, 'Sesi dilanjutkan'));
    }
    throw e;
  }
});

// ── GET soal ujian ────────────────────────────────────────────
student.get('/sessions/:sessionId/questions', async (c) => {
  const user = c.get('user');
  const userType = sourceToSessionUserType(user.source);
  const session = await c.env.DB.prepare(
    'SELECT * FROM cbt_exam_sessions WHERE id=? AND user_id=? AND user_type=?'
  ).bind(c.req.param('sessionId'), user.sub, userType).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan'), 404);
  if (session.status === 'submitted')
    return c.json(err('Ujian sudah selesai'), 400);

  const examCfg = await c.env.DB.prepare(
    'SELECT cheat_limit, cheat_action, enforce_fullscreen, duration_minutes FROM cbt_exams WHERE id=?'
  ).bind(session.exam_id).first<any>();
  const cheatLocked = isLockedByCheat(session, examCfg);
  if (session.is_time_locked && !cheatLocked)
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

  return c.json(ok({ questions: ordered, answers,
    cheat_limit: examCfg?.cheat_limit ?? 3,
    cheat_action: 'lock',
    enforce_fullscreen: !!(examCfg?.enforce_fullscreen),
    // Bug-1 fix: kembalikan state cheat agar ExamRoom bisa restore setelah refresh
    cheat_warnings: session.cheat_warnings ?? 0,
    is_time_locked: session.is_time_locked ?? 0,
    cheat_locked: cheatLocked,
  }));
});

// ── POST batch save jawaban ───────────────────────────────────
student.post('/sessions/:sessionId/answers', async (c) => {
  const user = c.get('user');
  const userType = sourceToSessionUserType(user.source);
  const sessionId = c.req.param('sessionId');
  let body: { answers?: any[] };
  try {
    body = await c.req.json<{ answers: any[] }>();
  } catch {
    return c.json(err('Request body tidak valid'), 400);
  }
  const { answers } = body;

  const session = await c.env.DB.prepare(
    'SELECT id, status, is_time_locked, started_at, exam_id FROM cbt_exam_sessions WHERE id=? AND user_id=? AND user_type=?'
  ).bind(sessionId, user.sub, userType).first<any>();
  if (!session || session.status === 'submitted')
    return c.json(err('Sesi tidak aktif'), 400);
  if (session.is_time_locked)
    return c.json(err('Waktu ujian dikunci'), 403);

  // ── M7: Server-side timer check ──
  const exam = await c.env.DB.prepare(
    'SELECT duration_minutes FROM cbt_exams WHERE id=?'
  ).bind(session.exam_id).first<any>();
  if (exam) {
    const startMs = parseServerTime(session.started_at);
    const durationMs = (exam.duration_minutes + 1) * 60 * 1000; // +1 menit grace period
    if (Date.now() > startMs + durationMs) {
      await c.env.DB.prepare(
        'UPDATE cbt_exam_sessions SET is_time_locked=1, locked_at=COALESCE(locked_at, ?), last_heartbeat=? WHERE id=? AND user_id=? AND user_type=?'
      ).bind(now(), now(), sessionId, user.sub, userType).run();
      return c.json(err('Waktu ujian sudah habis'), 403);
    }
  }

  await saveAnswers(c.env.DB, sessionId, answers || []);
  await c.env.DB.prepare('UPDATE cbt_exam_sessions SET last_heartbeat=? WHERE id=? AND user_id=? AND user_type=?')
    .bind(now(), sessionId, user.sub, userType).run();
  return c.json(ok(null, 'Jawaban tersimpan'));
});

// ── POST heartbeat ────────────────────────────────────────────
student.post('/sessions/:sessionId/heartbeat', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  const userType = sourceToSessionUserType(user.source);

  const session = await c.env.DB.prepare(
    `SELECT es.*, e.duration_minutes, e.cheat_action, e.cheat_limit
     FROM cbt_exam_sessions es
     JOIN cbt_exams e ON e.id = es.exam_id
     WHERE es.id=? AND es.user_id=? AND es.user_type=?`
  ).bind(sessionId, user.sub, userType).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan'), 404);

  await c.env.DB.prepare(
    'UPDATE cbt_exam_sessions SET last_heartbeat=? WHERE id=? AND user_id=? AND user_type=?'
  ).bind(now(), sessionId, user.sub, userType).run();

  if (session.status === 'submitted') {
    return c.json(ok({ time_locked: false, auto_submitted: true, started_at: session.started_at }));
  }

  const isCheatLock = isLockedByCheat(session, session);
  if (session.is_time_locked && isCheatLock) {
    // Bug-1/Bug-3 fix: bedakan cheat_locked vs time_locked (waktu habis)
    // cheat_action='lock' + is_time_locked=1 + belum submitted = dikunci karena cheat
    return c.json(ok({
      time_locked: true,
      auto_submitted: false,
      cheat_locked: isCheatLock,
      warnings: session.cheat_warnings ?? 0,
      started_at: session.started_at,
    }));
  }

  if (isSessionDurationExpired(session)) {
    await c.env.DB.prepare(
      'UPDATE cbt_exam_sessions SET is_time_locked=1, locked_at=COALESCE(locked_at, ?), last_heartbeat=? WHERE id=? AND user_id=? AND user_type=?'
    ).bind(now(), now(), sessionId, user.sub, userType).run();
    return c.json(ok({ time_locked: true, auto_submitted: false, started_at: session.started_at }, 'Waktu ujian berakhir dan sesi dikunci'));
  }

  // Auto-heal sesi yang sempat terkunci karena bug jam nominal sesi padahal durasi pengerjaan 2 jamnya belum habis
  if (session.is_time_locked && !isCheatLock) {
    await c.env.DB.prepare(
      'UPDATE cbt_exam_sessions SET is_time_locked=0, locked_at=NULL, last_heartbeat=? WHERE id=? AND user_id=? AND user_type=?'
    ).bind(now(), sessionId, user.sub, userType).run();
    session.is_time_locked = 0;
  }

  if (session.is_time_locked) {
    return c.json(ok({
      time_locked: true,
      auto_submitted: false,
      cheat_locked: false,
      warnings: session.cheat_warnings ?? 0,
      started_at: session.started_at,
    }));
  }

  return c.json(ok({ time_locked: false, auto_submitted: false, cheat_locked: false, warnings: session.cheat_warnings ?? 0, started_at: session.started_at }));
});

// ── POST cheat ────────────────────────────────────────────────
student.post('/sessions/:sessionId/cheat', async (c) => {
  const user = c.get('user');
  const userType = sourceToSessionUserType(user.source);
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json<{ violation_type?: string }>().catch(() => ({} as { violation_type?: string }));
  const violationType = body.violation_type || 'tab_switch';

  const session = await c.env.DB.prepare(
    `SELECT es.*, e.cheat_limit, e.cheat_action
     FROM cbt_exam_sessions es
     JOIN cbt_exams e ON e.id = es.exam_id
     WHERE es.id = ? AND es.user_id = ? AND es.user_type = ?`
  ).bind(sessionId, user.sub, userType).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan'), 404);

  const cheatLimit  = session.cheat_limit  ?? 3;
  const newW = (session.cheat_warnings || 0) + 1;
  const limitReached = newW >= cheatLimit;

  await c.env.DB.prepare(
    'INSERT INTO cbt_cheat_logs (id, session_id, violation_type, happened_at) VALUES (?,?,?,?)'
  ).bind(newId(), sessionId, violationType, now()).run();

  let actionTaken: string | null = null;

  if (limitReached) {
    await c.env.DB.prepare(
      `UPDATE cbt_exam_sessions SET cheat_warnings=?, is_time_locked=1, locked_at=COALESCE(locked_at, ?), last_heartbeat=? WHERE id=? AND user_id=? AND user_type=?`
    ).bind(newW, now(), now(), sessionId, user.sub, userType).run();
    actionTaken = 'lock';
  } else {
    await c.env.DB.prepare(
      `UPDATE cbt_exam_sessions SET cheat_warnings=?, last_heartbeat=? WHERE id=? AND user_id=? AND user_type=?`
    ).bind(newW, now(), sessionId, user.sub, userType).run();
  }

  return c.json(ok({
    warnings: newW,
    limit: cheatLimit,
    action_taken: actionTaken,
    locked: actionTaken === 'lock',
  }));
});

// ── POST submit ───────────────────────────────────────────────
student.post('/sessions/:sessionId/submit', async (c) => {
  const user = c.get('user');
  const userType = sourceToSessionUserType(user.source);
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json<{ answers?: any[] }>().catch(() => ({} as { answers?: any[] }));
  const session = await c.env.DB.prepare(
    `SELECT es.*, e.duration_minutes
     FROM cbt_exam_sessions es
     JOIN cbt_exams e ON e.id = es.exam_id
     WHERE es.id=? AND es.user_id=? AND es.user_type=?`
  ).bind(sessionId, user.sub, userType).first<any>();
  if (!session) return c.json(err('Sesi tidak ditemukan'), 404);

  if (session.status !== 'submitted') {
    const timeExpired = isSessionDurationExpired(session);
    if (session.is_time_locked) {
      return c.json(err('Ujian dikunci karena pelanggaran. Hubungi pengawas untuk melanjutkan.'), 403);
    }
    if (timeExpired) {
      await c.env.DB.prepare(
        'UPDATE cbt_exam_sessions SET is_time_locked=1, locked_at=COALESCE(locked_at, ?), last_heartbeat=? WHERE id=? AND user_id=? AND user_type=?'
      ).bind(now(), now(), sessionId, user.sub, userType).run();
      return c.json(err('Waktu ujian sudah habis. Hubungi pengawas.'), 403);
    }

    await saveAnswers(c.env.DB, session.id, body.answers || []);
    const missingCount = await countMissingRequiredAnswers(c.env.DB, session.id, session.exam_id);
    if (missingCount > 0) {
      return c.json(err(`${missingCount} soal belum diisi. Lengkapi semua soal sebelum mengirim ujian.`), 400);
    }

    await finalizeSession(c.env.DB, session, [], 'submitted');
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

async function countMissingRequiredAnswers(db: D1Database, sessionId: string, examId: string) {
  const row = await db.prepare(
    `SELECT COUNT(*) as cnt
     FROM cbt_questions q
     LEFT JOIN cbt_student_answers a
       ON a.question_id = q.id AND a.session_id = ?
     WHERE q.exam_id = ?
       AND (
         (q.question_type = 'multiple_choice' AND a.selected_option_id IS NULL)
         OR (q.question_type = 'essay' AND TRIM(COALESCE(a.essay_answer, '')) = '')
       )`
  ).bind(sessionId, examId).first<any>();
  return Number(row?.cnt || 0);
}

function isSessionDurationExpired(session: any) {
  const startedAt = parseServerTime(session.started_at);
  const durationMinutes = Number(session.duration_minutes || 0);
  if (!Number.isFinite(startedAt) || !durationMinutes) return false;
  return Date.now() >= startedAt + durationMinutes * 60 * 1000;
}

function isLockedByCheat(session: any, exam: any) {
  if (!session?.is_time_locked) return false;
  if (session.status === 'submitted') return false;
  const cheatLimit = Number(exam?.cheat_limit ?? session.cheat_limit ?? 3);
  return Number(session.cheat_warnings || 0) >= cheatLimit;
}

async function finalizeSession(db: D1Database, session: any, answers: any[], status: 'submitted') {
  await saveAnswers(db, session.id, answers || []);
  await db.prepare(
    `UPDATE cbt_exam_sessions
     SET status=?, finished_at=COALESCE(finished_at, ?), last_heartbeat=?
     WHERE id=? AND user_id=? AND user_type=? AND status != 'submitted'`
  ).bind(status, now(), now(), session.id, session.user_id, session.user_type).run();
  return computeScore(db, session.id, session.exam_id, session.user_id, session.user_type);
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
