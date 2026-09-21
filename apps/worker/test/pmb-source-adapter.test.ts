import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import {
  listPmbSourceParticipants,
  getPmbSourceParticipantById,
  normalizePmbParticipant,
  PMB_TABLE_DEFAULT,
  PMB_EXCLUDE_PRESTASI,
} from '../src/services/sources/pmb.ts';

function createTestMansatasDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE pmb_pendaftar (
      id TEXT PRIMARY KEY,
      nisn TEXT NOT NULL,
      nama_lengkap TEXT NOT NULL,
      jenis_kelamin TEXT,
      ruang_tes TEXT,
      tanggal_tes TEXT,
      sesi_tes TEXT,
      no_pendaftaran TEXT,
      jalur TEXT,
      asal_sekolah TEXT
    );
  `);

  const d1 = {
    prepare(sql: string) {
      const makeExecution = (args: any[]) => ({
        async first<T = any>(): Promise<T | null> {
          const stmt = sqlite.prepare(sql);
          const row = stmt.get(...args);
          return row ? (row as T) : null;
        },
        async all<T = any>(): Promise<{ results: T[] }> {
          const stmt = sqlite.prepare(sql);
          const results = stmt.all(...args);
          return { results: (results as T[]) || [] };
        },
        async run(): Promise<any> {
          const stmt = sqlite.prepare(sql);
          return stmt.run(...args);
        },
      });

      return {
        ...makeExecution([]),
        bind(...args: any[]) {
          return makeExecution(args);
        },
      };
    },
  } as unknown as D1Database;

  return { sqlite, d1 };
}

describe('PMB Mansatas Source Adapter', () => {
  it('1. normalizePmbParticipant: correctly maps external schema to NormalizedParticipant', () => {
    const raw = {
      source_id: 'p-101',
      nisn: '0051234567',
      nama_lengkap: 'Ahmad Dahlan',
      jenis_kelamin: 'L',
      ruang_tes: 'LAB-KOMP-1',
      tanggal_tes: '2026-05-15',
      sesi_tes: 'Sesi 1',
      no_pendaftaran: 'PMB-2026-001',
      jalur: 'Reguler',
      asal_sekolah: 'MTsN 1 Tasikmalaya',
    };

    const normalized = normalizePmbParticipant(raw);
    assert.equal(normalized.source_key, 'pmb');
    assert.equal(normalized.source_id, 'p-101');
    assert.equal(normalized.username, '0051234567');
    assert.equal(normalized.nisn, '0051234567');
    assert.equal(normalized.full_name, 'Ahmad Dahlan');
    assert.equal(normalized.gender, 'L');
    assert.equal(normalized.is_active, true);
    assert.equal(normalized.room_name, 'LAB-KOMP-1');
    assert.equal(normalized.tanggal_tes, '2026-05-15');
    assert.equal(normalized.sesi_tes, 'Sesi 1');
    assert.deepEqual(normalized.metadata, {
      source: 'pmb',
      no_pendaftaran: 'PMB-2026-001',
      jalur: 'Reguler',
      asal_sekolah: 'MTsN 1 Tasikmalaya',
    });
  });

  it('2. PRESTASI exclusion: applicants with PRESTASI are excluded by adapter query', async () => {
    const { d1, sqlite } = createTestMansatasDb();

    sqlite.exec(`
      INSERT INTO pmb_pendaftar (id, nisn, nama_lengkap, jenis_kelamin, jalur)
      VALUES
        ('p-01', '001', 'Siswa Reguler', 'L', 'Reguler'),
        ('p-02', '002', 'Siswa Prestasi', 'P', 'Jalur PRESTASI'),
        ('p-03', '003', 'Siswa Afirmasi', 'L', 'Afirmasi');
    `);

    const result = await listPmbSourceParticipants(d1, {});
    assert.equal(result.total, 2);
    assert.equal(result.items.length, 2);
    const names = result.items.map(i => i.full_name);
    assert.ok(names.includes('Siswa Reguler'));
    assert.ok(names.includes('Siswa Afirmasi'));
    assert.ok(!names.includes('Siswa Prestasi'));

    // Direct lookup on PRESTASI applicant returns null
    const prestLookup = await getPmbSourceParticipantById(d1, 'p-02');
    assert.equal(prestLookup, null);

    // Direct lookup on non-PRESTASI applicant succeeds
    const regLookup = await getPmbSourceParticipantById(d1, 'p-01');
    assert.ok(regLookup);
    assert.equal(regLookup.full_name, 'Siswa Reguler');
  });

  it('3. Filtering: q (name/nisn), gender, jalur, room_name, tanggal_tes, sesi_tes', async () => {
    const { d1, sqlite } = createTestMansatasDb();

    sqlite.exec(`
      INSERT INTO pmb_pendaftar (id, nisn, nama_lengkap, jenis_kelamin, ruang_tes, tanggal_tes, sesi_tes, jalur, no_pendaftaran)
      VALUES
        ('p-01', '00111', 'Budi Santoso', 'L', 'LAB-1', '2026-06-01', 'Sesi 1', 'Reguler', 'PMB-01'),
        ('p-02', '00222', 'Siti Rahma', 'P', 'LAB-1', '2026-06-01', 'Sesi 1', 'Reguler', 'PMB-02'),
        ('p-03', '00333', 'Budi Gunawan', 'L', 'LAB-2', '2026-06-02', 'Sesi 2', 'Afirmasi', 'PMB-03');
    `);

    // Search query 'Budi' -> 2 results
    const qRes = await listPmbSourceParticipants(d1, { q: 'Budi' });
    assert.equal(qRes.total, 2);

    // Search query NISN '00222' -> 1 result
    const nisnRes = await listPmbSourceParticipants(d1, { q: '00222' });
    assert.equal(nisnRes.total, 1);
    assert.equal(nisnRes.items[0].full_name, 'Siti Rahma');

    // Filter gender 'P' -> 1 result
    const genRes = await listPmbSourceParticipants(d1, { gender: 'P' });
    assert.equal(genRes.total, 1);
    assert.equal(genRes.items[0].nisn, '00222');

    // Filter room_name 'LAB-1' -> 2 results
    const roomRes = await listPmbSourceParticipants(d1, { room_name: 'LAB-1' });
    assert.equal(roomRes.total, 2);

    // Filter tanggal_tes '2026-06-02' -> 1 result
    const dateRes = await listPmbSourceParticipants(d1, { tanggal_tes: '2026-06-02' });
    assert.equal(dateRes.total, 1);
    assert.equal(dateRes.items[0].id, undefined); // normalized has source_id
    assert.equal(dateRes.items[0].source_id, 'p-03');

    // Filter sesi_tes 'Sesi 2' -> 1 result
    const sesiRes = await listPmbSourceParticipants(d1, { sesi_tes: 'Sesi 2' });
    assert.equal(sesiRes.total, 1);

    // Filter is_active === false -> returns empty immediately without querying
    const inactiveRes = await listPmbSourceParticipants(d1, { is_active: false });
    assert.equal(inactiveRes.total, 0);
    assert.equal(inactiveRes.items.length, 0);

    // Specific IDs filter
    const idsRes = await listPmbSourceParticipants(d1, {}, ['p-01', 'p-03']);
    assert.equal(idsRes.total, 2);
    assert.deepEqual(idsRes.items.map(i => i.source_id).sort(), ['p-01', 'p-03']);
  });
});
