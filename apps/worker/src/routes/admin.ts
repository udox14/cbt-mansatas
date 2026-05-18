// ============================================================
// Admin Routes — prefix cbt_, bind ke DB PMB existing
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { hashPassword, generateToken, newId, ok, err, now } from '../utils/helpers';

const admin = new Hono<{ Bindings: Env }>();
admin.use('*', authMiddleware, requireRole('admin'));

// Jalur yang tidak ikut CBT — selalu dikecualikan dari semua query CBT
const EXCLUDE_JALUR_COND = "UPPER(jalur) NOT LIKE '%PRESTASI%'";

// ══════════════════════════════════════════════════════════════
// ROOMS — auto-sync dari pendaftar.ruang_tes
// ══════════════════════════════════════════════════════════════

admin.get('/rooms', async (c) => {
  const tanggalTes = c.req.query('tanggal_tes');
  const sesiTes = c.req.query('sesi_tes');
  const pmbFilterValues: string[] = [];
  const pmbCountConditions = [`p.ruang_tes = r.room_name`, EXCLUDE_JALUR_COND];
  const pmbDedupConditions = [`p2.nisn = cu.nisn`, EXCLUDE_JALUR_COND];
  if (tanggalTes) {
    pmbCountConditions.push('p.tanggal_tes = ?');
    pmbDedupConditions.push('p2.tanggal_tes = ?');
    pmbFilterValues.push(tanggalTes);
  }
  if (sesiTes) {
    pmbCountConditions.push('p.sesi_tes = ?');
    pmbDedupConditions.push('p2.sesi_tes = ?');
    pmbFilterValues.push(sesiTes);
  }

  // Rooms + jumlah pendaftar non-Prestasi + proktor yang di-assign
  const { results } = await c.env.DB.prepare(
    `SELECT r.*,
       (
         (SELECT COUNT(*) FROM pendaftar p WHERE ${pmbCountConditions.join(' AND ')})
         +
         (SELECT COUNT(*) FROM cbt_users cu
          WHERE cu.room_id = r.id AND cu.role = 'student'
            AND NOT EXISTS (
              SELECT 1 FROM pendaftar p2
              WHERE ${pmbDedupConditions.join(' AND ')}
            ))
       ) as jumlah_peserta,
       (SELECT GROUP_CONCAT(cu.nama_lengkap, ', ') FROM cbt_users cu WHERE cu.room_id = r.id AND cu.role = 'proctor') as proctor_names
     FROM cbt_rooms r ORDER BY r.room_name`
  ).bind(...pmbFilterValues, ...pmbFilterValues).all();
  return c.json(ok(results));
});

// Sync ruangan dari data pendaftar — buat otomatis dari ruang_tes
admin.post('/rooms/sync', async (c) => {
  // Ambil semua ruang_tes unik dari pendaftar — excludes jalur Prestasi
  const { results: rooms } = await c.env.DB.prepare(
    `SELECT DISTINCT ruang_tes FROM pendaftar WHERE ruang_tes IS NOT NULL AND ruang_tes != '' AND ${EXCLUDE_JALUR_COND} ORDER BY ruang_tes`
  ).all();

  let created = 0;
  for (const r of rooms as any[]) {
    const exists = await c.env.DB.prepare(
      'SELECT id FROM cbt_rooms WHERE room_name = ?'
    ).bind(r.ruang_tes).first();
    if (!exists) {
      await c.env.DB.prepare('INSERT INTO cbt_rooms (id, room_name, capacity) VALUES (?,?,40)')
        .bind(newId(), r.ruang_tes).run();
      created++;
    }
  }
  return c.json(ok({ synced: rooms.length, created }, `${created} ruangan baru ditambahkan`));
});

admin.post('/rooms', async (c) => {
  const { room_name, capacity } = await c.req.json();
  const id = newId();
  await c.env.DB.prepare('INSERT INTO cbt_rooms (id, room_name, capacity) VALUES (?,?,?)')
    .bind(id, room_name, capacity || 40).run();
  return c.json(ok({ id }, 'Ruangan ditambahkan'), 201);
});

admin.put('/rooms/:id', async (c) => {
  const { room_name, capacity } = await c.req.json();
  await c.env.DB.prepare('UPDATE cbt_rooms SET room_name=?, capacity=? WHERE id=?')
    .bind(room_name, capacity, c.req.param('id')).run();
  return c.json(ok(null, 'Ruangan diperbarui'));
});

admin.delete('/rooms/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_rooms WHERE id=?').bind(c.req.param('id')).run();
  return c.json(ok(null, 'Ruangan dihapus'));
});

// ══════════════════════════════════════════════════════════════
// PROCTOR ASSIGNMENT — assign proktor ke ruangan
// ══════════════════════════════════════════════════════════════

// Get all proctors
admin.get('/proctors', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cu.id, cu.username, cu.nama_lengkap as full_name, cu.room_id,
       r.room_name
     FROM cbt_users cu
     LEFT JOIN cbt_rooms r ON r.id = cu.room_id
     WHERE cu.role = 'proctor' AND cu.is_active = 1
     ORDER BY cu.nama_lengkap`
  ).all();
  return c.json(ok(results));
});

// Assign proctor to room
admin.put('/proctors/:id/assign', async (c) => {
  const { room_id } = await c.req.json();
  await c.env.DB.prepare('UPDATE cbt_users SET room_id=?, updated_at=? WHERE id=? AND role=?')
    .bind(room_id || null, now(), c.req.param('id'), 'proctor').run();
  return c.json(ok(null, 'Proktor berhasil di-assign'));
});

// ══════════════════════════════════════════════════════════════
// USERS — cbt_users (proktor + student non-PMB)
// ══════════════════════════════════════════════════════════════

admin.get('/users', async (c) => {
  const role    = c.req.query('role');
  const room_id = c.req.query('room_id');

  // Kalau filter role=admin, ambil dari tabel admins
  if (role === 'admin') {
    const { results } = await c.env.DB.prepare(
      `SELECT id, username, nama_lengkap as full_name, 'admin' as role, NULL as room_id, NULL as nisn, 1 as is_active FROM admins ORDER BY nama_lengkap`
    ).all();
    return c.json(ok(results));
  }

  // Selain itu ambil dari cbt_users
  let sql = `SELECT id, username, nama_lengkap as full_name, role, room_id, nisn, is_active, 'cbt_user' as source FROM cbt_users`;
  const conditions: string[] = [];
  const params: string[] = [];
  if (role)    { conditions.push('role = ?');    params.push(role); }
  if (room_id) { conditions.push('room_id = ?'); params.push(room_id); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY nama_lengkap';
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();

  // Kalau tidak ada filter role, tambahkan juga admin dari tabel admins
  if (!role) {
    const { results: admins } = await c.env.DB.prepare(
      `SELECT id, username, nama_lengkap as full_name, 'admin' as role, NULL as room_id, NULL as nisn, 1 as is_active FROM admins ORDER BY nama_lengkap`
    ).all();
    return c.json(ok([...results, ...admins]));
  }

  return c.json(ok(results));
});

admin.post('/users', async (c) => {
  const body = await c.req.json();
  const { username, password, role, room_id, nisn } = body;
  const nama = body.full_name || body.nama_lengkap;
  if (!username || !password || !nama || !role) return c.json(err('Data tidak lengkap'), 400);
  if (!['admin', 'proctor', 'student'].includes(role)) return c.json(err('Role tidak valid'), 400);
  if (password.length < 6) return c.json(err('Password minimal 6 karakter'), 400);
  try {
    const id = newId();
    // ── C2: Semua password di-hash — termasuk admin ──
    const hash = await hashPassword(password);
    if (role === 'admin') {
      // Admin disimpan ke tabel admins (tabel PMB existing) — PBKDF2 hash
      await c.env.DB.prepare(
        'INSERT INTO admins (id, username, password, nama_lengkap) VALUES (?,?,?,?)'
      ).bind(id, username, hash, nama).run();
    } else {
      await c.env.DB.prepare(
        'INSERT INTO cbt_users (id, username, password_hash, nama_lengkap, role, room_id, nisn) VALUES (?,?,?,?,?,?,?)'
      ).bind(id, username, hash, nama, role, room_id || null, nisn || null).run();
    }
    return c.json(ok({ id }, 'User ditambahkan'), 201);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json(err('Username sudah digunakan'), 409);
    throw e;
  }
});

admin.post('/users/bulk', async (c) => {
  const { users } = await c.req.json<{ users: any[] }>();
  if (!users?.length) return c.json(err('Data kosong'), 400);
  const stmt = c.env.DB.prepare(
    'INSERT OR IGNORE INTO cbt_users (id, username, password_hash, nama_lengkap, role, room_id, nisn) VALUES (?,?,?,?,?,?,?)'
  );
  const batch = [];
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const username = String(u.username || '').trim();
    const password = String(u.password || u.username || '').trim();
    const nama = String(u.full_name || u.nama_lengkap || '').trim();
    const role = String(u.role || 'student').trim();

    if (!username || !password || !nama) return c.json(err(`Data baris ${i + 1} tidak lengkap`), 400);
    if (!['proctor', 'student'].includes(role)) return c.json(err(`Role baris ${i + 1} tidak valid`), 400);
    if (password.length < 6) return c.json(err(`Password baris ${i + 1} minimal 6 karakter`), 400);

    const hash = await hashPassword(password);
    batch.push(stmt.bind(newId(), username, hash, nama, role, u.room_id || null, u.nisn || null));
  }
  for (let i = 0; i < batch.length; i += 100) { await c.env.DB.batch(batch.slice(i, i + 100)); }
  return c.json(ok({ imported: users.length }, 'Import user berhasil'));
});

admin.put('/users/:id', async (c) => {
  const body = await c.req.json();
  const nama = body.full_name || body.nama_lengkap;
  const id = c.req.param('id');
  // ── C2: Hash password pada update juga ──
  if (body.role === 'admin') {
    let sql = 'UPDATE admins SET nama_lengkap=?';
    const params: any[] = [nama];
    if (body.password) {
      if (body.password.length < 6) return c.json(err('Password minimal 6 karakter'), 400);
      sql += ', password=?'; params.push(await hashPassword(body.password));
    }
    sql += ' WHERE id=?'; params.push(id);
    await c.env.DB.prepare(sql).bind(...params).run();
  } else {
    let sql = 'UPDATE cbt_users SET nama_lengkap=?, role=?, room_id=?, nisn=?, is_active=?, updated_at=?';
    const params: any[] = [nama, body.role, body.room_id || null, body.nisn || null, body.is_active ?? 1, now()];
    if (body.password) {
      if (body.password.length < 6) return c.json(err('Password minimal 6 karakter'), 400);
      sql += ', password_hash=?'; params.push(await hashPassword(body.password));
    }
    sql += ' WHERE id=?'; params.push(id);
    await c.env.DB.prepare(sql).bind(...params).run();
  }
  return c.json(ok(null, 'User diperbarui'));
});

admin.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM cbt_exam_sessions WHERE user_id=? AND user_type=?').bind(id, 'cbt_user'),
    c.env.DB.prepare('DELETE FROM cbt_exam_results WHERE user_id=? AND user_type=?').bind(id, 'cbt_user'),
    c.env.DB.prepare('DELETE FROM cbt_users WHERE id=?').bind(id),
    c.env.DB.prepare('DELETE FROM admins WHERE id=?').bind(id),
  ]);
  return c.json(ok(null, 'User dihapus'));
});

// ══════════════════════════════════════════════════════════════
// PENDAFTAR PMB (read-only dari tabel existing)
// ══════════════════════════════════════════════════════════════

admin.get('/pendaftar', async (c) => {
  const room  = c.req.query('ruang_tes');
  const jalur = c.req.query('jalur');
  const tanggalTes = c.req.query('tanggal_tes');
  const sesiTes = c.req.query('sesi_tes');
  let sql = `SELECT id, nisn, nama_lengkap, no_pendaftaran, ruang_tes, jalur, asal_sekolah,
            jenis_kelamin, tanggal_lahir, tanggal_tes, sesi_tes,
            status_verifikasi, status_kelulusan
     FROM pendaftar WHERE ${EXCLUDE_JALUR_COND}`;
  const params: string[] = [];
  if (room)  { sql += ' AND ruang_tes = ?'; params.push(room); }
  if (jalur) { sql += ' AND LOWER(jalur) = LOWER(?)'; params.push(jalur); }
  if (tanggalTes) { sql += ' AND tanggal_tes = ?'; params.push(tanggalTes); }
  if (sesiTes) { sql += ' AND sesi_tes = ?'; params.push(sesiTes); }
  sql += ' ORDER BY ruang_tes, nama_lengkap';
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(ok(results));
});

// ── L4: Endpoint hapus pendaftar dinonaktifkan ──
// Berbahaya karena menghapus data dari tabel PMB utama (shared database).
// Gunakan dashboard PMB langsung jika benar-benar diperlukan.
admin.delete('/pendaftar/:id', async (c) => {
  return c.json(err('Penghapusan peserta dinonaktifkan dari CBT untuk melindungi data PMB. Gunakan sistem PMB utama.'), 403);
});

// Update ruang_tes peserta pendaftar PMB
admin.put('/pendaftar/:id/ruang', async (c) => {
  const { ruang_tes } = await c.req.json<{ ruang_tes: string | null }>();
  await c.env.DB.prepare(
    'UPDATE pendaftar SET ruang_tes = ? WHERE id = ?'
  ).bind(ruang_tes || null, c.req.param('id')).run();
  return c.json(ok(null, 'Ruangan berhasil diperbarui'));
});

admin.post('/participants/assign-room', async (c) => {
  const { participants, ruang_tes } = await c.req.json<{
    participants?: { id: string; source: 'pmb' | 'manual' }[];
    ruang_tes?: string | null;
  }>();
  if (!participants?.length) return c.json(err('Pilih minimal 1 peserta'), 400);

  const roomName = ruang_tes || null;
  let roomId: string | null = null;
  if (roomName) {
    const room = await c.env.DB.prepare('SELECT id FROM cbt_rooms WHERE room_name = ?')
      .bind(roomName).first<any>();
    if (!room) return c.json(err('Ruangan tidak ditemukan'), 404);
    roomId = room.id;
  }

  const pmbStmt = c.env.DB.prepare('UPDATE pendaftar SET ruang_tes = ? WHERE id = ?');
  const manualStmt = c.env.DB.prepare('UPDATE cbt_users SET room_id = ?, updated_at = ? WHERE id = ? AND role = ?');
  const batch = participants.map(p => {
    if (p.source === 'manual') return manualStmt.bind(roomId, now(), p.id, 'student');
    return pmbStmt.bind(roomName, p.id);
  });
  for (let i = 0; i < batch.length; i += 100) await c.env.DB.batch(batch.slice(i, i + 100));
  return c.json(ok({ updated: participants.length }, `${participants.length} peserta berhasil di-assign`));
});

// Statistik pendaftar (exclude Prestasi)
admin.get('/pendaftar/stats', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       COUNT(ruang_tes) as assigned_room,
       COUNT(DISTINCT ruang_tes) as total_rooms,
       COUNT(tanggal_tes) as has_schedule
     FROM pendaftar WHERE ${EXCLUDE_JALUR_COND}`
  ).first<any>();
  return c.json(ok(results));
});

// Daftar jalur unik dari pendaftar (exclude Prestasi)
admin.get('/pendaftar/jalur', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT jalur FROM pendaftar WHERE jalur IS NOT NULL AND jalur != '' AND ${EXCLUDE_JALUR_COND} ORDER BY jalur`
  ).all();
  return c.json(ok(results.map((r: any) => r.jalur)));
});

// Daftar sesi unik dari pendaftar
admin.get('/pendaftar/sesi', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT sesi_tes FROM pendaftar WHERE sesi_tes IS NOT NULL AND sesi_tes != '' ORDER BY sesi_tes`
  ).all();
  return c.json(ok(results.map((r: any) => r.sesi_tes)));
});

// Daftar kelompok tes unik (tanggal × sesi) dengan jumlah peserta — untuk bulk assign
admin.get('/pendaftar/groups', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT tanggal_tes, sesi_tes,
       COUNT(*) as jumlah_peserta,
       GROUP_CONCAT(DISTINCT ruang_tes ORDER BY ruang_tes) as ruangan
     FROM pendaftar
     WHERE tanggal_tes IS NOT NULL AND sesi_tes IS NOT NULL AND ${EXCLUDE_JALUR_COND}
     GROUP BY tanggal_tes, sesi_tes
     ORDER BY tanggal_tes, sesi_tes`
  ).all();
  return c.json(ok(results));
});


// ══════════════════════════════════════════════════════════════

admin.get('/exams', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, COUNT(q.id) as question_count
     FROM cbt_exams e LEFT JOIN cbt_questions q ON q.exam_id = e.id
     GROUP BY e.id ORDER BY e.created_at DESC`
  ).all();
  return c.json(ok(results));
});

admin.get('/exams/:id', async (c) => {
  const exam = await c.env.DB.prepare('SELECT * FROM cbt_exams WHERE id=?').bind(c.req.param('id')).first();
  if (!exam) return c.json(err('Ujian tidak ditemukan'), 404);
  return c.json(ok(exam));
});

admin.post('/exams', async (c) => {
  const b = await c.req.json();
  const user = c.get('user');

  // ── M2: Validasi input ──
  if (!b.title || typeof b.title !== 'string' || b.title.trim().length === 0)
    return c.json(err('Judul ujian wajib diisi'), 400);
  const duration = Number(b.duration_minutes);
  if (!Number.isInteger(duration) || duration < 1 || duration > 600)
    return c.json(err('Durasi ujian harus antara 1–600 menit'), 400);
  const cheatLimit = Number(b.cheat_limit ?? 3);
  if (!Number.isInteger(cheatLimit) || cheatLimit < 1 || cheatLimit > 50)
    return c.json(err('Cheat limit harus antara 1–50'), 400);
  if (b.cheat_action && !['lock', 'auto_submit'].includes(b.cheat_action))
    return c.json(err('Cheat action tidak valid'), 400);
  if (b.active_status && !['draft', 'active', 'finished'].includes(b.active_status))
    return c.json(err('Status tidak valid'), 400);

  const id = newId();
  await c.env.DB.prepare(
    `INSERT INTO cbt_exams (id, title, description, duration_minutes, rules_text, completion_message,
     is_score_visible, randomize_questions, randomize_options, active_status, passing_score, created_by,
     target_jalur, cheat_limit, cheat_action, enforce_fullscreen)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, b.title.trim(), b.description || null, duration,
    b.rules_text || null, b.completion_message || 'Ujian telah selesai. Terima kasih.',
    b.is_score_visible ? 1 : 0, b.randomize_questions ? 1 : 0,
    b.randomize_options ? 1 : 0, b.active_status || 'draft', b.passing_score || 0, user.sub,
    b.target_jalur || null, cheatLimit, b.cheat_action || 'lock', b.enforce_fullscreen ? 1 : 0
  ).run();
  return c.json(ok({ id }, 'Ujian dibuat'), 201);
});

admin.put('/exams/:id', async (c) => {
  const b = await c.req.json();

  // ── M2: Validasi input ──
  if (!b.title || typeof b.title !== 'string' || b.title.trim().length === 0)
    return c.json(err('Judul ujian wajib diisi'), 400);
  const duration = Number(b.duration_minutes);
  if (!Number.isInteger(duration) || duration < 1 || duration > 600)
    return c.json(err('Durasi ujian harus antara 1–600 menit'), 400);
  const cheatLimit = Number(b.cheat_limit ?? 3);
  if (!Number.isInteger(cheatLimit) || cheatLimit < 1 || cheatLimit > 50)
    return c.json(err('Cheat limit harus antara 1–50'), 400);
  if (b.cheat_action && !['lock', 'auto_submit'].includes(b.cheat_action))
    return c.json(err('Cheat action tidak valid'), 400);
  if (b.active_status && !['draft', 'active', 'finished'].includes(b.active_status))
    return c.json(err('Status tidak valid'), 400);

  await c.env.DB.prepare(
    `UPDATE cbt_exams SET title=?, description=?, duration_minutes=?, rules_text=?,
     completion_message=?, is_score_visible=?, randomize_questions=?, randomize_options=?,
     active_status=?, passing_score=?, target_jalur=?,
     cheat_limit=?, cheat_action=?, enforce_fullscreen=?, updated_at=? WHERE id=?`
  ).bind(b.title.trim(), b.description, duration, b.rules_text, b.completion_message,
    b.is_score_visible ? 1 : 0, b.randomize_questions ? 1 : 0, b.randomize_options ? 1 : 0,
    b.active_status, b.passing_score || 0, b.target_jalur || null,
    cheatLimit, b.cheat_action || 'lock', b.enforce_fullscreen ? 1 : 0,
    now(), c.req.param('id')
  ).run();
  return c.json(ok(null, 'Ujian diperbarui'));
});

admin.delete('/exams/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_exams WHERE id=?').bind(c.req.param('id')).run();
  return c.json(ok(null, 'Ujian dihapus'));
});

// ══════════════════════════════════════════════════════════════
// QUESTIONS
// ══════════════════════════════════════════════════════════════

admin.get('/exams/:examId/questions', async (c) => {
  const examId = c.req.param('examId');
  const { results: questions } = await c.env.DB.prepare(
    'SELECT * FROM cbt_questions WHERE exam_id=? ORDER BY question_order'
  ).bind(examId).all();
  const qIds = questions.map((q: any) => q.id);
  if (qIds.length === 0) return c.json(ok([]));
  const ph = qIds.map(() => '?').join(',');
  const { results: options } = await c.env.DB.prepare(
    `SELECT * FROM cbt_question_options WHERE question_id IN (${ph}) ORDER BY option_order`
  ).bind(...qIds).all();
  const optMap: Record<string, any[]> = {};
  for (const o of options as any[]) { if (!optMap[o.question_id]) optMap[o.question_id] = []; optMap[o.question_id].push(o); }
  return c.json(ok(questions.map((q: any) => ({ ...q, options: optMap[q.id] || [] }))));
});

admin.post('/exams/:examId/questions', async (c) => {
  const examId = c.req.param('examId');
  const { question_text, question_type, question_order, image_url, audio_url, points, options } = await c.req.json();
  const qId = newId();
  await c.env.DB.prepare(
    `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points) VALUES (?,?,?,?,?,?,?,?)`
  ).bind(qId, examId, question_text, question_type || 'multiple_choice', question_order || 0, image_url || null, audio_url || null, points || 1).run();
  if (options?.length) {
    const stmts = options.map((o: any, i: number) =>
      c.env.DB.prepare('INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)')
        .bind(newId(), qId, o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
    );
    await c.env.DB.batch(stmts);
  }
  return c.json(ok({ id: qId }, 'Soal ditambahkan'), 201);
});

admin.post('/exams/:examId/questions/bulk', async (c) => {
  const examId = c.req.param('examId');
  const { questions } = await c.req.json<{ questions: any[] }>();
  if (!questions?.length) return c.json(err('Data soal kosong'), 400);

  // ── P2: Batch semua insert dalam satu batch call (jauh lebih efisien) ──
  const allStmts: D1PreparedStatement[] = [];
  for (const q of questions) {
    const qId = newId();
    allStmts.push(c.env.DB.prepare(
      `INSERT INTO cbt_questions (id, exam_id, question_text, question_type, question_order, image_url, audio_url, points) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(qId, examId, q.question_text, q.question_type || 'multiple_choice', q.question_order || 0, q.image_url || null, q.audio_url || null, q.points || 1));
    if (q.options?.length) {
      for (let i = 0; i < q.options.length; i++) {
        const o = q.options[i];
        allStmts.push(c.env.DB.prepare(
          'INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)'
        ).bind(newId(), qId, o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i));
      }
    }
  }
  // Batch max 100 statements per call
  for (let i = 0; i < allStmts.length; i += 100) { await c.env.DB.batch(allStmts.slice(i, i + 100)); }
  return c.json(ok({ imported: questions.length }, 'Soal berhasil diimport'));
});

admin.put('/questions/:id', async (c) => {
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE cbt_questions SET question_text=?, question_type=?, question_order=?, image_url=?, audio_url=?, points=? WHERE id=?`
  ).bind(b.question_text, b.question_type, b.question_order, b.image_url || null, b.audio_url || null, b.points || 1, c.req.param('id')).run();
  if (b.options) {
    await c.env.DB.prepare('DELETE FROM cbt_question_options WHERE question_id=?').bind(c.req.param('id')).run();
    const stmts = b.options.map((o: any, i: number) =>
      c.env.DB.prepare('INSERT INTO cbt_question_options (id, question_id, option_label, option_text, image_url, is_correct, option_order) VALUES (?,?,?,?,?,?,?)')
        .bind(newId(), c.req.param('id'), o.option_label, o.option_text, o.image_url || null, o.is_correct ? 1 : 0, i)
    );
    await c.env.DB.batch(stmts);
  }
  return c.json(ok(null, 'Soal diperbarui'));
});

admin.delete('/questions/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_questions WHERE id=?').bind(c.req.param('id')).run();
  return c.json(ok(null, 'Soal dihapus'));
});

// ══════════════════════════════════════════════════════════════
// EXAM TOKENS
// ══════════════════════════════════════════════════════════════

admin.get('/exams/:examId/tokens', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT et.*, r.room_name FROM cbt_exam_tokens et JOIN cbt_rooms r ON r.id = et.room_id WHERE et.exam_id=? ORDER BY r.room_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

admin.post('/exams/:examId/tokens/generate', async (c) => {
  const examId = c.req.param('examId');
  const { room_ids } = await c.req.json<{ room_ids?: string[] }>();
  const targetRooms = room_ids?.length
    ? room_ids
    : (await c.env.DB.prepare('SELECT id FROM cbt_rooms').all()).results.map((r: any) => r.id);
  const stmts = targetRooms.map((rid: string) =>
    c.env.DB.prepare('INSERT OR REPLACE INTO cbt_exam_tokens (id, exam_id, room_id, token_code, is_active) VALUES (?,?,?,?,1)')
      .bind(newId(), examId, rid, generateToken())
  );
  for (let i = 0; i < stmts.length; i += 100) { await c.env.DB.batch(stmts.slice(i, i + 100)); }
  return c.json(ok({ generated: targetRooms.length }, 'Token berhasil digenerate'));
});

// ══════════════════════════════════════════════════════════════
// R2 UPLOAD
// ══════════════════════════════════════════════════════════════

admin.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as unknown as File;
  if (!file || typeof file === 'string') return c.json(err('File tidak ditemukan'), 400);

  const type = file.type || '';
  const isImage = type.startsWith('image/');
  const isAudio = type.startsWith('audio/');
  if (!isImage && !isAudio) return c.json(err('Tipe file tidak diizinkan'), 400);

  const maxSize = isImage ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
  if (file.size > maxSize) {
    return c.json(err(isImage ? 'Ukuran gambar maksimal 5MB' : 'Ukuran audio maksimal 20MB'), 400);
  }

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const allowedExt = isImage
    ? ['jpg', 'jpeg', 'png', 'gif', 'webp']
    : ['mp3', 'wav', 'ogg', 'm4a', 'aac'];
  if (!allowedExt.includes(ext)) return c.json(err('Ekstensi file tidak diizinkan'), 400);

  const key = `media/${Date.now()}-${newId().replace(/-/g, '')}.${ext}`;
  await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return c.json(ok({ key, url: `/r2/${key}` }, 'Upload berhasil'));
});

// ══════════════════════════════════════════════════════════════
// RESULTS & MONITORING
// ══════════════════════════════════════════════════════════════

admin.get('/exams/:examId/results', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT er.*,
       COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
       COALESCE(p.nisn, cu.nisn) as nisn,
       COALESCE(p.nisn, cu.username) as username,
       r.room_name
     FROM cbt_exam_results er
     JOIN cbt_exam_sessions es ON es.id = er.session_id
     JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN pendaftar p ON er.user_id = p.id AND er.user_type = 'pendaftar'
     LEFT JOIN cbt_users cu ON er.user_id = cu.id AND er.user_type = 'cbt_user'
     WHERE er.exam_id = ?
     ORDER BY r.room_name, full_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

admin.get('/exams/:examId/sessions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT es.*,
       COALESCE(p.nama_lengkap, cu.nama_lengkap) as full_name,
       COALESCE(p.nisn, cu.nisn) as nisn,
       COALESCE(p.nisn, cu.username) as username,
       r.room_name
     FROM cbt_exam_sessions es
     JOIN cbt_rooms r ON r.id = es.room_id
     LEFT JOIN pendaftar p ON es.user_id = p.id AND es.user_type = 'pendaftar'
     LEFT JOIN cbt_users cu ON es.user_id = cu.id AND es.user_type = 'cbt_user'
     WHERE es.exam_id = ?
     ORDER BY r.room_name, full_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

// Update jalur peserta pendaftar
admin.put('/pendaftar/:id/jalur', async (c) => {
  const { jalur } = await c.req.json<{ jalur: string }>();
  await c.env.DB.prepare('UPDATE pendaftar SET jalur = ? WHERE id = ?').bind(jalur, c.req.param('id')).run();
  return c.json(ok(null, 'Jalur berhasil diperbarui'));
});

// ══════════════════════════════════════════════════════════════
// SETTINGS — key-value config
// ══════════════════════════════════════════════════════════════

admin.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM cbt_settings').all();
  const map: Record<string, string> = {};
  for (const r of results as any[]) map[r.key] = r.value;
  return c.json(ok(map));
});

admin.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const stmts = Object.entries(body).map(([key, value]) =>
    c.env.DB.prepare('INSERT OR REPLACE INTO cbt_settings (key, value, updated_at) VALUES (?,?,?)').bind(key, value, now())
  );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json(ok(null, 'Pengaturan disimpan'));
});

// ══════════════════════════════════════════════════════════════
// EXAM ASSIGNMENTS — assign ujian ke peserta, ruangan, atau sesi
// ══════════════════════════════════════════════════════════════

admin.get('/exams/:examId/assignments', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ea.*,
       CASE
         WHEN ea.user_type IN ('room','sesi') THEN ea.user_id
         ELSE COALESCE(p.nama_lengkap, cu.nama_lengkap)
       END as full_name,
       CASE
         WHEN ea.user_type IN ('room','sesi') THEN NULL
         ELSE COALESCE(p.nisn, cu.nisn, cu.username)
       END as nisn
     FROM cbt_exam_assignments ea
     LEFT JOIN pendaftar p ON ea.user_id = p.id AND ea.user_type = 'pendaftar'
     LEFT JOIN cbt_users cu ON ea.user_id = cu.id AND ea.user_type = 'cbt_user'
     WHERE ea.exam_id = ? ORDER BY ea.user_type, full_name`
  ).bind(c.req.param('examId')).all();
  return c.json(ok(results));
});

// Assign ke peserta individu
admin.post('/exams/:examId/assignments', async (c) => {
  const { users } = await c.req.json<{ users: { user_id: string; user_type: string }[] }>();
  const examId = c.req.param('examId');
  if (!users?.length) return c.json(err('Pilih minimal 1 peserta'), 400);
  const stmts = users.map(u =>
    c.env.DB.prepare('INSERT OR IGNORE INTO cbt_exam_assignments (id, exam_id, user_id, user_type) VALUES (?,?,?,?)')
      .bind(newId(), examId, u.user_id, u.user_type)
  );
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return c.json(ok({ added: users.length }, 'Peserta di-assign'));
});

// Assign ke semua peserta dalam ruangan tertentu
admin.post('/exams/:examId/assignments/room', async (c) => {
  const examId = c.req.param('examId');
  const { rooms } = await c.req.json<{ rooms: string[] }>();
  if (!rooms?.length) return c.json(err('Pilih minimal 1 ruangan'), 400);
  const stmts = rooms.map(roomName =>
    c.env.DB.prepare('INSERT OR IGNORE INTO cbt_exam_assignments (id, exam_id, user_id, user_type) VALUES (?,?,?,?)')
      .bind(newId(), examId, roomName, 'room')
  );
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return c.json(ok({ added: rooms.length }, `${rooms.length} ruangan di-assign`));
});

// Assign ke semua peserta dalam sesi tertentu
admin.post('/exams/:examId/assignments/sesi', async (c) => {
  const examId = c.req.param('examId');
  const { sessions } = await c.req.json<{ sessions: string[] }>();
  if (!sessions?.length) return c.json(err('Pilih minimal 1 sesi'), 400);
  const stmts = sessions.map(sesi =>
    c.env.DB.prepare('INSERT OR IGNORE INTO cbt_exam_assignments (id, exam_id, user_id, user_type) VALUES (?,?,?,?)')
      .bind(newId(), examId, sesi, 'sesi')
  );
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return c.json(ok({ added: sessions.length }, `${sessions.length} sesi di-assign`));
});

// Assign ke kelompok tes berdasarkan kombinasi tanggal × sesi
// user_id disimpan sebagai "{tanggal_tes}|{sesi_tes}" — dievaluasi saat peserta login
admin.post('/exams/:examId/assignments/group', async (c) => {
  const examId = c.req.param('examId');
  const { groups } = await c.req.json<{ groups: { tanggal_tes: string; sesi_tes: string }[] }>();
  if (!groups?.length) return c.json(err('Pilih minimal 1 kelompok'), 400);
  const stmts = groups.map(g =>
    c.env.DB.prepare('INSERT OR IGNORE INTO cbt_exam_assignments (id, exam_id, user_id, user_type) VALUES (?,?,?,?)')
      .bind(newId(), examId, `${g.tanggal_tes}|${g.sesi_tes}`, 'tanggal_sesi')
  );
  for (let i = 0; i < stmts.length; i += 100) await c.env.DB.batch(stmts.slice(i, i + 100));
  return c.json(ok({ added: groups.length }, `${groups.length} kelompok tes di-assign`));
});

admin.delete('/exams/:examId/assignments/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM cbt_exam_assignments WHERE id=? AND exam_id=?')
    .bind(c.req.param('id'), c.req.param('examId')).run();
  return c.json(ok(null, 'Assignment dihapus'));
});

export default admin;