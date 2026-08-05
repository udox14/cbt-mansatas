import type { Env } from '../types';

/**
 * Mendapatkan D1Database instance yang digunakan untuk data PMB.
 * Mengutamakan MANSATAS_DB jika tersedia, fallback ke DB.
 */
export function getPmbDb(env: Env) {
  return env.MANSATAS_DB || env.DB;
}

/**
 * Mendapatkan nama tabel pendaftar PMB.
 * Menggunakan 'pmb_pendaftar' jika MANSATAS_DB tersedia, atau fallback ke 'pendaftar'.
 */
export function getPmbTable(env: Env): string {
  return env.MANSATAS_DB ? 'pmb_pendaftar' : 'pendaftar';
}

export const EXCLUDE_JALUR_COND = "UPPER(jalur) NOT LIKE '%PRESTASI%'";
