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
  gender: string;
  active: string;
  className?: string;
  grade?: string;
  classRelation?: {
    table: string;
    id: string;
    foreignKey: string;
    grade: string;
    number: string;
    group: string;
  };
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
    gender: env.MANSATAS_DB_GENDER_COLUMN,
    active: env.MANSATAS_DB_ACTIVE_COLUMN,
  };

  const missing = Object.entries(raw)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const directClassMapping = {
    className: env.MANSATAS_DB_CLASS_COLUMN,
    grade: env.MANSATAS_DB_GRADE_COLUMN,
  };
  const relationMapping = {
    table: env.MANSATAS_DB_CLASS_TABLE,
    id: env.MANSATAS_DB_CLASS_ID_COLUMN,
    foreignKey: env.MANSATAS_DB_CLASS_FOREIGN_KEY_COLUMN,
    grade: env.MANSATAS_DB_CLASS_GRADE_COLUMN,
    number: env.MANSATAS_DB_CLASS_NUMBER_COLUMN,
    group: env.MANSATAS_DB_CLASS_GROUP_COLUMN,
  };
  const hasDirectClassMapping = Boolean(directClassMapping.className && directClassMapping.grade);
  const hasRelationMapping = Object.values(relationMapping).every(Boolean);

  if (missing.length || (!hasDirectClassMapping && !hasRelationMapping)) {
    const classMessage = hasDirectClassMapping || hasRelationMapping
      ? []
      : ['class/grade (direct atau relasi tabel kelas)'];
    throw new MansatasConfigError(
      `Mapping mansatas-db belum lengkap: ${[...missing, ...classMessage].join(', ')}`,
    );
  }

  // Validate all identifiers before interpolating them into SQL.
  identifier(raw.table, 'tabel');
  identifier(raw.id, 'ID');
  identifier(raw.nisn, 'NISN');
  identifier(raw.name, 'nama');
  identifier(raw.gender, 'jenis kelamin');
  identifier(raw.active, 'status aktif');

  if (hasDirectClassMapping) {
    identifier(directClassMapping.className, 'kelas');
    identifier(directClassMapping.grade, 'tingkat');
  }

  if (hasRelationMapping) {
    identifier(relationMapping.table, 'tabel kelas');
    identifier(relationMapping.id, 'ID tabel kelas');
    identifier(relationMapping.foreignKey, 'foreign key kelas');
    identifier(relationMapping.grade, 'tingkat tabel kelas');
    identifier(relationMapping.number, 'nomor kelas');
    identifier(relationMapping.group, 'kelompok kelas');
  }

  return {
    table: raw.table!, id: raw.id!, nisn: raw.nisn!, name: raw.name!,
    className: hasDirectClassMapping ? directClassMapping.className : undefined,
    grade: hasDirectClassMapping ? directClassMapping.grade : undefined,
    classRelation: hasRelationMapping ? {
      table: relationMapping.table!, id: relationMapping.id!,
      foreignKey: relationMapping.foreignKey!, grade: relationMapping.grade!,
      number: relationMapping.number!, group: relationMapping.group!,
    } : undefined,
    gender: raw.gender!,
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

function qualified(alias: string, column: string, label: string): string {
  return `${alias}.${identifier(column, label)}`;
}

function sourceFrom(config: MansatasConfig): string {
  const source = `${identifier(config.table, 'tabel')} AS s`;
  if (!config.classRelation) return source;
  const relation = config.classRelation;
  return `${source}
    LEFT JOIN ${identifier(relation.table, 'tabel kelas')} AS k
      ON ${qualified('k', relation.id, 'ID tabel kelas')} = ${qualified('s', relation.foreignKey, 'foreign key kelas')}`;
}

function gradeExpression(config: MansatasConfig): string {
  if (config.classRelation) {
    return `CAST(${qualified('k', config.classRelation.grade, 'tingkat tabel kelas')} AS TEXT)`;
  }
  return `CAST(${qualified('s', config.grade!, 'tingkat')} AS TEXT)`;
}

function classNameExpression(config: MansatasConfig): string {
  if (!config.classRelation) {
    return `CAST(${qualified('s', config.className!, 'kelas')} AS TEXT)`;
  }

  const relation = config.classRelation;
  const grade = qualified('k', relation.grade, 'tingkat tabel kelas');
  const group = qualified('k', relation.group, 'kelompok kelas');
  const number = qualified('k', relation.number, 'nomor kelas');
  return `TRIM(
    COALESCE(CAST(${grade} AS TEXT), '')
    || CASE WHEN ${group} IS NOT NULL AND TRIM(CAST(${group} AS TEXT)) <> ''
       THEN ' ' || TRIM(CAST(${group} AS TEXT)) ELSE '' END
    || CASE WHEN ${number} IS NOT NULL AND TRIM(CAST(${number} AS TEXT)) <> ''
       THEN ' ' || TRIM(CAST(${number} AS TEXT)) ELSE '' END
  )`;
}

function selectColumns(config: MansatasConfig): string {
  const className = classNameExpression(config);
  const grade = gradeExpression(config);
  return [
    `${qualified('s', config.id, 'ID')} AS source_id`,
    `${qualified('s', config.nisn, 'NISN')} AS nisn`,
    `${qualified('s', config.name, 'nama')} AS full_name`,
    `${className} AS class_name`,
    `${grade} AS grade`,
    `${qualified('s', config.gender, 'jenis kelamin')} AS gender`,
    `${qualified('s', config.active, 'status aktif')} AS active_value`,
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
  const qId = qualified('s', config.id, 'ID');
  const qName = qualified('s', config.name, 'nama');
  const qNisn = qualified('s', config.nisn, 'NISN');
  const qClass = classNameExpression(config);
  const qGrade = gradeExpression(config);
  const qGender = qualified('s', config.gender, 'jenis kelamin');
  const qActive = qualified('s', config.active, 'status aktif');

  if (idList?.length) {
    where.push(`${qId} IN (${idList.map(() => '?').join(',')})`);
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

  const effectiveFilters: ParticipantFilters = {
    is_active: filters.is_active === undefined ? true : filters.is_active,
    ...filters,
  };

  const max = Math.min(Math.max(options.max ?? 100, 1), 5000);
  const page = Math.max(Number(filters.page ?? 1) || 1, 1);
  const pageSize = Math.min(Math.max(Number(filters.page_size ?? 50) || 50, 1), max);
  const { where, params } = buildFilters(config, effectiveFilters, options.ids);
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const fromSql = sourceFrom(config);
  const columns = selectColumns(config);
  const name = qualified('s', config.name, 'nama');
  const nisn = qualified('s', config.nisn, 'NISN');

  const [rowsResult, countResult] = await Promise.all([
    env.MANSATAS_DB.prepare(
      `SELECT ${columns} FROM ${fromSql}${whereSql}
       ORDER BY LOWER(CAST(${name} AS TEXT)), CAST(${nisn} AS TEXT)
       LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, (page - 1) * pageSize).all(),
    env.MANSATAS_DB.prepare(`SELECT COUNT(*) AS total FROM ${fromSql}${whereSql}`).bind(...params).first<any>(),
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

  const fromSql = sourceFrom(config);
  const nisn = qualified('s', config.nisn, 'NISN');
  const row = await env.MANSATAS_DB.prepare(
    `SELECT ${selectColumns(config)} FROM ${fromSql}
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
