// test/auth-integration.test.ts
// End-to-end integration tests for multi-source login, PBKDF2 staff auth,
// PMB regression, collision protection, and mode permissions.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import authRoutes from '../src/routes/auth.ts';
import { hashMansatasPassword } from '../src/services/platform/auth-mansatas.ts';
import { hashPassword } from '../src/utils/helpers.ts';

// In-memory mock databases for testing
function createMockDatabases() {
  const cbtStaffProfiles: any[] = [];
  const cbtRoleAssignments: any[] = [];
  const cbtPermissionGrants: any[] = [];
  const cbtUsers: any[] = [];
  const admins: any[] = [];
  const pendaftarList: any[] = [];
  const mansatasUsers: any[] = [];
  const mansatasStudents: any[] = [];
  const kvStore = new Map<string, string>();

  const cbtDb = {
    cbtStaffProfiles,
    cbtRoleAssignments,
    cbtPermissionGrants,
    cbtUsers,
    admins,
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first<T = any>(): Promise<T | null> {
              const lowerSql = sql.toLowerCase();
              if (lowerSql.includes('from admins')) {
                const username = args[0];
                const found = admins.find(
                  (a) => a.username.toLowerCase() === String(username).toLowerCase()
                );
                return (found as T) || null;
              }
              if (lowerSql.includes('from cbt_users')) {
                const username = args[0];
                const found = cbtUsers.find(
                  (u) => u.username.toLowerCase() === String(username).toLowerCase() && u.is_active === 1
                );
                return (found as T) || null;
              }
              if (lowerSql.includes('from pendaftar') || lowerSql.includes('from pmb_pendaftar')) {
                const nisn = args[0];
                const found = pendaftarList.find((p) => p.nisn === nisn);
                return (found as T) || null;
              }
              if (lowerSql.includes('from cbt_rooms')) {
                return null;
              }
              if (lowerSql.includes('from cbt_staff_profiles')) {
                const idOrEmail = String(args[0] || '').toLowerCase();
                const email = String(args[1] || idOrEmail).toLowerCase();
                const found = cbtStaffProfiles.find(
                  (p) => p.id.toLowerCase() === idOrEmail || p.email.toLowerCase() === email
                );
                return (found as T) || null;
              }
              return null;
            },
            async all<T = any>(): Promise<{ results: T[] }> {
              const lowerSql = sql.toLowerCase();
              if (lowerSql.includes('from cbt_role_assignments')) {
                const staffId = args[0];
                const results = cbtRoleAssignments.filter((r) => r.staff_id === staffId);
                return { results: results as T[] };
              }
              if (lowerSql.includes('from cbt_permission_grants')) {
                const staffId = args[0];
                const results = cbtPermissionGrants.filter((g) => g.staff_id === staffId);
                return { results: results as T[] };
              }
              return { results: [] };
            },
            async run() {
              const lowerSql = sql.toLowerCase();
              if (lowerSql.includes('insert into cbt_staff_profiles')) {
                cbtStaffProfiles.push({
                  id: args[0],
                  mansatas_user_id: args[1],
                  email: args[2],
                  nama_lengkap: args[3],
                  nip: args[4],
                  is_active: args[5],
                  synced_at: args[6],
                });
              } else if (lowerSql.includes('insert or ignore into cbt_role_assignments')) {
                cbtRoleAssignments.push({
                  id: args[0],
                  staff_id: args[1],
                  role: args[2],
                  created_at: args[3],
                });
              } else if (lowerSql.includes('insert or ignore into cbt_permission_grants')) {
                cbtPermissionGrants.push({
                  id: args[0],
                  staff_id: args[1],
                  permission: args[2],
                  scope_type: args[3],
                  scope_value: args[4],
                  created_at: args[5],
                });
              }
              return { success: true };
            },
          };
        },
      };
    },
  };

  const pmbDb = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first<T = any>(): Promise<T | null> {
              const nisn = args[0];
              const found = pendaftarList.find((p) => p.nisn === nisn);
              return (found as T) || null;
            },
          };
        },
      };
    },
  };

  const mansatasDb = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first<T = any>(): Promise<T | null> {
              const lowerSql = sql.toLowerCase();
              if (lowerSql.includes('from "siswa"') || lowerSql.includes('from siswa')) {
                const nisn = String(args[0] || '').trim();
                const found = mansatasStudents.find((s) => String(s.nisn).trim() === nisn);
                if (!found) return null;
                return {
                  source_id: found.id,
                  nisn: found.nisn,
                  full_name: found.nama_lengkap,
                  class_name: found.kelas_id || '',
                  grade: found.tingkat || '',
                  gender: found.jenis_kelamin || '',
                  active_value: found.status || '',
                } as T;
              }
              const email = String(args[0] || '').toLowerCase();
              const found = mansatasUsers.find(
                (u) => u.email.toLowerCase() === email
              );
              return (found as T) || null;
            },
          };
        },
      };
    },
  };

  const kvRateLimit = {
    async get(k: string) {
      return kvStore.get(k) || null;
    },
    async put(k: string, v: string) {
      kvStore.set(k, v);
    },
    async delete(k: string) {
      kvStore.delete(k);
    },
  };

  return {
    cbtDb,
    pmbDb,
    mansatasDb,
    kvRateLimit,
    cbtStaffProfiles,
    cbtRoleAssignments,
    cbtPermissionGrants,
    cbtUsers,
    admins,
    pendaftarList,
    mansatasStudents,
    mansatasUsers,
  };
}

describe('Auth & Mode E2E Integration Suite', () => {
  it('authenticates a Mansatas PMB student and assigns allowed_modes: ["pmb", ...]', async () => {
    const mocks = createMockDatabases();
    mocks.mansatasStudents.push({
      id: 'siswa_pmb_101',
      nisn: '0081234567',
      nama_lengkap: 'Siswa PMB Calon',
      jenis_kelamin: 'L',
      status: 'aktif',
      kelas_id: 'X-1',
      tingkat: '10',
    });

    const app = new Hono<{ Bindings: any }>();
    app.route('/api/auth', authRoutes);

    const env = {
      DB: mocks.cbtDb,
      MANSATAS_DB: mocks.mansatasDb,
      MANSATAS_DB_TABLE: 'siswa',
      MANSATAS_DB_ID_COLUMN: 'id',
      MANSATAS_DB_NISN_COLUMN: 'nisn',
      MANSATAS_DB_NAME_COLUMN: 'nama_lengkap',
      MANSATAS_DB_GENDER_COLUMN: 'jenis_kelamin',
      MANSATAS_DB_ACTIVE_COLUMN: 'status',
      MANSATAS_DB_ACTIVE_VALUE: 'aktif',
      MANSATAS_DB_CLASS_COLUMN: 'kelas_id',
      MANSATAS_DB_GRADE_COLUMN: 'tingkat',
      JWT_SECRET: 'test-secret-phase1a',
      RATE_LIMIT: mocks.kvRateLimit,
    };

    const res = await app.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: '0081234567',
          password: '0081234567',
        }),
      }),
      env
    );

    assert.equal(res.status, 200);
    const body = await res.json<any>();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'student');
    assert.equal(body.data.user.source, 'mansatas');
    assert.ok(body.data.user.allowed_modes.includes('pmb'));
    assert.ok(body.data.token);
  });

  it('strictly rejects inactive Mansatas student from taking PMB exam', async () => {
    const mocks = createMockDatabases();
    mocks.mansatasStudents.push({
      id: 'siswa_pmb_inactive_01',
      nisn: '0087777777',
      nama_lengkap: 'Siswa Nonaktif',
      jenis_kelamin: 'L',
      status: 'nonaktif',
      kelas_id: 'X-2',
      tingkat: '10',
    });

    const app = new Hono<{ Bindings: any }>();
    app.route('/api/auth', authRoutes);

    const env = {
      DB: mocks.cbtDb,
      MANSATAS_DB: mocks.mansatasDb,
      MANSATAS_DB_TABLE: 'siswa',
      MANSATAS_DB_ID_COLUMN: 'id',
      MANSATAS_DB_NISN_COLUMN: 'nisn',
      MANSATAS_DB_NAME_COLUMN: 'nama_lengkap',
      MANSATAS_DB_GENDER_COLUMN: 'jenis_kelamin',
      MANSATAS_DB_ACTIVE_COLUMN: 'status',
      MANSATAS_DB_ACTIVE_VALUE: 'aktif',
      MANSATAS_DB_CLASS_COLUMN: 'kelas_id',
      MANSATAS_DB_GRADE_COLUMN: 'tingkat',
      JWT_SECRET: 'test-secret-phase1a',
      RATE_LIMIT: mocks.kvRateLimit,
    };

    const res = await app.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: '0087777777',
          password: '0087777777',
        }),
      }),
      env
    );

    assert.equal(res.status, 401);
    const body = await res.json<any>();
    assert.equal(body.success, false);
  });

  it('authenticates a legacy admin and assigns all 5 modes', async () => {
    const mocks = createMockDatabases();
    const adminHash = await hashPassword('AdminSangatRahasia2026');
    mocks.admins.push({
      id: 'adm_001',
      username: 'superadmin',
      password: adminHash,
      nama_lengkap: 'Ketua Panitia PMB',
    });

    const app = new Hono<{ Bindings: any }>();
    app.route('/api/auth', authRoutes);

    const env = {
      DB: mocks.cbtDb,
      JWT_SECRET: 'test-secret-phase1a',
      RATE_LIMIT: mocks.kvRateLimit,
    };

    const res = await app.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'superadmin',
          password: 'AdminSangatRahasia2026',
        }),
      }),
      env
    );

    assert.equal(res.status, 200);
    const body = await res.json<any>();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'admin');
    assert.deepEqual(body.data.user.allowed_modes, [
      'pmb',
      'kegiatan',
      'tka',
      'semester',
      'ulangan',
    ]);
  });

  it('authenticates Mansatas staff via PBKDF2 without password trimming and syncs profile', async () => {
    const mocks = createMockDatabases();
    // Untrimmed raw password with deliberate trailing space
    const staffPassword = 'KunciGuruFisika2026!  ';
    const pbkdf2Hash = await hashMansatasPassword(staffPassword);

    mocks.mansatasUsers.push({
      id: 'usr_mansatas_fisika',
      email: 'guru.fisika@man1tasik.sch.id',
      nama_lengkap: 'H. Ahmad Fisika, M.Pd.',
      role: 'guru',
      nip: '198001012005011001',
      banned: 0,
      password_hash: pbkdf2Hash,
    });

    const app = new Hono<{ Bindings: any }>();
    app.route('/api/auth', authRoutes);

    const env = {
      DB: mocks.cbtDb,
      MANSATAS_DB: mocks.mansatasDb,
      JWT_SECRET: 'test-secret-phase1a',
      RATE_LIMIT: mocks.kvRateLimit,
    };

    const res = await app.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'GURU.FISIKA@MAN1TASIK.SCH.ID', // Case-insensitive email
          password: staffPassword, // Untrimmed password
        }),
      }),
      env
    );

    assert.equal(res.status, 200);
    const body = await res.json<any>();
    assert.equal(body.success, true);
    assert.equal(body.data.user.source, 'mansatas_gtk');
    assert.equal(body.data.user.role, 'guru');
    assert.deepEqual(body.data.user.allowed_modes, ['ulangan']);

    // Verify staff profile was synced into CBT tables
    assert.equal(mocks.cbtStaffProfiles.length, 1);
    assert.equal(mocks.cbtStaffProfiles[0].email, 'guru.fisika@man1tasik.sch.id');
    assert.equal(mocks.cbtRoleAssignments.length, 1);
    assert.equal(mocks.cbtRoleAssignments[0].role, 'teacher');

    // CRITICAL: Verify NO password hash was written to cbt_users
    assert.equal(mocks.cbtUsers.length, 0);
  });

  it('strictly rejects fallback password "mansatas2026" when not actual staff password', async () => {
    const mocks = createMockDatabases();
    const actualPassword = 'PasswordPribadiGuru2026';
    const pbkdf2Hash = await hashMansatasPassword(actualPassword);

    mocks.mansatasUsers.push({
      id: 'usr_mansatas_kimia',
      email: 'guru.kimia@man1tasik.sch.id',
      nama_lengkap: 'Dra. Hj. Kimiawati',
      role: 'guru',
      nip: null,
      banned: 0,
      password_hash: pbkdf2Hash,
    });

    const app = new Hono<{ Bindings: any }>();
    app.route('/api/auth', authRoutes);

    const env = {
      DB: mocks.cbtDb,
      MANSATAS_DB: mocks.mansatasDb,
      JWT_SECRET: 'test-secret-phase1a',
      RATE_LIMIT: mocks.kvRateLimit,
    };

    const res = await app.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'guru.kimia@man1tasik.sch.id',
          password: 'mansatas2026', // Old default backdoor
        }),
      }),
      env
    );

    assert.equal(res.status, 401);
    const body = await res.json<any>();
    assert.equal(body.success, false);
  });

  it('rejects login when credential collision occurs across multiple sources', async () => {
    const mocks = createMockDatabases();
    const sharedPassword = 'PasswordTabrakan123';
    const cbtHash = await hashPassword(sharedPassword);
    const mansatasHash = await hashMansatasPassword(sharedPassword);

    // Identical username and password in both admins and Mansatas GTK
    mocks.admins.push({
      id: 'adm_collision',
      username: 'tabrakan@man1tasik.sch.id',
      password: cbtHash,
      nama_lengkap: 'Admin PMB',
    });

    mocks.mansatasUsers.push({
      id: 'usr_collision',
      email: 'tabrakan@man1tasik.sch.id',
      nama_lengkap: 'Guru Mansatas',
      role: 'guru',
      banned: 0,
      password_hash: mansatasHash,
    });

    const app = new Hono<{ Bindings: any }>();
    app.route('/api/auth', authRoutes);

    const env = {
      DB: mocks.cbtDb,
      MANSATAS_DB: mocks.mansatasDb,
      JWT_SECRET: 'test-secret-phase1a',
      RATE_LIMIT: mocks.kvRateLimit,
    };

    const res = await app.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'tabrakan@man1tasik.sch.id',
          password: sharedPassword,
        }),
      }),
      env
    );

    assert.equal(res.status, 401);
    const body = await res.json<any>();
    assert.equal(body.success, false);
    assert.match(body.error, /lebih dari satu sumber/);
  });

  it('evaluates modes correctly via /api/auth/modes endpoint with token', async () => {
    const mocks = createMockDatabases();
    const adminHash = await hashPassword('AdminPass123');
    mocks.admins.push({
      id: 'adm_mode_test',
      username: 'adminmode',
      password: adminHash,
      nama_lengkap: 'Admin Mode Test',
    });

    const app = new Hono<{ Bindings: any }>();
    app.route('/api/auth', authRoutes);

    const env = {
      DB: mocks.cbtDb,
      JWT_SECRET: 'test-secret-phase1a',
      RATE_LIMIT: mocks.kvRateLimit,
    };

    // 1. Login to get token
    const loginRes = await app.fetch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'adminmode',
          password: 'AdminPass123',
        }),
      }),
      env
    );

    const loginData = await loginRes.json<any>();
    const token = loginData.data.token;

    // 2. Call /api/auth/modes with Bearer token
    const modesRes = await app.fetch(
      new Request('http://localhost/api/auth/modes', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      env
    );

    assert.equal(modesRes.status, 200);
    const modesBody = await modesRes.json<any>();
    assert.equal(modesBody.success, true);
    assert.deepEqual(modesBody.data.modes, [
      'pmb',
      'kegiatan',
      'tka',
      'semester',
      'ulangan',
    ]);
  });
});
