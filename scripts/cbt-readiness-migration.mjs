#!/usr/bin/env node

import { exec, execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const workerRoot = resolve(repoRoot, 'apps/worker');

const args = new Set(process.argv.slice(2));
const getArg = (name, fallback) => {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
};

const database = getArg('--database', 'pmb-man1-tasik');
const mode = args.has('--local') ? '--local' : '--remote';
const dryRun = args.has('--dry-run');

const requiredExamColumns = [
  ['target_jalur', 'TEXT DEFAULT NULL'],
  ['cheat_limit', 'INTEGER DEFAULT 3'],
  ['cheat_action', "TEXT DEFAULT 'lock'"],
  ['enforce_fullscreen', 'INTEGER DEFAULT 0'],
];

const baseStatements = [
  `CREATE TABLE IF NOT EXISTS cbt_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS cbt_exam_assignments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    exam_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_type TEXT NOT NULL DEFAULT 'pendaftar',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(exam_id, user_id, user_type)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_cbt_assignments_exam ON cbt_exam_assignments(exam_id)',
  'CREATE INDEX IF NOT EXISTS idx_cbt_assignments_user ON cbt_exam_assignments(user_id, user_type)',
  `CREATE TABLE IF NOT EXISTS cbt_cheat_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    session_id TEXT NOT NULL REFERENCES cbt_exam_sessions(id) ON DELETE CASCADE,
    violation_type TEXT NOT NULL,
    happened_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_cheat_logs_session ON cbt_cheat_logs(session_id)',
];

const tokenTableSql = `CREATE TABLE cbt_exam_tokens_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_id TEXT NOT NULL REFERENCES cbt_exams(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES cbt_rooms(id) ON DELETE CASCADE,
  tanggal_tes TEXT NOT NULL DEFAULT '',
  sesi_tes TEXT NOT NULL DEFAULT '',
  token_code TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(exam_id, room_id, tanggal_tes, sesi_tes)
)`;

function printUsageAndExit() {
  console.log(`Usage:
  node scripts/cbt-readiness-migration.mjs [--remote|--local] [--database pmb-man1-tasik] [--dry-run]

Default mode is --remote. The script checks existing D1 schema first, then only
adds missing CBT readiness columns/tables.`);
  process.exit(0);
}

if (args.has('--help') || args.has('-h')) printUsageAndExit();

async function wrangler(extraArgs, options = {}) {
  const wranglerArgs = ['wrangler', 'd1', 'execute', database, mode, ...extraArgs];
  let stdout = '';
  let stderr = '';
  try {
    if (process.platform === 'win32') {
      const quote = (arg) => /^[A-Za-z0-9_./:=@-]+$/.test(arg)
        ? arg
        : `"${arg.replace(/"/g, '""')}"`;
      const command = ['npx.cmd', ...wranglerArgs].map(quote).join(' ');
      const result = await execAsync(command, {
        cwd: workerRoot,
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } else {
      const result = await execFileAsync('npx', wranglerArgs, {
        cwd: workerRoot,
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    }
  } catch (error) {
    const details = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n').trim();
    throw new Error(details || error.message);
  }
  if (stderr && !options.quiet) process.stderr.write(stderr);
  return stdout;
}

function extractRows(jsonText) {
  const clean = jsonText.replace(/\u001b\[[0-9;]*m/g, '').trim();
  let parsed;
  const candidates = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '[' || clean[i] === '{') candidates.push(clean.slice(i));
  }
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {}
  }
  if (!parsed) throw new Error(`Wrangler JSON output tidak bisa dibaca:\n${clean}`);
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (Array.isArray(item?.results)) return item.results;
      if (Array.isArray(item?.result?.[0]?.results)) return item.result[0].results;
    }
  }
  if (Array.isArray(parsed?.results)) return parsed.results;
  if (Array.isArray(parsed?.result?.[0]?.results)) return parsed.result[0].results;
  return [];
}

async function queryRows(sql) {
  const out = await wrangler(['--command', sql.replace(/\s+/g, ' ').trim(), '--json'], { quiet: true });
  return extractRows(out);
}

async function execute(sql) {
  const compact = sql.replace(/\s+/g, ' ').trim();
  if (dryRun) {
    console.log(`[dry-run] ${compact}`);
    return;
  }
  await wrangler(['--command', compact], { quiet: true });
  console.log(`[ok] ${compact}`);
}

async function tableExists(table) {
  const rows = await queryRows(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${table.replace(/'/g, "''")}'`
  );
  return rows.length > 0;
}

async function getColumns(table) {
  const safeTable = table.replace(/'/g, "''");
  const rows = await queryRows(`SELECT name FROM pragma_table_info('${safeTable}')`);
  return new Set(rows.map((row) => row.name));
}

async function main() {
  console.log(`CBT readiness migration: database=${database}, mode=${mode}, dryRun=${dryRun}`);

  if (!(await tableExists('cbt_exams'))) {
    throw new Error('Tabel cbt_exams belum ada. Jalankan npm run db:init terlebih dahulu.');
  }

  const columns = await getColumns('cbt_exams');
  for (const [name, definition] of requiredExamColumns) {
    if (columns.has(name)) {
      console.log(`[skip] cbt_exams.${name} sudah ada`);
      continue;
    }
    await execute(`ALTER TABLE cbt_exams ADD COLUMN ${name} ${definition}`);
  }

  for (const sql of baseStatements) {
    await execute(sql);
  }

  if (await tableExists('cbt_exam_tokens')) {
    const tokenColumns = await getColumns('cbt_exam_tokens');
    if (!tokenColumns.has('tanggal_tes') || !tokenColumns.has('sesi_tes')) {
      await execute('DROP TABLE IF EXISTS cbt_exam_tokens_new');
      await execute(tokenTableSql);
      await execute(`INSERT INTO cbt_exam_tokens_new
        (id, exam_id, room_id, tanggal_tes, sesi_tes, token_code, is_active, expires_at, created_at)
        SELECT id, exam_id, room_id, '', '', token_code, is_active, expires_at, created_at
        FROM cbt_exam_tokens`);
      await execute('DROP TABLE cbt_exam_tokens');
      await execute('ALTER TABLE cbt_exam_tokens_new RENAME TO cbt_exam_tokens');
    } else {
      console.log('[skip] cbt_exam_tokens tanggal/sesi sudah ada');
    }
    await execute('CREATE INDEX IF NOT EXISTS idx_cbt_tokens_lookup ON cbt_exam_tokens(exam_id, room_id, tanggal_tes, sesi_tes, token_code)');
  }

  console.log('CBT readiness migration selesai.');
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
