// ============================================================
// Reporting Service — Hardened CSV Export
//
// 1. Strictly respects authorization & domain filters
// 2. Escapes spreadsheet formula injection (=, +, -, @, \t, \r)
// 3. Prepends UTF-8 BOM (\uFEFF) to preserve Arabic/Unicode characters
// 4. Deterministic column ordering & standard RFC 4180 CSV escaping
// ============================================================

import type { ReportFilter } from './types.ts';
import { getConsolidatedResults } from './results.ts';

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Escapes a single CSV cell value to prevent spreadsheet formula injection
 * and handles quotes/newlines according to RFC 4180.
 */
export function escapeCsvCell(val: any): string {
  if (val === null || val === undefined) return '""';
  let str = String(val);

  // Spreadsheet formula injection guard
  if (FORMULA_TRIGGERS.some(trigger => str.startsWith(trigger))) {
    str = `'${str}`;
  }

  // Quote escaping
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return `"${str}"`;
}

export async function generateResultsCsv(
  db: D1Database,
  examId: string,
  filters: ReportFilter = {}
): Promise<{ filename: string; csvContent: string }> {
  // Fetch all rows matching filters (limit up to 10000 for export safety)
  const result = await getConsolidatedResults(db, examId, filters, { page: 1, limit: 10000 });
  const rows = result.items;

  // Retrieve exam title for deterministic filename
  const exam = await db.prepare(
    'SELECT title FROM cbt_exams WHERE id = ?'
  ).bind(examId).first<any>();

  const title = exam?.title || 'Ujian';
  const safeTitle = title.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_') || 'Hasil';
  const filename = `Hasil_${safeTitle}_${new Date().toISOString().slice(0, 10)}.csv`;

  // Deterministic CSV Header
  const headers = [
    'No',
    'NISN',
    'Nama Lengkap',
    'Kelas',
    'Ruangan',
    'Tanggal Tes',
    'Sesi Tes',
    'Status',
    'Total Soal',
    'Benar',
    'Salah',
    'Kosong',
    'Nilai',
  ];

  const lines: string[] = [headers.map(escapeCsvCell).join(',')];

  rows.forEach((r, idx) => {
    const line = [
      idx + 1,
      r.nisn,
      r.fullName,
      r.className,
      r.roomName,
      r.tanggalTes,
      r.sesiTes,
      r.statusLabel,
      r.totalQuestions !== '' ? r.totalQuestions : '-',
      r.totalCorrect !== '' ? r.totalCorrect : '-',
      r.totalWrong !== '' ? r.totalWrong : '-',
      r.totalUnanswered !== '' ? r.totalUnanswered : '-',
      r.score !== '' ? r.score : '-',
    ].map(escapeCsvCell).join(',');
    lines.push(line);
  });

  // Prepend UTF-8 BOM (\uFEFF) for Excel Unicode / Arabic support
  const csvContent = '\uFEFF' + lines.join('\r\n');

  return {
    filename,
    csvContent,
  };
}
