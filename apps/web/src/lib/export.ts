'use client';

// ═══════════════════════════════════════════════════════════════
// XLSX Export (SheetJS from CDN, client-side)
// ═══════════════════════════════════════════════════════════════

let loaded = false;

async function ensureSheetJS(): Promise<void> {
  if (loaded && (window as any).XLSX) return;
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src*="xlsx"]')) {
      loaded = true; resolve(); return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => { loaded = true; resolve(); };
    s.onerror = () => reject(new Error('Gagal memuat SheetJS'));
    document.head.appendChild(s);
  });
}

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
  await ensureSheetJS();
  const XLSX = (window as any).XLSX;

  // Build header row
  const header = columns.map(c => c.label);

  // Build data rows
  const rows = data.map(row => columns.map(c => row[c.key] ?? ''));

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);

  // Set column widths
  ws['!cols'] = columns.map(c => ({ wch: c.width || 15 }));

  // Style header (bold via cell format - limited in SheetJS free)
  // SheetJS community edition doesn't support styling, but widths work

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
