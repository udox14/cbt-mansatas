// ============================================================
// Auth: Multi-Source Login
//   1. admins (PMB existing) → role admin
//   2. cbt_users → role proctor / student non-PMB
//   3. pendaftar (PMB existing) → role student, login pakai NISN
// ============================================================

import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { signJWT } from '../utils/jwt.ts';
import { verifyPassword, newId, ok, err } from '../utils/helpers.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { checkRateLimit, resetRateLimit } from '../utils/ratelimit.ts';
import { findMansatasByCredentials } from '../services/participants.ts';
import { MansatasStaffAuthAdapter } from '../services/platform/auth-mansatas.ts';
import { syncStaffProfile } from '../services/platform/permissions.ts';

const auth = new Hono<{ Bindings: Env }>();
const STAFF_SESSION_HOURS = 24 * 90; // 3 bulan untuk admin/proktor

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
  // Staff password must NOT be trimmed (PBKDF2 Web Crypto standard)
  const rawPassword = password.slice(0, 200);
  // Student & legacy passwords preserve .trim() for backward compatibility
  const legacyPassword = password.trim().slice(0, 200);

  if (!uname || !rawPassword) return c.json(err('Username dan password tidak boleh kosong'), 400);

  // ── Rate Limiting ─────────────────────────────────────────
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

  // ── Multi-Source Preflight Collision Check ─────────────────
  let preflightMansatasParticipant: Awaited<ReturnType<typeof findMansatasByCredentials>>['participant'] = null;
  try {
    preflightMansatasParticipant = (await findMansatasByCredentials(c.env, uname, legacyPassword)).participant;
  } catch (e) {
    console.warn('mansatas-db student login adapter check:', e instanceof Error ? e.message : e);
  }

  let preflightMansatasStaffMatch = false;
  if (c.env.MANSATAS_DB) {
    try {
      preflightMansatasStaffMatch = await MansatasStaffAuthAdapter.preflight(c.env.MANSATAS_DB, uname, rawPassword);
    } catch (e) {
      console.warn('MANSATAS_DB staff preflight error:', e instanceof Error ? e.message : e);
    }
  }

  const [preflightAdmin, preflightCbtUser] = await Promise.all([
    c.env.DB.prepare('SELECT id, username, password, nama_lengkap FROM admins WHERE username = ?').bind(uname).first<any>(),
    c.env.DB.prepare('SELECT * FROM cbt_users WHERE username = ? AND is_active = 1').bind(uname).first<any>(),
  ]);

  let credentialMatches = 0;
  if (preflightMansatasParticipant) credentialMatches++;
  if (preflightMansatasStaffMatch) credentialMatches++;

  if (preflightAdmin) {
    const valid = preflightAdmin.password?.includes(':')
      ? await verifyPassword(legacyPassword, preflightAdmin.password)
      : preflightAdmin.password === legacyPassword;
    if (valid) credentialMatches++;
  }
  if (preflightCbtUser) {
    const valid = preflightCbtUser.password_hash?.includes(':')
      ? await verifyPassword(legacyPassword, preflightCbtUser.password_hash)
      : preflightCbtUser.password_hash === legacyPassword;
    if (valid) credentialMatches++;
  }

  if (credentialMatches > 1) {
    return c.json(err('Username atau password cocok di lebih dari satu sumber. Hubungi administrator.'), 401);
  }

  // ── 1. Cek tabel admins (PMB existing) ─────────────────────
  const admin = await c.env.DB.prepare(
    'SELECT id, username, password, nama_lengkap FROM admins WHERE username = ?'
  ).bind(uname).first<any>();

  if (admin) {
    let valid = false;
    if (admin.password && admin.password.includes(':')) {
      valid = await verifyPassword(legacyPassword, admin.password);
    } else {
      valid = admin.password === legacyPassword;
    }
    if (valid) {
      await resetRateLimit(c.env.RATE_LIMIT, `login:ip:${ip}`);
      await resetRateLimit(c.env.RATE_LIMIT, `login:user:${uname}`);

      const allowedModes = ['pmb', 'kegiatan', 'tka', 'semester', 'ulangan'];
      const token = await signJWT({
        sub: admin.id,
        username: admin.username,
        role: 'admin',
        room_id: null,
        full_name: admin.nama_lengkap || 'Admin',
        source: 'admins',
        roles: ['admin'],
        permissions: ['*'],
        allowed_modes: allowedModes,
      }, c.env.JWT_SECRET, STAFF_SESSION_HOURS);

      return c.json(ok({
        token,
        user: {
          id: admin.id,
          username: admin.username,
          full_name: admin.nama_lengkap,
          role: 'admin',
          room_id: null,
          source: 'admins',
          roles: ['admin'],
          permissions: ['*'],
          allowed_modes: allowedModes,
        },
      }, 'Login berhasil'));
    }
  }

  // ── 2. Cek tabel cbt_users (proktor / student non-PMB) ─────
  const cbtUser = await c.env.DB.prepare(
    'SELECT * FROM cbt_users WHERE username = ? AND is_active = 1'
  ).bind(uname).first<any>();

  if (cbtUser) {
    let valid = false;
    if (cbtUser.password_hash?.includes(':')) {
      valid = await verifyPassword(legacyPassword, cbtUser.password_hash);
    } else {
      valid = cbtUser.password_hash === legacyPassword;
    }
    if (valid) {
      await resetRateLimit(c.env.RATE_LIMIT, `login:ip:${ip}`);
      await resetRateLimit(c.env.RATE_LIMIT, `login:user:${uname}`);

      const sessionHours = ['admin', 'proctor'].includes(cbtUser.role)
        ? STAFF_SESSION_HOURS
        : undefined;

      const roles = [cbtUser.role];
      const allowed_modes = cbtUser.role === 'admin'
        ? ['pmb', 'kegiatan', 'tka', 'semester', 'ulangan']
        : cbtUser.role === 'proctor'
        ? ['kegiatan', 'semester']
        : [];

      const token = await signJWT({
        sub: cbtUser.id,
        username: cbtUser.username,
        role: cbtUser.role,
        room_id: cbtUser.room_id,
        full_name: cbtUser.nama_lengkap,
        source: 'cbt_user',
        roles,
        allowed_modes,
      }, c.env.JWT_SECRET, sessionHours);

      return c.json(ok({
        token,
        user: {
          id: cbtUser.id,
          username: cbtUser.username,
          full_name: cbtUser.nama_lengkap,
          role: cbtUser.role,
          room_id: cbtUser.room_id,
          source: 'cbt_user',
          roles,
          allowed_modes,
        },
      }, 'Login berhasil'));
    }
  }

  // ── 2.5 Cek MANSATAS_DB Staff (Authoritative PBKDF2 Web Crypto) ─
  if (c.env.MANSATAS_DB) {
    try {
      const staffIdentity = await MansatasStaffAuthAdapter.authenticate(
        c.env.MANSATAS_DB,
        uname,
        rawPassword
      );

      if (staffIdentity) {
        await resetRateLimit(c.env.RATE_LIMIT, `login:ip:${ip}`);
        await resetRateLimit(c.env.RATE_LIMIT, `login:user:${uname}`);

        // Sync staff identity into CBT DB profile & RBAC tables (no passwords copied!)
        const resolvedAuth = await syncStaffProfile(c.env.DB, staffIdentity);

        let primaryRole: any = 'guru';
        if (resolvedAuth.roles.includes('admin')) {
          primaryRole = 'admin';
        } else if (resolvedAuth.roles.includes('proctor')) {
          primaryRole = 'proctor';
        } else if (resolvedAuth.roles.includes('guru') || resolvedAuth.roles.includes('teacher')) {
          primaryRole = 'guru';
        }

        const permissionsList = resolvedAuth.permissions.map((p) => p.permission);

        const token = await signJWT({
          sub: resolvedAuth.profile.id,
          username: staffIdentity.email,
          role: primaryRole,
          room_id: null,
          full_name: staffIdentity.nama_lengkap,
          source: 'mansatas_gtk',
          staff_id: resolvedAuth.profile.id,
          roles: resolvedAuth.roles,
          permissions: permissionsList,
          allowed_modes: resolvedAuth.allowedModes,
        }, c.env.JWT_SECRET, STAFF_SESSION_HOURS);

        return c.json(ok({
          token,
          user: {
            id: resolvedAuth.profile.id,
            username: staffIdentity.email,
            full_name: staffIdentity.nama_lengkap,
            role: primaryRole,
            room_id: null,
            source: 'mansatas_gtk',
            staff_id: resolvedAuth.profile.id,
            roles: resolvedAuth.roles,
            permissions: permissionsList,
            allowed_modes: resolvedAuth.allowedModes,
          },
        }, 'Login berhasil'));
      }
    } catch (e) {
      console.warn('MANSATAS_DB staff auth check error:', e instanceof Error ? e.message : e);
    }
  }

  // ── 3. Cek Siswa Mansatas (School / PMB Participant via mansatas-db) ──
  if (preflightMansatasParticipant) {
    await resetRateLimit(c.env.RATE_LIMIT, `login:ip:${ip}`);
    await resetRateLimit(c.env.RATE_LIMIT, `login:user:${uname}`);

    const token = await signJWT({
      sub: preflightMansatasParticipant.source_id,
      username: preflightMansatasParticipant.username,
      role: 'student',
      room_id: null,
      full_name: preflightMansatasParticipant.full_name,
      source: 'mansatas',
      roles: ['student'],
      allowed_modes: ['pmb', 'kegiatan', 'tka', 'semester', 'ulangan'],
    }, c.env.JWT_SECRET);

    return c.json(ok({
      token,
      user: {
        id: preflightMansatasParticipant.source_id,
        username: preflightMansatasParticipant.username,
        full_name: preflightMansatasParticipant.full_name,
        role: 'student',
        room_id: null,
        source: 'mansatas',
        nisn: preflightMansatasParticipant.nisn,
        class_name: preflightMansatasParticipant.class_name,
        grade: preflightMansatasParticipant.grade,
        roles: ['student'],
        allowed_modes: ['pmb', 'kegiatan', 'tka', 'semester', 'ulangan'],
      },
    }, 'Login berhasil'));
  }

  return c.json(err('Username atau password salah'), 401);
});

auth.get('/me', authMiddleware, (c) => {
  return c.json(ok(c.get('user')));
});

auth.get('/modes', authMiddleware, (c) => {
  const user = c.get('user');
  const allowed = user.allowed_modes || (user.role === 'admin' ? ['pmb', 'kegiatan', 'tka', 'semester', 'ulangan'] : []);
  return c.json(ok({
    modes: allowed,
    user: {
      id: user.sub,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      roles: user.roles || [user.role],
    },
  }));
});

export default auth;
