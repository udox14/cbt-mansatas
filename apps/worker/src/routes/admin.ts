import { Hono } from 'hono';
import type { Env } from '../types.ts';
import { authMiddleware, requireRole } from '../middleware/auth.ts';
import { hashPassword, newId, ok, err, now } from '../utils/helpers.ts';

// Shared Examination Engine Sub-Routes
import { authoringRoutes } from './exam-engine/authoring.ts';
import { runtimeAdminRoutes } from './exam-engine/runtime-admin.ts';
import { monitoringRoutes } from './exam-engine/monitoring.ts';
import { resultsRoutes } from './exam-engine/results.ts';
import { roomsRoutes } from './exam-engine/rooms.ts';


const admin = new Hono<{ Bindings: Env }>();
admin.use('*', authMiddleware, requireRole('admin'));

// ── Mount Sub-Routers ─────────────────────────────────────────
admin.route('/', authoringRoutes);
admin.route('/', runtimeAdminRoutes);
admin.route('/', monitoringRoutes);
admin.route('/', resultsRoutes);
admin.route('/', roomsRoutes);

// ══════════════════════════════════════════════════════════════
// USERS & GTK MANAGEMENT
// ══════════════════════════════════════════════════════════════

admin.get('/users', async (c) => {
  const role = c.req.query('role');
  const room_id = c.req.query('room_id');

  if (role === 'admin') {
    const { results } = await c.env.DB.prepare(
      `SELECT id, username, nama_lengkap as full_name, 'admin' as role, NULL as room_id, NULL as nisn, 1 as is_active FROM admins ORDER BY nama_lengkap`
    ).all();
    return c.json(ok(results));
  }

  let sql = `SELECT id, username, nama_lengkap as full_name, role, room_id, nisn, is_active, 'cbt_user' as source FROM cbt_users`;
  const conditions: string[] = [];
  const params: any[] = [];
  if (role) { conditions.push('role = ?'); params.push(role); }
  if (room_id) { conditions.push('room_id = ?'); params.push(room_id); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY nama_lengkap';
  const { results } = await c.env.DB.prepare(sql).bind(...params).all();

  if (!role) {
    const { results: admins } = await c.env.DB.prepare(
      `SELECT id, username, nama_lengkap as full_name, 'admin' as role, NULL as room_id, NULL as nisn, 1 as is_active FROM admins ORDER BY nama_lengkap`
    ).all();
    return c.json(ok([...(results || []), ...(admins || [])]));
  }

  return c.json(ok(results));
});

admin.get('/gtk-users', async (c) => {
  if (!c.env.MANSATAS_DB) {
    return c.json(ok([]));
  }
  try {
    const existingUsers = await c.env.DB.prepare(
      `SELECT username FROM cbt_users UNION SELECT username FROM admins`
    ).all();
    const existingSet = new Set((existingUsers.results || []).map((x: any) => String(x.username || '').toLowerCase()));

    let rows: any[] = [];
    try {
      const { results } = await c.env.MANSATAS_DB.prepare(`SELECT * FROM "user"`).all();
      rows = results || [];
    } catch (e) {
      const { results } = await c.env.MANSATAS_DB.prepare(`SELECT * FROM users`).all();
      rows = results || [];
    }

    const formatted = rows.map(u => {
      const email = String(u.email || u.username || '').trim();
      const name = String(u.nama || u.nama_lengkap || u.name || u.full_name || email).trim();
      return {
        id: u.id || email,
        email: email,
        nama_lengkap: name,
        password: u.password || u.password_hash || null,
        already_imported: existingSet.has(email.toLowerCase()),
      };
    }).filter(u => u.email && u.email.includes('@'));

    return c.json(ok(formatted));
  } catch (e: any) {
    console.error('Error fetching GTK from MANSATAS_DB:', e);
    return c.json(err(e?.message || 'Gagal mengambil data GTK dari MANSATAS App'), 500);
  }
});

admin.post('/gtk-users/import', async (c) => {
  const body = await c.req.json<{ users?: Array<{ email: string; name: string; role: 'proctor' | 'admin'; password?: string }> }>();
  const users = body?.users || [];
  if (!Array.isArray(users) || users.length === 0) {
    return c.json(err('Pilih minimal 1 GTK untuk di-import'), 400);
  }

  let imported = 0;
  for (const u of users) {
    const email = String(u.email || '').trim().toLowerCase();
    const name = String(u.name || u.email || '').trim();
    const role = u.role === 'admin' ? 'admin' : 'proctor';

    if (!email) continue;

    // 1. Upsert into cbt_staff_profiles
    let profile = await c.env.DB.prepare('SELECT id FROM cbt_staff_profiles WHERE LOWER(email) = LOWER(?)').bind(email).first<any>();
    let profileId = profile?.id;
    if (!profileId) {
      profileId = newId();
      await c.env.DB.prepare(
        'INSERT INTO cbt_staff_profiles (id, mansatas_user_id, email, nama_lengkap, is_active, synced_at) VALUES (?,?,?,?,1,?)'
      ).bind(profileId, profileId, email, name, now()).run();
    }

    // 2. Upsert role assignment
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO cbt_role_assignments (id, staff_id, role, created_at) VALUES (?,?,?,?)'
    ).bind(newId(), profileId, role, now()).run();

    // 3. Optional legacy record creation only if explicit password was provided (NO default password)
    if (u.password) {
      const pwdHash = await hashPassword(u.password);
      if (role === 'admin') {
        const exists = await c.env.DB.prepare('SELECT id FROM admins WHERE LOWER(username) = LOWER(?)').bind(email).first();
        if (!exists) {
          await c.env.DB.prepare(
            'INSERT INTO admins (id, username, password, nama_lengkap) VALUES (?,?,?,?)'
          ).bind(newId(), email, pwdHash, name).run();
        }
      } else {
        const exists = await c.env.DB.prepare('SELECT id FROM cbt_users WHERE LOWER(username) = LOWER(?)').bind(email).first();
        if (!exists) {
          await c.env.DB.prepare(
            'INSERT INTO cbt_users (id, username, password_hash, nama_lengkap, role, is_active) VALUES (?,?,?,?,?,1)'
          ).bind(newId(), email, pwdHash, name, 'proctor').run();
        }
      }
    }

    imported++;
  }

  return c.json(ok({ imported }, `${imported} akun GTK berhasil di-import`));
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
    const hash = await hashPassword(password);
    if (role === 'admin') {
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
// DUMMY TESTING USER MANAGEMENT
// ══════════════════════════════════════════════════════════════

admin.post('/dummy-user/setup', async (c) => {
  const body = (await c.req.json<any>().catch(() => ({}))) || {};
  const username = String(body.username || 'percobaan').trim().toLowerCase();
  const password = String(body.password || 'percobaan1234').trim();
  const fullName = String(body.full_name || 'EL PERCOBAAN').trim();

  const pwdHash = await hashPassword(password);
  const existing = await c.env.DB.prepare('SELECT id FROM cbt_users WHERE LOWER(username) = LOWER(?)').bind(username).first<any>();

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE cbt_users SET password_hash=?, nama_lengkap=?, is_active=1, updated_at=? WHERE id=?'
    ).bind(pwdHash, fullName, now(), existing.id).run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO cbt_users (id, username, password_hash, nama_lengkap, role, is_active) VALUES (?,?,?,?,?,1)'
    ).bind(newId(), username, pwdHash, fullName, 'student').run();
  }

  return c.json(ok({ username, password, full_name: fullName }, `Akun percobaan "${username}" berhasil disiapkan`));
});

admin.post('/dummy-user/reset-all', async (c) => {
  const dummyUsers = await c.env.DB.prepare("SELECT id FROM cbt_users WHERE LOWER(username) LIKE 'percobaan%' OR LOWER(username) LIKE 'dummy%'").all();
  const ids = (dummyUsers.results || []).map((u: any) => u.id);
  if (!ids.length) return c.json(ok({ reset: 0 }, 'Tidak ada akun dummy'));

  for (const id of ids) {
    const sessions = await c.env.DB.prepare("SELECT id FROM cbt_exam_sessions WHERE user_id = ?").bind(id).all();
    for (const s of (sessions.results || [])) {
      await c.env.DB.prepare('DELETE FROM cbt_student_answers WHERE session_id = ?').bind(s.id).run();
      await c.env.DB.prepare('DELETE FROM cbt_exam_results WHERE session_id = ?').bind(s.id).run();
      await c.env.DB.prepare('DELETE FROM cbt_cheat_logs WHERE session_id = ?').bind(s.id).run();
    }
    await c.env.DB.prepare('DELETE FROM cbt_exam_sessions WHERE user_id = ?').bind(id).run();
  }

  return c.json(ok(null, 'Seluruh data percobaan akun dummy berhasil dibersihkan'));
});

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════

admin.get('/settings', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM cbt_settings').all();
  const map: Record<string, string> = {};
  for (const r of (results as any[]) || []) map[r.key] = r.value;
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

export default admin;
