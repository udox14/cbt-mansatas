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
import { checkRateLimit, resetRateLimit } from '../utils/ratelimit';

const auth = new Hono<{ Bindings: Env }>();

auth.post('/login', async (c) => {
  let body: { username?: string; password?: string };
  try {
    body = await c.req.json<{ username: string; password: string }>();
  } catch {
    return c.json(err('Request body tidak valid'), 400);
  }

  const { username, password } = body;
  if (!username || !password) return c.json(err('Username dan password wajib diisi'), 400);

  const uname = username.trim().slice(0, 100);
  const pwd   = password.trim().slice(0, 200);

  if (!uname || !pwd) return c.json(err('Username dan password tidak boleh kosong'), 400);

  // ── Rate Limiting ─────────────────────────────────────────
  // Batasi per IP (5 percobaan / 60 detik)
  // dan per username (10 percobaan / 5 menit)
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const [ipLimit, userLimit] = await Promise.all([
    checkRateLimit(c.env.RATE_LIMIT, `login:ip:${ip}`, 5, 60),
    checkRateLimit(c.env.RATE_LIMIT, `login:user:${uname}`, 10, 300),
  ]);

  if (!ipLimit.allowed) {
    return c.json(err('Terlalu banyak percobaan login. Coba lagi dalam 1 menit.'), 429);
  }
  if (!userLimit.allowed) {
    return c.json(err('Terlalu banyak percobaan login untuk akun ini. Coba lagi dalam 5 menit.'), 429);
  }

  // ── 1. Cek tabel admins (PMB existing) ─────────────────
  const admin = await c.env.DB.prepare(
    'SELECT id, username, password, nama_lengkap FROM admins WHERE username = ?'
  ).bind(uname).first<any>();

  if (admin) {
    let valid = false;
    if (admin.password && admin.password.includes(':')) {
      // PBKDF2 hash (format baru)
      valid = await verifyPassword(pwd, admin.password);
    } else {
      // Plain text (format lama dari PMB) — masih didukung tapi deprecated
      valid = admin.password === pwd;
    }
    if (!valid) return c.json(err('Username atau password salah'), 401);

    // Reset rate limit counter setelah berhasil login
    await resetRateLimit(c.env.RATE_LIMIT, `login:ip:${ip}`);
    await resetRateLimit(c.env.RATE_LIMIT, `login:user:${uname}`);

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

  if (cbtUser) {
    let valid = false;
    if (cbtUser.password_hash?.includes(':')) {
      valid = await verifyPassword(pwd, cbtUser.password_hash);
    } else {
      // Plain text lama — masih didukung tapi deprecated
      valid = cbtUser.password_hash === pwd;
    }
    if (!valid) return c.json(err('Username atau password salah'), 401);

    await resetRateLimit(c.env.RATE_LIMIT, `login:ip:${ip}`);
    await resetRateLimit(c.env.RATE_LIMIT, `login:user:${uname}`);

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

  if (pendaftar) {
    // Jalur Prestasi tidak mengikuti CBT — tolak login
    if (pendaftar.jalur && pendaftar.jalur.toUpperCase().includes('PRESTASI')) {
      return c.json(err('Username atau password salah'), 401);
      // Catatan: Tidak mengungkapkan alasan spesifik agar tidak enumerate akun
    }

    // Password = tanggal lahir format DDMMYYYY (misal: 22122002)
    const tgl = pendaftar.tanggal_lahir || '';
    let expectedPwd = '';

    if (tgl.match(/^\d{4}-\d{2}-\d{2}/)) {
      const [y, m, d] = tgl.split(/[-T]/);
      expectedPwd = `${d}${m}${y}`;
    } else if (tgl.match(/^\d{2}[-/]\d{2}[-/]\d{4}/)) {
      expectedPwd = tgl.replace(/[-/]/g, '');
    } else {
      expectedPwd = tgl.replace(/[-/\s]/g, '');
    }

    if (!expectedPwd || pwd !== expectedPwd) {
      return c.json(err('Username atau password salah'), 401);
    }

    await resetRateLimit(c.env.RATE_LIMIT, `login:ip:${ip}`);
    await resetRateLimit(c.env.RATE_LIMIT, `login:user:${uname}`);

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
