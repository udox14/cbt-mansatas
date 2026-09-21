// test/auth-baseline.test.ts
// Regression tests for CURRENT Mansatas-based PMB production flow & student identity

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findMansatasByCredentials, sourceToSessionUserType, sourceToRosterKey } from '../src/services/participants.ts';

describe('Current Mansatas-based PMB Auth & Student Identity Suite', () => {
  const createMockEnv = (studentRows: any[] = []) => ({
    DB: {} as any,
    MANSATAS_DB: {
      prepare: (sql: string) => ({
        bind: (...params: any[]) => ({
          first: async () => {
            const nisnParam = String(params[0] ?? '').trim();
            const found = studentRows.find(r => String(r.nisn).trim() === nisnParam);
            if (!found) return null;
            return {
              source_id: found.id,
              nisn: found.nisn,
              full_name: found.nama_lengkap,
              class_name: found.kelas_id || '',
              grade: found.tingkat || '',
              gender: found.jenis_kelamin || '',
              active_value: found.status || '',
            };
          },
        }),
      }),
    } as any,
    MANSATAS_DB_TABLE: 'siswa',
    MANSATAS_DB_ID_COLUMN: 'id',
    MANSATAS_DB_NISN_COLUMN: 'nisn',
    MANSATAS_DB_NAME_COLUMN: 'nama_lengkap',
    MANSATAS_DB_GENDER_COLUMN: 'jenis_kelamin',
    MANSATAS_DB_ACTIVE_COLUMN: 'status',
    MANSATAS_DB_ACTIVE_VALUE: 'aktif',
    MANSATAS_DB_CLASS_COLUMN: 'kelas_id',
    MANSATAS_DB_GRADE_COLUMN: 'tingkat',
  });

  it('authenticates active Mansatas student for PMB with NISN credentials', async () => {
    const mockEnv = createMockEnv([
      {
        id: 'siswa_pmb_001',
        nisn: '0081234567',
        nama_lengkap: 'Ahmad Peserta PMB',
        jenis_kelamin: 'L',
        status: 'aktif',
        kelas_id: 'X-1',
        tingkat: '10',
      },
    ]);

    const result = await findMansatasByCredentials(mockEnv as any, '0081234567', '0081234567');
    assert.equal(result.found, true);
    assert.ok(result.participant);
    assert.equal(result.participant.source_id, 'siswa_pmb_001');
    assert.equal(result.participant.nisn, '0081234567');
    assert.equal(result.participant.full_name, 'Ahmad Peserta PMB');
    assert.equal(result.participant.is_active, true);
    assert.equal(result.participant.source_key, 'mansatas');
  });

  it('strictly rejects student when password does not match NISN', async () => {
    const mockEnv = createMockEnv([
      {
        id: 'siswa_pmb_002',
        nisn: '0081234568',
        nama_lengkap: 'Siti Peserta PMB',
        jenis_kelamin: 'P',
        status: 'aktif',
        kelas_id: 'X-2',
        tingkat: '10',
      },
    ]);

    const result = await findMansatasByCredentials(mockEnv as any, '0081234568', 'wrong_password');
    assert.equal(result.found, true);
    assert.equal(result.participant, null);
  });

  it('strictly rejects inactive student even if credentials match', async () => {
    const mockEnv = createMockEnv([
      {
        id: 'siswa_pmb_003',
        nisn: '0081234569',
        nama_lengkap: 'Budi Nonaktif',
        jenis_kelamin: 'L',
        status: 'nonaktif',
        kelas_id: 'X-3',
        tingkat: '10',
      },
    ]);

    const result = await findMansatasByCredentials(mockEnv as any, '0081234569', '0081234569');
    assert.equal(result.found, true);
    assert.equal(result.participant, null);
  });

  it('preserves trimming behavior on student credentials', async () => {
    const mockEnv = createMockEnv([
      {
        id: 'siswa_pmb_004',
        nisn: '0081234570',
        nama_lengkap: 'Dewi Santika',
        jenis_kelamin: 'P',
        status: 'aktif',
        kelas_id: 'X-4',
        tingkat: '10',
      },
    ]);

    const result = await findMansatasByCredentials(mockEnv as any, '  0081234570  ', '  0081234570  ');
    assert.equal(result.found, true);
    assert.ok(result.participant);
    assert.equal(result.participant.nisn, '0081234570');
  });

  it('maps mansatas student source correctly to session user type and roster key', () => {
    assert.equal(sourceToSessionUserType('mansatas'), 'mansatas');
    assert.equal(sourceToSessionUserType('cbt_user'), 'cbt_user');
    assert.equal(sourceToRosterKey('mansatas'), 'mansatas');
  });
});
