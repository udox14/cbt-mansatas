// ============================================================
// Auth: 3-Source Login
//   1. admins (PMB existing) → role admin
//   2. cbt_users → role proctor / student non-PMB
//   3. pendaftar (PMB existing) → role student, login pakai NISN
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types';
import { signJWT } from '../utils/jwt';
import { verifyPassword, ok, err } from '../utils/helpers';
import { authMiddleware } from '../middleware/auth';

const auth = new Hono<{ Bindings: Env }>();

auth.post('/login', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  // #region agent log
  fetch('http://127.0.0.1:7906/ingest/9b78c9e9-cb35-4229-9d79-ce7a9a0c95ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cc151f'},body:JSON.stringify({sessionId:'cc151f',runId:'pre-fix',hypothesisId:'H2',location:'apps/worker/src/routes/auth.ts:18',message:'Login request received',data:{usernameLength:username?.length||0,origin:c.req.header('origin')||null,host:c.req.header('host')||null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (!username || !password) return c.json(err('Username dan password wajib diisi'), 400);

  const uname = username.trim();
  const pwd = password.trim();

  // ── 1. Cek tabel admins (PMB existing) ─────────────────
  const admin = await c.env.DB.prepare(
    'SELECT id, username, password, nama_lengkap FROM admins WHERE username = ?'
  ).bind(uname).first<any>();
  // #region agent log
  fetch('http://127.0.0.1:7906/ingest/9b78c9e9-cb35-4229-9d79-ce7a9a0c95ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cc151f'},body:JSON.stringify({sessionId:'cc151f',runId:'pre-fix',hypothesisId:'H3',location:'apps/worker/src/routes/auth.ts:29',message:'Admin lookup result',data:{username:uname,found:!!admin},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (admin) {
    // Password admins PMB: cek format PBKDF2 (ada ':') atau plain text
    let valid = false;
    if (admin.password.includes(':')) {
      valid = await verifyPassword(pwd, admin.password);
    } else {
      valid = admin.password === pwd; // plain text dari PMB
    }
    if (!valid) return c.json(err('Username atau password salah'), 401);

    const token = await signJWT({
      sub: admin.id, username: admin.username, role: 'admin',
      room_id: null, full_name: admin.nama_lengkap || 'Admin',
      source: 'admins',
    }, c.env.JWT_SECRET);

    return c.json(ok({
      token,
      user: { id: admin.id, username: admin.username, full_name: admin.nama_lengkap, role: 'admin', room_id: null, source: 'admins' },
    }, 'Login berhasil'));
  }

  // ── 2. Cek tabel cbt_users (proktor / student non-PMB) ──
  const cbtUser = await c.env.DB.prepare(
    'SELECT * FROM cbt_users WHERE username = ? AND is_active = 1'
  ).bind(uname).first<any>();
  // #region agent log
  fetch('http://127.0.0.1:7906/ingest/9b78c9e9-cb35-4229-9d79-ce7a9a0c95ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cc151f'},body:JSON.stringify({sessionId:'cc151f',runId:'pre-fix',hypothesisId:'H3',location:'apps/worker/src/routes/auth.ts:58',message:'CBT user lookup result',data:{username:uname,found:!!cbtUser},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (cbtUser) {
    // Support both PBKDF2 (ada ':') dan plain text (lama)
    let valid = false;
    if (cbtUser.password_hash?.includes(':')) {
      valid = await verifyPassword(pwd, cbtUser.password_hash);
    } else {
      valid = cbtUser.password_hash === pwd;
    }
    if (!valid) return c.json(err('Username atau password salah'), 401);

    const token = await signJWT({
      sub: cbtUser.id, username: cbtUser.username, role: cbtUser.role,
      room_id: cbtUser.room_id, full_name: cbtUser.nama_lengkap,
      source: 'cbt_user',
    }, c.env.JWT_SECRET);

    return c.json(ok({
      token,
      user: { id: cbtUser.id, username: cbtUser.username, full_name: cbtUser.nama_lengkap, role: cbtUser.role, room_id: cbtUser.room_id, source: 'cbt_user' },
    }, 'Login berhasil'));
  }

  // ── 3. Cek tabel pendaftar (PMB existing, login pakai NISN + tanggal lahir) ──
  const pendaftar = await c.env.DB.prepare(
    'SELECT id, nisn, nama_lengkap, tanggal_lahir, ruang_tes, no_pendaftaran, jalur FROM pendaftar WHERE nisn = ?'
  ).bind(uname).first<any>();
  // #region agent log
  fetch('http://127.0.0.1:7906/ingest/9b78c9e9-cb35-4229-9d79-ce7a9a0c95ac',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cc151f'},body:JSON.stringify({sessionId:'cc151f',runId:'pre-fix',hypothesisId:'H3',location:'apps/worker/src/routes/auth.ts:85',message:'Pendaftar lookup result',data:{username:uname,found:!!pendaftar},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (pendaftar) {
    // Jalur Prestasi tidak mengikuti CBT — tolak login
    if (pendaftar.jalur && pendaftar.jalur.toUpperCase().includes('PRESTASI')) {
      return c.json(err('Jalur Prestasi tidak mengikuti Computer Based Test (CBT). Hubungi panitia jika ada pertanyaan.'), 403);
    }

    // Password = tanggal lahir format DDMMYYYY (misal: 22122002)
    // tanggal_lahir di DB bisa format: "2002-12-22", "22-12-2002", "22/12/2002", dll
    const tgl = pendaftar.tanggal_lahir || '';
    let expectedPwd = '';

    if (tgl.match(/^\d{4}-\d{2}-\d{2}/)) {
      // Format ISO: 2002-12-22 → 22122002
      const [y, m, d] = tgl.split(/[-T]/);
      expectedPwd = `${d}${m}${y}`;
    } else if (tgl.match(/^\d{2}[-/]\d{2}[-/]\d{4}/)) {
      // Format DD-MM-YYYY atau DD/MM/YYYY → 22122002
      expectedPwd = tgl.replace(/[-/]/g, '');
    } else {
      // Fallback: coba pakai apa adanya (tanpa separator)
      expectedPwd = tgl.replace(/[-/\s]/g, '');
    }

    if (!expectedPwd || pwd !== expectedPwd) {
      return c.json(err('Username atau password salah'), 401);
    }

    // Map ruang_tes dari pendaftar ke cbt_rooms jika ada
    let roomId: string | null = null;
    if (pendaftar.ruang_tes) {
      const room = await c.env.DB.prepare(
        'SELECT id FROM cbt_rooms WHERE room_name = ?'
      ).bind(pendaftar.ruang_tes).first<any>();
      if (room) roomId = room.id;
    }

    const token = await signJWT({
      sub: pendaftar.id, username: pendaftar.nisn, role: 'student',
      room_id: roomId, full_name: pendaftar.nama_lengkap,
      source: 'pendaftar',
    }, c.env.JWT_SECRET);

    return c.json(ok({
      token,
      user: { id: pendaftar.id, username: pendaftar.nisn, full_name: pendaftar.nama_lengkap, role: 'student', room_id: roomId, source: 'pendaftar', no_pendaftaran: pendaftar.no_pendaftaran },
    }, 'Login berhasil'));
  }

  return c.json(err('Username atau password salah'), 401);
});

auth.get('/me', authMiddleware, (c) => {
  return c.json(ok(c.get('user')));
});

export default auth;
