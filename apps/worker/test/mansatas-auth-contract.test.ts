// test/mansatas-auth-contract.test.ts
// Automated contract tests for MansatasStaffAuthAdapter and Mansatas PBKDF2 format

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashMansatasPassword,
  verifyMansatasPassword,
  authenticateMansatasStaff,
} from '../src/services/platform/auth-mansatas.ts';

describe('Mansatas Staff Auth PBKDF2 Contract Suite', () => {
  it('correctly hashes and verifies a valid password', async () => {
    const password = 'KunciRahasiaGuru2026!';
    const hash = await hashMansatasPassword(password);

    assert.match(hash, /^pbkdf2:100000:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    const isValid = await verifyMansatasPassword(hash, password);
    assert.equal(isValid, true);
  });

  it('rejects an incorrect password against a valid hash', async () => {
    const hash = await hashMansatasPassword('PasswordBenar123');
    const isValid = await verifyMansatasPassword(hash, 'PasswordSalah123');
    assert.equal(isValid, false);
  });

  it('preserves leading and trailing spaces without trimming', async () => {
    const rawPasswordWithSpaces = '   spasi_di_depan_dan_belakang   ';
    const hash = await hashMansatasPassword(rawPasswordWithSpaces);

    // Exact untrimmed password must verify
    assert.equal(await verifyMansatasPassword(hash, rawPasswordWithSpaces), true);

    // Trimmed password must NOT verify because it alters the PBKDF2 digest
    assert.equal(await verifyMansatasPassword(hash, rawPasswordWithSpaces.trim()), false);
  });

  it('safely handles malformed or non-pbkdf2 hash strings without throwing', async () => {
    assert.equal(await verifyMansatasPassword('plain_text_password', 'foo'), false);
    assert.equal(await verifyMansatasPassword('md5:12345', 'foo'), false);
    assert.equal(await verifyMansatasPassword('pbkdf2:invalid:salt:hash', 'foo'), false);
    assert.equal(await verifyMansatasPassword('', 'foo'), false);
    assert.equal(await verifyMansatasPassword(null as any, 'foo'), false);
  });

  it('authenticates staff via mock MANSATAS_DB with case-insensitive email', async () => {
    const validPassword = 'GuruMadrasah2026';
    const storedHash = await hashMansatasPassword(validPassword);

    const mockDb = {
      prepare(sql: string) {
        return {
          bind(emailArg: string) {
            return {
              async first() {
                if (emailArg.toLowerCase() === 'guru.fisika@man1tasik.sch.id') {
                  return {
                    id: 'usr_mansatas_fisika_01',
                    email: 'guru.fisika@man1tasik.sch.id',
                    nama_lengkap: 'Drs. Ahmad Mansur, M.Pd.',
                    role: 'guru',
                    nip: '197501012000031001',
                    banned: 0,
                    password_hash: storedHash,
                  };
                }
                return null;
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    // Test with mixed-case email
    const resUpper = await authenticateMansatasStaff(
      mockDb,
      'GURU.FISIKA@MAN1TASIK.SCH.ID',
      validPassword
    );
    assert.equal(resUpper.success, true);
    assert.equal(resUpper.staff?.id, 'usr_mansatas_fisika_01');
    assert.equal(resUpper.staff?.email, 'guru.fisika@man1tasik.sch.id');

    // Test with wrong password
    const resWrongPw = await authenticateMansatasStaff(
      mockDb,
      'guru.fisika@man1tasik.sch.id',
      'SalahPassword'
    );
    assert.equal(resWrongPw.success, false);
    assert.match(resWrongPw.error || '', /Email atau password salah/);

    // Test with non-existent email
    const resNotFound = await authenticateMansatasStaff(
      mockDb,
      'unknown@man1tasik.sch.id',
      validPassword
    );
    assert.equal(resNotFound.success, false);
  });

  it('strictly rejects banned staff accounts', async () => {
    const validPassword = 'GuruBanned2026';
    const storedHash = await hashMansatasPassword(validPassword);

    const mockDb = {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return {
                  id: 'usr_banned_01',
                  email: 'banned.staff@man1tasik.sch.id',
                  nama_lengkap: 'Staf Terblokir',
                  role: 'guru',
                  banned: 1,
                  password_hash: storedHash,
                };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const res = await authenticateMansatasStaff(
      mockDb,
      'banned.staff@man1tasik.sch.id',
      validPassword
    );
    assert.equal(res.success, false);
    assert.match(res.error || '', /Akun Anda dinonaktifkan \/ diblokir/);
  });
});
