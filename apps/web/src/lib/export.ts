'use client';
import * as XLSX from 'xlsx';

// ═══════════════════════════════════════════════════════════════
// XLSX Export (SheetJS via npm, bundled)
// ═══════════════════════════════════════════════════════════════

interface ExportColumn {
  key: string;
  label: string;
  width?: number;
}

export async function exportToXlsx(
  data: Record<string, any>[],
  columns: ExportColumn[],
  filename: string,
  sheetName = 'Data'
) {
  // Build header row
  const header = columns.map(c => c.label);

  // Build data rows
  const rows = data.map(row => columns.map(c => row[c.key] ?? ''));

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

  // Set column widths
  ws['!cols'] = columns.map(c => ({ wch: c.width || 15 }));

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Download
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ── Preset Exports ───────────────────────────────────────────

export async function exportExamResults(
  results: any[],
  examTitle: string
) {
  const columns: ExportColumn[] = [
    { key: '_no', label: 'No', width: 5 },
    { key: 'nisn', label: 'NISN', width: 15 },
    { key: 'full_name', label: 'Nama Lengkap', width: 30 },
    { key: 'username', label: 'Username', width: 15 },
    { key: 'room_name', label: 'Ruangan', width: 15 },
    { key: 'tanggal_tes', label: 'Tanggal Tes', width: 18 },
    { key: 'sesi_tes', label: 'Sesi Tes', width: 25 },
    { key: 'total_questions', label: 'Total Soal', width: 10 },
    { key: 'total_correct', label: 'Benar', width: 8 },
    { key: 'total_wrong', label: 'Salah', width: 8 },
    { key: 'total_unanswered', label: 'Kosong', width: 8 },
    { key: 'score', label: 'Nilai', width: 10 },
  ];

  const data = results.map((r, i) => ({ ...r, _no: i + 1 }));
  const safeName = examTitle.replace(/[^a-zA-Z0-9_\-\s]/g, '').slice(0, 30);
  await exportToXlsx(data, columns, `Hasil-${safeName}`, 'Hasil Ujian');
}

export async function exportExamAnalytics(rows: any[], examTitle: string) {
  const columns: ExportColumn[] = [
    { key: '_no', label: 'No', width: 5 },
    { key: 'question_order', label: 'No Soal', width: 8 },
    { key: 'question_text', label: 'Soal', width: 50 },
    { key: 'question_type', label: 'Tipe', width: 14 },
    { key: 'answered_count', label: 'Terjawab', width: 10 },
    { key: 'correct_count', label: 'Benar', width: 8 },
    { key: 'wrong_count', label: 'Salah', width: 8 },
    { key: 'blank_count', label: 'Kosong', width: 8 },
    { key: 'correct_rate', label: 'Benar (%)', width: 12 },
    { key: 'difficulty', label: 'Kesulitan', width: 14 },
    { key: 'flag', label: 'Catatan', width: 24 },
  ];

  const data = rows.map((r, i) => ({ ...r, _no: i + 1 }));
  const safeName = examTitle.replace(/[^a-zA-Z0-9_\-\s]/g, '').slice(0, 30);
  await exportToXlsx(data, columns, `Analitik-${safeName}`, 'Analitik Soal');
}

export async function exportUserList(users: any[]) {
  const columns: ExportColumn[] = [
    { key: '_no', label: 'No', width: 5 },
    { key: 'username', label: 'Username', width: 15 },
    { key: 'full_name', label: 'Nama Lengkap', width: 30 },
    { key: 'role', label: 'Role', width: 10 },
    { key: 'nisn', label: 'NISN', width: 15 },
    { key: 'room_name', label: 'Ruangan', width: 15 },
  ];

  const data = users.map((u, i) => ({ ...u, _no: i + 1 }));
  await exportToXlsx(data, columns, 'Daftar-Pengguna', 'Pengguna');
}
