'use client';
import { useState, useRef } from 'react';
import { Button, Modal, Badge, Spinner } from '@/components/ui';
import { POST } from '@/lib/api';

// ═══════════════════════════════════════════════════════════════
// Bulk Import: Excel & Word (Client-side parsing, no Worker RAM)
// ═══════════════════════════════════════════════════════════════

// ── CDN Loader ───────────────────────────────────────────────
let sheetjsLoaded = false;
let mammothLoaded = false;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Gagal memuat ${src}`));
    document.head.appendChild(s);
  });
}

async function ensureSheetJS() {
  if (sheetjsLoaded && (window as any).XLSX) return;
  await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  sheetjsLoaded = true;
}

async function ensureMammoth() {
  if (mammothLoaded && (window as any).mammoth) return;
  await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
  mammothLoaded = true;
}

// ── Types ────────────────────────────────────────────────────
interface ParsedQuestion {
  question_text: string;
  question_type: 'multiple_choice' | 'essay';
  options: { option_label: string; option_text: string; is_correct: number }[];
  image_url: string | null;
  audio_url: string | null;
}

interface ParsedUser {
  username: string;
  full_name: string;
  password?: string;
  role: string;
  room_id?: number | null;
  nisn?: string;
}

interface BulkImportProps {
  type: 'questions' | 'users';
  examId?: string;           // required for questions
  onSuccess: () => void;
  onClose: () => void;
  open: boolean;
}

export default function BulkImport({ type, examId, onSuccess, onClose, open }: BulkImportProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing'>('upload');
  const [error, setError] = useState('');
  const [parsedQuestions, setParsedQuestions] = useState<ParsedQuestion[]>([]);
  const [parsedUsers, setParsedUsers] = useState<ParsedUser[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep('upload');
    setError('');
    setParsedQuestions([]);
    setParsedUsers([]);
    setImportResult('');
  };

  const handleClose = () => { reset(); onClose(); };

  // ═══════════════════════════════════════════════════════════
  // EXCEL PARSER
  // ═══════════════════════════════════════════════════════════
  const parseExcel = async (file: File) => {
    setError('');
    try {
      await ensureSheetJS();
      const XLSX = (window as any).XLSX;
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (rows.length < 2) { setError('File kosong atau hanya berisi header'); return; }

      const header = rows[0].map((h: any) => String(h).toLowerCase().trim());

      if (type === 'questions') {
        parseQuestionRows(header, rows.slice(1));
      } else {
        parseUserRows(header, rows.slice(1));
      }
    } catch (e: any) {
      setError(`Gagal membaca Excel: ${e.message}`);
    }
  };

  // ═══════════════════════════════════════════════════════════
  // WORD PARSER (Questions only)
  // ═══════════════════════════════════════════════════════════
  const parseWord = async (file: File) => {
    setError('');
    try {
      await ensureMammoth();
      const mammoth = (window as any).mammoth;
      const data = await file.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer: data });
      const html = result.value;

      // Parse pattern: numbered questions with options A-E
      // Format yang didukung:
      // 1. Teks soal
      // A. Opsi A
      // B. Opsi B
      // C. Opsi C *  (<-- asterisk = jawaban benar)
      // D. Opsi D

      const questions: ParsedQuestion[] = [];
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const paragraphs = Array.from(doc.querySelectorAll('p')).map(p => p.innerHTML.trim()).filter(Boolean);

      let currentQ: ParsedQuestion | null = null;

      for (const p of paragraphs) {
        const plain = p.replace(/<[^>]*>/g, '').trim();
        if (!plain) continue;

        // Detect question start: starts with number + dot/paren
        const qMatch = plain.match(/^(\d+)[.)]\s*(.+)/);
        // Detect option: starts with A-E + dot/paren
        const oMatch = plain.match(/^([A-Ea-e])[.)]\s*(.+)/);

        if (qMatch && !oMatch) {
          // Save previous question
          if (currentQ && currentQ.question_text) questions.push(currentQ);
          // Start new question
          const qText = p.replace(/^\d+[.)]\s*/, '');
          currentQ = {
            question_text: qText,
            question_type: 'multiple_choice',
            options: [],
            image_url: null,
            audio_url: null,
          };
        } else if (oMatch && currentQ) {
          const isCorrect = plain.includes('*') || plain.includes('✓') || plain.includes('(benar)');
          const optText = oMatch[2].replace(/[\*✓]/g, '').replace(/\(benar\)/gi, '').trim();
          const optHtml = p.replace(/^[A-Ea-e][.)]\s*/, '').replace(/[\*✓]/g, '').replace(/\(benar\)/gi, '').trim();
          currentQ.options.push({
            option_label: oMatch[1].toUpperCase(),
            option_text: optHtml,
            is_correct: isCorrect ? 1 : 0,
          });
        } else if (currentQ) {
          // Append to question text (multi-paragraph question)
          currentQ.question_text += `<br/>${p}`;
        }
      }
      // Push last question
      if (currentQ && currentQ.question_text) questions.push(currentQ);

      if (questions.length === 0) {
        setError('Tidak ditemukan soal. Format yang didukung:\n1. Teks soal\nA. Opsi A\nB. Opsi B\nC. Opsi C *\nD. Opsi D');
        return;
      }

      setParsedQuestions(questions);
      setStep('preview');
    } catch (e: any) {
      setError(`Gagal membaca Word: ${e.message}`);
    }
  };

  // ═══════════════════════════════════════════════════════════
  // ROW PARSERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Excel format untuk soal:
   * | soal | a | b | c | d | e | jawaban |
   * | Teks soal... | Opsi A | Opsi B | Opsi C | Opsi D | (kosong) | C |
   */
  const parseQuestionRows = (header: string[], rows: any[][]) => {
    // Find column indices
    const colMap: Record<string, number> = {};
    const aliases: Record<string, string[]> = {
      soal: ['soal', 'pertanyaan', 'question', 'teks', 'text'],
      a: ['a', 'opsi_a', 'option_a', 'pilihan_a'],
      b: ['b', 'opsi_b', 'option_b', 'pilihan_b'],
      c: ['c', 'opsi_c', 'option_c', 'pilihan_c'],
      d: ['d', 'opsi_d', 'option_d', 'pilihan_d'],
      e: ['e', 'opsi_e', 'option_e', 'pilihan_e'],
      jawaban: ['jawaban', 'answer', 'kunci', 'key', 'correct'],
      gambar: ['gambar', 'image', 'image_url', 'img'],
      audio: ['audio', 'audio_url', 'sound'],
    };

    for (const [key, names] of Object.entries(aliases)) {
      const idx = header.findIndex(h => names.includes(h.replace(/\s/g, '_')));
      if (idx >= 0) colMap[key] = idx;
    }

    if (colMap.soal === undefined) {
      setError('Kolom "soal" atau "pertanyaan" tidak ditemukan di header');
      return;
    }

    const questions: ParsedQuestion[] = [];
    for (const row of rows) {
      const qText = String(row[colMap.soal] || '').trim();
      if (!qText) continue;

      const correctAnswer = String(row[colMap.jawaban] || '').trim().toUpperCase();
      const options: ParsedQuestion['options'] = [];

      for (const label of ['A', 'B', 'C', 'D', 'E']) {
        const key = label.toLowerCase();
        if (colMap[key] !== undefined) {
          const text = String(row[colMap[key]] || '').trim();
          if (text) {
            options.push({
              option_label: label,
              option_text: text,
              is_correct: label === correctAnswer ? 1 : 0,
            });
          }
        }
      }

      questions.push({
        question_text: qText,
        question_type: options.length > 0 ? 'multiple_choice' : 'essay',
        options,
        image_url: colMap.gambar !== undefined ? String(row[colMap.gambar] || '').trim() || null : null,
        audio_url: colMap.audio !== undefined ? String(row[colMap.audio] || '').trim() || null : null,
      });
    }

    if (questions.length === 0) { setError('Tidak ada soal yang valid ditemukan'); return; }
    setParsedQuestions(questions);
    setStep('preview');
  };

  /**
   * Excel format untuk user:
   * | username | nama | password | role | ruangan | nisn |
   */
  const parseUserRows = (header: string[], rows: any[][]) => {
    const colMap: Record<string, number> = {};
    const aliases: Record<string, string[]> = {
      username: ['username', 'user', 'akun', 'login'],
      nama: ['nama', 'name', 'full_name', 'nama_lengkap'],
      password: ['password', 'pass', 'sandi', 'kata_sandi'],
      role: ['role', 'peran', 'tipe', 'jenis'],
      room_id: ['room_id', 'ruangan', 'room', 'kelas', 'ruang'],
      nisn: ['nisn', 'nis', 'nomor_induk'],
    };

    for (const [key, names] of Object.entries(aliases)) {
      const idx = header.findIndex(h => names.includes(h.replace(/\s/g, '_')));
      if (idx >= 0) colMap[key] = idx;
    }

    if (colMap.username === undefined || colMap.nama === undefined) {
      setError('Kolom "username" dan "nama" wajib ada di header');
      return;
    }

    const users: ParsedUser[] = [];
    for (const row of rows) {
      const username = String(row[colMap.username] || '').trim();
      const nama = String(row[colMap.nama] || '').trim();
      if (!username || !nama) continue;

      users.push({
        username,
        full_name: nama,
        password: colMap.password !== undefined ? String(row[colMap.password] || username).trim() : username,
        role: colMap.role !== undefined ? String(row[colMap.role] || 'student').trim().toLowerCase() : 'student',
        room_id: colMap.room_id !== undefined ? parseInt(String(row[colMap.room_id] || '')) || null : null,
        nisn: colMap.nisn !== undefined ? String(row[colMap.nisn] || '').trim() : '',
      });
    }

    if (users.length === 0) { setError('Tidak ada user yang valid ditemukan'); return; }
    setParsedUsers(users);
    setStep('preview');
  };

  // ═══════════════════════════════════════════════════════════
  // FILE HANDLER
  // ═══════════════════════════════════════════════════════════
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
      await parseExcel(file);
    } else if (ext === 'docx') {
      if (type === 'users') { setError('Import user hanya mendukung file Excel (.xlsx)'); return; }
      await parseWord(file);
    } else {
      setError('Format tidak didukung. Gunakan .xlsx atau .docx');
    }
    e.target.value = '';
  };

  // ═══════════════════════════════════════════════════════════
  // IMPORT TO SERVER
  // ═══════════════════════════════════════════════════════════
  const doImport = async () => {
    setImporting(true);
    setImportResult('');

    try {
      if (type === 'questions' && examId) {
        const payload = parsedQuestions.map((q, i) => ({
          question_text: q.question_text,
          question_type: q.question_type,
          question_order: i + 1,
          image_url: q.image_url,
          audio_url: q.audio_url,
          points: 1,
          options: q.options,
        }));
        const r = await POST(`/api/admin/exams/${examId}/questions/bulk`, { questions: payload });
        if (r.success) {
          setImportResult(`Berhasil mengimport ${parsedQuestions.length} soal!`);
          onSuccess();
        } else {
          setError(r.error || 'Import gagal');
        }
      } else if (type === 'users') {
        const r = await POST('/api/admin/users/bulk', { users: parsedUsers });
        if (r.success) {
          setImportResult(`Berhasil mengimport ${parsedUsers.length} user!`);
          onSuccess();
        } else {
          setError(r.error || 'Import gagal');
        }
      }
    } catch (e: any) {
      setError(e.message || 'Terjadi kesalahan');
    }

    setImporting(false);
  };

  return (
    <Modal open={open} onClose={handleClose} title={type === 'questions' ? 'Import Soal' : 'Import Pengguna'} size="lg">
      {/* Step: Upload */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div className="border-2 border-dashed border-surface-200 rounded-xl p-6 text-center hover:border-brand-400 transition-colors cursor-pointer"
            onClick={() => fileRef.current?.click()}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" className="mx-auto mb-2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            <p className="text-sm font-semibold text-surface-700">Klik untuk memilih file</p>
            <p className="text-xs text-surface-400 mt-1">
              {type === 'questions' ? '.xlsx atau .docx' : '.xlsx'}
            </p>
            <input ref={fileRef} type="file"
              accept={type === 'questions' ? '.xlsx,.xls,.csv,.docx' : '.xlsx,.xls,.csv'}
              className="hidden" onChange={handleFile} />
          </div>

          {error && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 whitespace-pre-line">{error}</div>}

          {/* Format Guide */}
          <div className="bg-surface-50 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-surface-500 uppercase tracking-wide">Format yang Didukung</p>
            {type === 'questions' ? (
              <div className="text-xs text-surface-600 space-y-1.5">
                <p className="font-semibold">Excel (.xlsx):</p>
                <div className="overflow-x-auto">
                  <table className="text-[10px] border border-surface-200 rounded">
                    <thead><tr className="bg-surface-100">
                      <th className="px-2 py-1 border-r border-surface-200">soal</th>
                      <th className="px-2 py-1 border-r border-surface-200">a</th>
                      <th className="px-2 py-1 border-r border-surface-200">b</th>
                      <th className="px-2 py-1 border-r border-surface-200">c</th>
                      <th className="px-2 py-1 border-r border-surface-200">d</th>
                      <th className="px-2 py-1">jawaban</th>
                    </tr></thead>
                    <tbody><tr>
                      <td className="px-2 py-1 border-r border-surface-200">Teks soal...</td>
                      <td className="px-2 py-1 border-r border-surface-200">Opsi A</td>
                      <td className="px-2 py-1 border-r border-surface-200">Opsi B</td>
                      <td className="px-2 py-1 border-r border-surface-200">Opsi C</td>
                      <td className="px-2 py-1 border-r border-surface-200">Opsi D</td>
                      <td className="px-2 py-1 font-bold">C</td>
                    </tr></tbody>
                  </table>
                </div>
                <p className="font-semibold mt-2">Word (.docx):</p>
                <pre className="bg-white p-2 rounded border border-surface-200 text-[10px] font-mono">{`1. Teks soal pertama
A. Opsi A
B. Opsi B
C. Opsi C *
D. Opsi D

2. Teks soal kedua...`}</pre>
                <p className="text-surface-400">Tandai jawaban benar dengan * atau ✓</p>
              </div>
            ) : (
              <div className="text-xs text-surface-600">
                <div className="overflow-x-auto">
                  <table className="text-[10px] border border-surface-200 rounded">
                    <thead><tr className="bg-surface-100">
                      <th className="px-2 py-1 border-r border-surface-200">username</th>
                      <th className="px-2 py-1 border-r border-surface-200">nama</th>
                      <th className="px-2 py-1 border-r border-surface-200">password</th>
                      <th className="px-2 py-1 border-r border-surface-200">nisn</th>
                      <th className="px-2 py-1">room_id</th>
                    </tr></thead>
                    <tbody><tr>
                      <td className="px-2 py-1 border-r border-surface-200">siswa001</td>
                      <td className="px-2 py-1 border-r border-surface-200">Ahmad Fauzi</td>
                      <td className="px-2 py-1 border-r border-surface-200">pass123</td>
                      <td className="px-2 py-1 border-r border-surface-200">0012345678</td>
                      <td className="px-2 py-1">1</td>
                    </tr></tbody>
                  </table>
                </div>
                <p className="text-surface-400 mt-1">Password kosong = username jadi default password</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step: Preview */}
      {step === 'preview' && (
        <div className="space-y-3">
          {importResult ? (
            <div className="px-3 py-3 bg-brand-50 border border-brand-100 rounded-xl text-sm text-brand-700 font-semibold text-center">
              ✓ {importResult}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-surface-800">
                  {type === 'questions' ? `${parsedQuestions.length} soal` : `${parsedUsers.length} user`} ditemukan
                </p>
                <button onClick={reset} className="text-xs text-surface-400 hover:text-surface-600 font-semibold">← Upload ulang</button>
              </div>

              {error && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">{error}</div>}

              {/* Preview Table */}
              <div className="bg-white rounded-xl border border-surface-100 overflow-hidden max-h-[300px] overflow-y-auto">
                {type === 'questions' ? (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-50">
                      <tr className="text-surface-500 uppercase tracking-wider">
                        <th className="text-left px-3 py-2 w-8">#</th>
                        <th className="text-left px-3 py-2">Soal</th>
                        <th className="text-center px-2 py-2">Opsi</th>
                        <th className="text-center px-2 py-2">Kunci</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-50">
                      {parsedQuestions.map((q, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-surface-400">{i + 1}</td>
                          <td className="px-3 py-2 text-surface-800">
                            <div className="line-clamp-2" dangerouslySetInnerHTML={{ __html: q.question_text }} />
                          </td>
                          <td className="text-center px-2 py-2">{q.options.length}</td>
                          <td className="text-center px-2 py-2 font-bold text-brand-600">
                            {q.options.find(o => o.is_correct)?.option_label || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-50">
                      <tr className="text-surface-500 uppercase tracking-wider">
                        <th className="text-left px-3 py-2 w-8">#</th>
                        <th className="text-left px-3 py-2">Username</th>
                        <th className="text-left px-3 py-2">Nama</th>
                        <th className="text-center px-2 py-2">Role</th>
                        <th className="text-left px-3 py-2">NISN</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-50">
                      {parsedUsers.map((u, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 text-surface-400">{i + 1}</td>
                          <td className="px-3 py-2 font-mono text-surface-700">{u.username}</td>
                          <td className="px-3 py-2 text-surface-800">{u.full_name}</td>
                          <td className="text-center px-2 py-2"><Badge color="green">{u.role}</Badge></td>
                          <td className="px-3 py-2 text-surface-500">{u.nisn || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={handleClose}>
              {importResult ? 'Tutup' : 'Batal'}
            </Button>
            {!importResult && (
              <Button size="sm" loading={importing} onClick={doImport}>
                Import {type === 'questions' ? `${parsedQuestions.length} Soal` : `${parsedUsers.length} User`}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
