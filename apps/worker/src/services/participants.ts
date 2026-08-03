// ============================================================
// Normalized participant adapters
//
// The PMB database is legacy and remains handled by its existing routes.
// mansatas-db is deliberately mapped through explicit Wrangler variables so
// this Worker never guesses a table or column name in a different database.
// ============================================================

import type { Env } from '../types';

export type ParticipantSourceKey = 'pmb' | 'mansatas' | 'cbt_user';

export interface ParticipantFilters {
  q?: string;
  class_name?: string;
  grade?: string;
  gender?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface NormalizedParticipant {
  source_key: ParticipantSourceKey;
  source_id: string;
  username: string;
  nisn: string;
  full_name: string;
  class_name: string;
  grade: string;
  gender: string;
  is_active: boolean;
  room_id?: string | null;
  room_name?: string | null;
  tanggal_tes?: string | null;
  sesi_tes?: string | null;
  metadata: Record<string, unknown>;
}

interface MansatasConfig {
  table: string;
  id: string;
  nisn: string;
  name: string;
  className: string;
  grade: string;
  gender: string;
  active: string;
  activeValue?: string;
}

export class MansatasConfigError extends Error {
  readonly code = 'MANSATAS_NOT_CONFIGURED';

  constructor(message = 'Sumber peserta mansatas-db belum dikonfigurasi') {
    super(message);
    this.name = 'MansatasConfigError';
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function identifier(value: string | undefined, label: string): string {
  if (!value || !IDENTIFIER.test(value)) {
    throw new MansatasConfigError(`Mapping ${label} mansatas-db belum valid`);
  }
  return `"${value}"`;
}

function readConfig(env: Env): MansatasConfig | null {
  if (!env.MANSATAS_DB) return null;

  const raw = {
    table: env.MANSATAS_DB_TABLE,
    id: env.MANSATAS_DB_ID_COLUMN,
    nisn: env.MANSATAS_DB_NISN_COLUMN,
    name: env.MANSATAS_DB_NAME_COLUMN,
    className: env.MANSATAS_DB_CLASS_COLUMN,
    grade: env.MANSATAS_DB_GRADE_COLUMN,
    gender: env.MANSATAS_DB_GENDER_COLUMN,
    active: env.MANSATAS_DB_ACTIVE_COLUMN,
  };

  const missing = Object.entries(raw)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new MansatasConfigError(`Mapping mansatas-db belum lengkap: ${missing.join(', ')}`);
  }

  // Validate all identifiers before interpolating them into SQL.
  identifier(raw.table, 'tabel');
  identifier(raw.id, 'ID');
  identifier(raw.nisn, 'NISN');
  identifier(raw.name, 'nama');
  identifier(raw.className, 'kelas');
  identifier(raw.grade, 'tingkat');
  identifier(raw.gender, 'jenis kelamin');
  identifier(raw.active, 'status aktif');

  return {
    table: raw.table!, id: raw.id!, nisn: raw.nisn!, name: raw.name!,
    className: raw.className!, grade: raw.grade!, gender: raw.gender!,
    active: raw.active!, activeValue: env.MANSATAS_DB_ACTIVE_VALUE?.trim() || undefined,
  };
}

export function mansatasIsConfigured(env: Env): boolean {
  try {
    return !!readConfig(env);
  } catch {
    return false;
  }
}

function isTruthyActive(value: unknown, configuredValue?: string): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (configuredValue) return normalized === configuredValue.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'aktif', 'active', 'a'].includes(normalized);
}

function selectColumns(config: MansatasConfig): string {
  return [
    `${identifier(config.id, 'ID')} AS source_id`,
    `${identifier(config.nisn, 'NISN')} AS nisn`,
    `${identifier(config.name, 'nama')} AS full_name`,
    `${identifier(config.className, 'kelas')} AS class_name`,
    `${identifier(config.grade, 'tingkat')} AS grade`,
    `${identifier(config.gender, 'jenis kelamin')} AS gender`,
    `${identifier(config.active, 'status aktif')} AS active_value`,
  ].join(', ');
}

function normalizeRow(row: any, config: MansatasConfig): NormalizedParticipant {
  const sourceId = String(row?.source_id ?? '').trim();
  const nisn = String(row?.nisn ?? '').trim();
  return {
    source_key: 'mansatas',
    source_id: sourceId,
    username: nisn,
    nisn,
    full_name: String(row?.full_name ?? '').trim(),
    class_name: String(row?.class_name ?? '').trim(),
    grade: String(row?.grade ?? '').trim(),
    gender: String(row?.gender ?? '').trim(),
    is_active: isTruthyActive(row?.active_value, config.activeValue),
    metadata: { source: 'mansatas' },
  };
}

function buildFilters(config: MansatasConfig, filters: ParticipantFilters, idList?: string[]) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const qName = identifier(config.name, 'nama');
  const qNisn = identifier(config.nisn, 'NISN');
  const qClass = identifier(config.className, 'kelas');
  const qGrade = identifier(config.grade, 'tingkat');
  const qGender = identifier(config.gender, 'jenis kelamin');
  const qActive = identifier(config.active, 'status aktif');

  if (idList?.length) {
    where.push(`${identifier(config.id, 'ID')} IN (${idList.map(() => '?').join(',')})`);
    params.push(...idList);
  }
  if (filters.q?.trim()) {
    where.push(`(LOWER(CAST(${qName} AS TEXT)) LIKE ? OR LOWER(CAST(${qNisn} AS TEXT)) LIKE ?)`);
    const query = `%${filters.q.trim().toLowerCase()}%`;
    params.push(query, query);
  }
  if (filters.class_name?.trim()) {
    where.push(`LOWER(CAST(${qClass} AS TEXT)) = ?`);
    params.push(filters.class_name.trim().toLowerCase());
  }
  if (filters.grade?.trim()) {
    where.push(`LOWER(CAST(${qGrade} AS TEXT)) = ?`);
    params.push(filters.grade.trim().toLowerCase());
  }
  if (filters.gender?.trim()) {
    where.push(`LOWER(CAST(${qGender} AS TEXT)) = ?`);
    params.push(filters.gender.trim().toLowerCase());
  }
  if (typeof filters.is_active === 'boolean') {
    if (config.activeValue) {
      where.push(filters.is_active ? `${qActive} = ?` : `(${qActive} != ? OR ${qActive} IS NULL)`);
      params.push(config.activeValue);
    } else {
      // The common boolean encodings are normalized after reading. This keeps
      // filtering safe without assuming a particular source column type.
      where.push(`LOWER(CAST(${qActive} AS TEXT)) IN (${filters.is_active
        ? "'1','true','yes','y','aktif','active','a'"
        : "'0','false','no','n','nonaktif','inactive','tidak aktif'"})`);
    }
  }

  return { where, params };
}

export async function listMansatasParticipants(
  env: Env,
  filters: ParticipantFilters = {},
  options: { ids?: string[]; max?: number } = {},
): Promise<{ items: NormalizedParticipant[]; total: number }> {
  const config = readConfig(env);
  if (!config || !env.MANSATAS_DB) throw new MansatasConfigError();

  const max = Math.min(Math.max(options.max ?? 100, 1), 5000);
  const page = Math.max(Number(filters.page ?? 1) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.page_size ?? 50) || 50, 1), max);
  const { where, params } = buildFilters(config, filters, options.ids);
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const table = identifier(config.table, 'tabel');
  const columns = selectColumns(config);

  const [rowsResult, countResult] = await Promise.all([
    env.MANSATAS_DB.prepare(
      `SELECT ${columns} FROM ${table}${whereSql}
       ORDER BY LOWER(CAST(${identifier(config.name, 'nama')} AS TEXT)), CAST(${identifier(config.nisn, 'NISN')} AS TEXT)
       LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, (page - 1) * pageSize).all(),
    env.MANSATAS_DB.prepare(`SELECT COUNT(*) AS total FROM ${table}${whereSql}`).bind(...params).first<any>(),
  ]);

  const items = (rowsResult.results as any[]).map(row => normalizeRow(row, config));
  return { items, total: Number(countResult?.total ?? 0) };
}

export async function findMansatasByCredentials(
  env: Env,
  username: string,
  password: string,
): Promise<{ participant: NormalizedParticipant | null; found: boolean }> {
  const config = readConfig(env);
  if (!config || !env.MANSATAS_DB) return { participant: null, found: false };

  const table = identifier(config.table, 'tabel');
  const nisn = identifier(config.nisn, 'NISN');
  const row = await env.MANSATAS_DB.prepare(
    `SELECT ${selectColumns(config)} FROM ${table}
     WHERE CAST(${nisn} AS TEXT) = ? LIMIT 2`
  ).bind(username.trim()).first<any>();

  if (!row) return { participant: null, found: false };
  const participant = normalizeRow(row, config);
  // School credentials are intentionally not persisted in CBT: NISN is both
  // username and password, and the source record must also be active.
  const valid = participant.is_active && password.trim() === participant.username;
  return { participant: valid ? participant : null, found: true };
}

export function sourceToSessionUserType(source: string): 'pendaftar' | 'cbt_user' | 'mansatas' {
  if (source === 'pendaftar') return 'pendaftar';
  if (source === 'mansatas') return 'mansatas';
  return 'cbt_user';
}

export function sourceToRosterKey(source: string): ParticipantSourceKey {
  if (source === 'pendaftar') return 'pmb';
  if (source === 'mansatas') return 'mansatas';
  return 'cbt_user';
}
