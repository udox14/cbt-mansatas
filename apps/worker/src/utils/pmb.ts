/**
 * @deprecated RETIRED LEGACY
 * The legacy PMB database (pmb-man1-tasik / pendaftar / prestasi) has been retired.
 * The authoritative PMB applicant source is mansatas-db, snapshotting into cbt_exam_roster.
 * This file contains no active runtime dependencies and is retained only for backward reference.
 */
import type { Env } from '../types.ts';

export function getPmbDb(env: Env) {
  return env.MANSATAS_DB || env.DB;
}

export function getPmbTable(env: Env): string {
  return env.MANSATAS_DB ? 'pmb_pendaftar' : 'pendaftar';
}
