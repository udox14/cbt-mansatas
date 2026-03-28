'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST, PUT, DEL } from '@/lib/api';
import { Button, Input, Textarea, Select, Modal, Badge, LoadingScreen, EmptyState,
  ToastProvider, useToast, Confirm, Spinner } from '@/components/ui';
import RichEditor from '@/components/admin/RichEditor';
import BulkImport from '@/components/admin/BulkImport';
import { exportExamResults } from '@/lib/export';

// ── Types ────────────────────────────────────────────────────
interface Room { id: number; room_name: string; capacity: number }
interface User { id: number; username: string; full_name: string; role: string; room_id: number | null; nisn: string | null; is_active: number }
interface Exam { id: number; title: string; description: string | null; duration_minutes: number; active_status: string; question_count: number; is_score_visible: number; randomize_questions: number; randomize_options: number; rules_text: string | null; completion_message: string; passing_score: number }
interface Question { id: number; question_text: string; question_type: string; question_order: number; image_url: string | null; audio_url: string | null; options: QOption[] }
interface QOption { id?: number; option_label: string; option_text: string; image_url: string | null; is_correct: number }
interface Token { id: number; room_id: number; token_code: string; is_active: number; room_name: string }
interface Result { user_id: number; full_name: string; nisn: string; username: string; room_name: string; total_questions: number; total_correct: number; total_wrong: number; total_unanswered: number; score: number }
interface Session { id: number; full_name: string; nisn: string; status: string; cheat_warnings: number; started_at: string; last_heartbeat: string; room_name: string }

type Tab = 'exams' | 'users' | 'rooms';

function AdminContent() {
  const { user, loading: authLoading, logout } = useAuth('admin');
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('exams');

  if (authLoading) return <LoadingScreen />;
  if (!user) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'exams', label: 'Ujian' },
    { key: 'users', label: 'Pengguna' },
    { key: 'rooms', label: 'Ruangan' },
  ];

  return (
    <div className="min-h-screen bg-surface-50">
      <header className="bg-white border-b border-surface-100 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-surface-900">Admin Panel</h1>
              <p className="text-xs text-surface-400">{user.full_name}</p>
            </div>
          </div>
          <button onClick={logout} className="text-xs text-surface-400 hover:text-red-500 font-medium">Keluar</button>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-surface-100">
        <div className="max-w-5xl mx-auto flex gap-0 px-4 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap
                ${tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-surface-400 hover:text-surface-600'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-4">
        {tab === 'exams' && <ExamsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'rooms' && <RoomsTab />}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EXAMS TAB
// ═══════════════════════════════════════════════════════════════
function ExamsTab() {
  const { toast } = useToast();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [editExam, setEditExam] = useState<Partial<Exam> | null>(null);
  const [saving, setSaving] = useState(false);
  // Sub-views
  const [viewExamId, setViewExamId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'questions' | 'tokens' | 'results' | 'monitor' | null>(null);

  const fetch = useCallback(async () => {
    const r = await GET<Exam[]>('/api/admin/exams');
    if (r.success) setExams(r.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const saveExam = async () => {
    if (!editExam?.title) { toast('error', 'Judul wajib diisi'); return; }
    setSaving(true);
    const r = editExam.id
      ? await PUT(`/api/admin/exams/${editExam.id}`, editExam)
      : await POST('/api/admin/exams', editExam);
    setSaving(false);
    if (r.success) { toast('success', r.message || 'Berhasil'); setEditExam(null); fetch(); }
    else toast('error', r.error || 'Gagal');
  };

  const statusMap: Record<string, { label: string; color: string }> = {
    draft: { label: 'Draft', color: 'gray' },
    active: { label: 'Aktif', color: 'green' },
    finished: { label: 'Selesai', color: 'blue' },
  };

  if (viewExamId && viewMode === 'questions') return <QuestionsView examId={viewExamId} onBack={() => { setViewExamId(null); setViewMode(null); }} />;
  if (viewExamId && viewMode === 'tokens') return <TokensView examId={viewExamId} onBack={() => { setViewExamId(null); setViewMode(null); }} />;
  if (viewExamId && viewMode === 'results') return <ResultsView examId={viewExamId} onBack={() => { setViewExamId(null); setViewMode(null); }} />;
  if (viewExamId && viewMode === 'monitor') return <MonitorView examId={viewExamId} onBack={() => { setViewExamId(null); setViewMode(null); }} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider">Daftar Ujian</h2>
        <Button size="sm" onClick={() => setEditExam({ duration_minutes: 60, active_status: 'draft' })}>+ Buat Ujian</Button>
      </div>

      {loading ? <div className="py-8 text-center"><Spinner /></div> : exams.length === 0 ? (
        <EmptyState title="Belum ada ujian" desc="Buat ujian pertama Anda" />
      ) : (
        <div className="space-y-2">
          {exams.map(e => (
            <div key={e.id} className="bg-white rounded-xl border border-surface-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-surface-900 truncate">{e.title}</h3>
                    <Badge color={statusMap[e.active_status]?.color || 'gray'}>{statusMap[e.active_status]?.label}</Badge>
                  </div>
                  <p className="text-xs text-surface-400 mt-0.5">{e.duration_minutes} menit · {e.question_count} soal</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditExam(e)}>Edit</Button>
              </div>
              <div className="flex gap-1.5 mt-2 flex-wrap">
                <button onClick={() => { setViewExamId(e.id); setViewMode('questions'); }}
                  className="text-xs px-2 py-1 bg-surface-50 hover:bg-surface-100 rounded-md text-surface-600 font-medium transition-colors">Soal</button>
                <button onClick={() => { setViewExamId(e.id); setViewMode('tokens'); }}
                  className="text-xs px-2 py-1 bg-surface-50 hover:bg-surface-100 rounded-md text-surface-600 font-medium transition-colors">Token</button>
                <button onClick={() => { setViewExamId(e.id); setViewMode('monitor'); }}
                  className="text-xs px-2 py-1 bg-surface-50 hover:bg-surface-100 rounded-md text-surface-600 font-medium transition-colors">Monitor</button>
                <button onClick={() => { setViewExamId(e.id); setViewMode('results'); }}
                  className="text-xs px-2 py-1 bg-surface-50 hover:bg-surface-100 rounded-md text-surface-600 font-medium transition-colors">Hasil</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Exam Editor Modal */}
      <Modal open={!!editExam} onClose={() => setEditExam(null)} title={editExam?.id ? 'Edit Ujian' : 'Buat Ujian'} size="lg">
        {editExam && (
          <div className="space-y-3">
            <Input label="Judul Ujian" value={editExam.title || ''} onChange={e => setEditExam({ ...editExam, title: e.target.value })} />
            <Textarea label="Deskripsi" value={editExam.description || ''} rows={2}
              onChange={e => setEditExam({ ...editExam, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Durasi (menit)" type="number" value={editExam.duration_minutes || 60}
                onChange={e => setEditExam({ ...editExam, duration_minutes: parseInt(e.target.value) })} />
              <Select label="Status" value={editExam.active_status || 'draft'}
                onChange={e => setEditExam({ ...editExam, active_status: e.target.value })}
                options={[{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Aktif' }, { value: 'finished', label: 'Selesai' }]} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Tata Tertib</label>
              <RichEditor value={editExam.rules_text || ''} onChange={v => setEditExam({ ...editExam, rules_text: v })} minHeight={100} placeholder="Tulis tata tertib ujian..." />
            </div>
            <Input label="Pesan Selesai" value={editExam.completion_message || ''} onChange={e => setEditExam({ ...editExam, completion_message: e.target.value })} />
            <Input label="Nilai Minimal Lulus" type="number" value={editExam.passing_score || 0}
              onChange={e => setEditExam({ ...editExam, passing_score: parseFloat(e.target.value) })} />
            <div className="flex flex-wrap gap-4 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!editExam.randomize_questions} onChange={e => setEditExam({ ...editExam, randomize_questions: e.target.checked ? 1 : 0 })} className="rounded" />
                Acak Soal
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!editExam.randomize_options} onChange={e => setEditExam({ ...editExam, randomize_options: e.target.checked ? 1 : 0 })} className="rounded" />
                Acak Opsi
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={!!editExam.is_score_visible} onChange={e => setEditExam({ ...editExam, is_score_visible: e.target.checked ? 1 : 0 })} className="rounded" />
                Tampilkan Skor
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" size="sm" onClick={() => setEditExam(null)}>Batal</Button>
              <Button size="sm" loading={saving} onClick={saveExam}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// QUESTIONS SUB-VIEW
// ═══════════════════════════════════════════════════════════════
function QuestionsView({ examId, onBack }: { examId: number; onBack: () => void }) {
  const { toast } = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editQ, setEditQ] = useState<Partial<Question & { options: QOption[] }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);

  const fetch = useCallback(async () => {
    const r = await GET<Question[]>(`/api/admin/exams/${examId}/questions`);
    if (r.success) setQuestions(r.data || []);
    setLoading(false);
  }, [examId]);

  useEffect(() => { fetch(); }, [fetch]);

  const saveQ = async () => {
    if (!editQ?.question_text) { toast('error', 'Teks soal wajib'); return; }
    setSaving(true);
    const r = editQ.id
      ? await PUT(`/api/admin/questions/${editQ.id}`, editQ)
      : await POST(`/api/admin/exams/${examId}/questions`, { ...editQ, question_order: questions.length + 1 });
    setSaving(false);
    if (r.success) { toast('success', 'Berhasil'); setEditQ(null); fetch(); }
    else toast('error', r.error || 'Gagal');
  };

  const delQ = async () => {
    if (!delTarget) return;
    const r = await DEL(`/api/admin/questions/${delTarget}`);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal');
    setDelTarget(null); fetch();
  };

  const newQuestion = () => setEditQ({
    question_text: '', question_type: 'multiple_choice',
    options: [
      { option_label: 'A', option_text: '', image_url: null, is_correct: 1 },
      { option_label: 'B', option_text: '', image_url: null, is_correct: 0 },
      { option_label: 'C', option_text: '', image_url: null, is_correct: 0 },
      { option_label: 'D', option_text: '', image_url: null, is_correct: 0 },
    ],
  });

  const updateOption = (idx: number, field: string, value: any) => {
    if (!editQ?.options) return;
    const opts = [...editQ.options];
    if (field === 'is_correct') {
      opts.forEach((o, i) => { o.is_correct = i === idx ? 1 : 0; });
    } else {
      (opts[idx] as any)[field] = value;
    }
    setEditQ({ ...editQ, options: opts });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className="text-xs text-surface-400 hover:text-surface-600 font-semibold">← Kembali</button>
        <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider flex-1">Soal ({questions.length})</h2>
        <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>Import Excel/Word</Button>
        <Button size="sm" onClick={newQuestion}>+ Tambah Soal</Button>
      </div>

      {loading ? <div className="py-8 text-center"><Spinner /></div> : questions.length === 0 ? (
        <EmptyState title="Belum ada soal" desc="Tambah soal untuk ujian ini" />
      ) : (
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div key={q.id} className="bg-white rounded-xl border border-surface-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-400 mb-0.5">#{i + 1} · {q.question_type === 'essay' ? 'Esai' : 'Pilihan Ganda'}</p>
                  <div className="text-sm text-surface-800 line-clamp-2" dangerouslySetInnerHTML={{ __html: q.question_text }} />
                  {q.options?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {q.options.map(o => (
                        <span key={o.option_label} className={`text-xs px-1.5 py-0.5 rounded ${o.is_correct ? 'bg-brand-100 text-brand-700 font-bold' : 'bg-surface-50 text-surface-500'}`}>
                          {o.option_label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditQ(q)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDelTarget(q.id)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Question Editor */}
      <Modal open={!!editQ} onClose={() => setEditQ(null)} title={editQ?.id ? 'Edit Soal' : 'Tambah Soal'} size="lg">
        {editQ && (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Teks Soal</label>
              <RichEditor value={editQ.question_text || ''} onChange={v => setEditQ({ ...editQ, question_text: v })} minHeight={120} placeholder="Tulis soal di sini... (mendukung rumus matematika & teks Arab)" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Tipe" value={editQ.question_type || 'multiple_choice'}
                onChange={e => setEditQ({ ...editQ, question_type: e.target.value })}
                options={[{ value: 'multiple_choice', label: 'Pilihan Ganda' }, { value: 'essay', label: 'Esai' }]} />
              <Input label="Poin" type="number" value={(editQ as any).points || 1}
                onChange={e => setEditQ({ ...editQ, points: parseFloat(e.target.value) } as any)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="URL Gambar (R2)" value={editQ.image_url || ''} onChange={e => setEditQ({ ...editQ, image_url: e.target.value })} />
              <Input label="URL Audio (R2)" value={editQ.audio_url || ''} onChange={e => setEditQ({ ...editQ, audio_url: e.target.value })} />
            </div>
            {editQ.question_type === 'multiple_choice' && editQ.options && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Opsi Jawaban</label>
                {editQ.options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="radio" name="correct" checked={!!o.is_correct} onChange={() => updateOption(i, 'is_correct', true)}
                      className="text-brand-600 focus:ring-brand-500" />
                    <span className="text-xs font-bold text-surface-500 w-5">{o.option_label}</span>
                    <input value={o.option_text} onChange={e => updateOption(i, 'option_text', e.target.value)}
                      className="flex-1 px-2 py-1.5 text-sm bg-surface-50 border border-surface-200 rounded-lg outline-none focus:border-brand-500"
                      placeholder={`Opsi ${o.option_label}`} />
                  </div>
                ))}
                {editQ.options.length < 5 && (
                  <button onClick={() => {
                    const labels = 'ABCDE';
                    setEditQ({ ...editQ, options: [...editQ.options!, { option_label: labels[editQ.options!.length], option_text: '', image_url: null, is_correct: 0 }] });
                  }} className="text-xs text-brand-600 font-semibold hover:underline">+ Tambah Opsi</button>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" size="sm" onClick={() => setEditQ(null)}>Batal</Button>
              <Button size="sm" loading={saving} onClick={saveQ}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={delQ} title="Hapus Soal?" message="Soal yang dihapus tidak dapat dikembalikan." />
      <BulkImport type="questions" examId={examId} open={showImport} onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); fetch(); }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TOKENS SUB-VIEW
// ═══════════════════════════════════════════════════════════════
function TokensView({ examId, onBack }: { examId: number; onBack: () => void }) {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetch = useCallback(async () => {
    const r = await GET<Token[]>(`/api/admin/exams/${examId}/tokens`);
    if (r.success) setTokens(r.data || []);
    setLoading(false);
  }, [examId]);

  useEffect(() => { fetch(); }, [fetch]);

  const generate = async () => {
    setGenerating(true);
    const r = await POST(`/api/admin/exams/${examId}/tokens/generate`, {});
    setGenerating(false);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal');
    fetch();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-surface-400 hover:text-surface-600 font-semibold">← Kembali</button>
        <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider flex-1">Token per Ruangan</h2>
        <Button size="sm" loading={generating} onClick={generate}>Generate Token</Button>
      </div>
      {loading ? <div className="py-8 text-center"><Spinner /></div> : tokens.length === 0 ? (
        <EmptyState title="Belum ada token" desc="Generate token untuk setiap ruangan" />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {tokens.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-surface-100 p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-surface-800">{t.room_name}</p>
                <Badge color={t.is_active ? 'green' : 'gray'}>{t.is_active ? 'Aktif' : 'Nonaktif'}</Badge>
              </div>
              <span className="text-2xl font-mono font-extrabold text-brand-700 tracking-wider">{t.token_code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RESULTS SUB-VIEW
// ═══════════════════════════════════════════════════════════════
function ResultsView({ examId, onBack }: { examId: number; onBack: () => void }) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    GET<Result[]>(`/api/admin/exams/${examId}/results`).then(r => {
      if (r.success) setResults(r.data || []);
      setLoading(false);
    });
  }, [examId]);

  const doExport = async () => {
    await exportExamResults(results, `ujian-${examId}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-surface-400 hover:text-surface-600 font-semibold">← Kembali</button>
        <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider flex-1">Hasil ({results.length})</h2>
        {results.length > 0 && <Button size="sm" variant="secondary" onClick={doExport}>Export XLSX</Button>}
      </div>
      {loading ? <div className="py-8 text-center"><Spinner /></div> : results.length === 0 ? (
        <EmptyState title="Belum ada hasil" desc="Peserta yang sudah submit akan tampil di sini" />
      ) : (
        <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-50 text-surface-500 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">#</th>
                  <th className="text-left px-3 py-2">Nama</th>
                  <th className="text-left px-3 py-2">NISN</th>
                  <th className="text-left px-3 py-2">Ruangan</th>
                  <th className="text-center px-2 py-2">Benar</th>
                  <th className="text-center px-2 py-2">Salah</th>
                  <th className="text-center px-2 py-2">Nilai</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-50">
                {results.map((r, i) => (
                  <tr key={i} className="hover:bg-surface-50/50">
                    <td className="px-3 py-2 text-surface-400">{i + 1}</td>
                    <td className="px-3 py-2 font-semibold text-surface-800">{r.full_name}</td>
                    <td className="px-3 py-2 text-surface-500 font-mono">{r.nisn || '-'}</td>
                    <td className="px-3 py-2 text-surface-500">{r.room_name}</td>
                    <td className="text-center px-2 py-2 text-brand-600 font-bold">{r.total_correct}</td>
                    <td className="text-center px-2 py-2 text-red-500">{r.total_wrong}</td>
                    <td className="text-center px-2 py-2 font-bold text-surface-900">{r.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MONITOR SUB-VIEW
// ═══════════════════════════════════════════════════════════════
function MonitorView({ examId, onBack }: { examId: number; onBack: () => void }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const r = await GET<Session[]>(`/api/admin/exams/${examId}/sessions`);
    if (r.success) setSessions(r.data || []);
    setLoading(false);
  }, [examId]);

  useEffect(() => { fetch(); const iv = setInterval(fetch, 10000); return () => clearInterval(iv); }, [fetch]);

  const statusColor = (s: string) => {
    if (s === 'submitted' || s === 'force_submitted') return 'gray';
    const beat = sessions.find(ss => ss.status === s)?.last_heartbeat;
    return 'blue';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-surface-400 hover:text-surface-600 font-semibold">← Kembali</button>
        <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider flex-1">Monitor Live ({sessions.length})</h2>
      </div>
      {loading ? <div className="py-8 text-center"><Spinner /></div> : sessions.length === 0 ? (
        <EmptyState title="Belum ada sesi" />
      ) : (
        <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-50 text-surface-500 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Peserta</th>
                  <th className="text-left px-3 py-2">Ruangan</th>
                  <th className="text-center px-2 py-2">Status</th>
                  <th className="text-center px-2 py-2">Warn</th>
                  <th className="text-left px-3 py-2">Heartbeat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-50">
                {sessions.map(s => {
                  const isOnline = s.status === 'active' && (Date.now() - new Date(s.last_heartbeat).getTime()) < 30000;
                  const isDone = s.status === 'submitted' || s.status === 'force_submitted';
                  return (
                    <tr key={s.id}>
                      <td className="px-3 py-2"><span className="font-semibold">{s.full_name}</span></td>
                      <td className="px-3 py-2 text-surface-500">{s.room_name}</td>
                      <td className="text-center px-2 py-2">
                        <Badge color={isDone ? 'gray' : isOnline ? 'green' : 'red'}>
                          {isDone ? 'Selesai' : isOnline ? 'Online' : 'Offline'}
                        </Badge>
                      </td>
                      <td className="text-center px-2 py-2">{s.cheat_warnings > 0 ? <span className="text-red-600 font-bold">{s.cheat_warnings}</span> : '0'}</td>
                      <td className="px-3 py-2 text-surface-400 font-mono text-[10px]">{new Date(s.last_heartbeat).toLocaleTimeString('id-ID')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// USERS TAB
// ═══════════════════════════════════════════════════════════════
function UsersTab() {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<Partial<User & { password?: string }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [showImport, setShowImport] = useState(false);

  const fetch = useCallback(async () => {
    const [u, r] = await Promise.all([GET<User[]>('/api/admin/users'), GET<Room[]>('/api/admin/rooms')]);
    if (u.success) setUsers(u.data || []);
    if (r.success) setRooms(r.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const save = async () => {
    if (!editUser?.username || !editUser.full_name) { toast('error', 'Data tidak lengkap'); return; }
    if (!editUser.id && !editUser.password) { toast('error', 'Password wajib untuk user baru'); return; }
    setSaving(true);
    const r = editUser.id
      ? await PUT(`/api/admin/users/${editUser.id}`, editUser)
      : await POST('/api/admin/users', editUser);
    setSaving(false);
    if (r.success) { toast('success', r.message || 'Berhasil'); setEditUser(null); fetch(); }
    else toast('error', r.error || 'Gagal');
  };

  const filtered = users.filter(u => !filter || u.role === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5">
          {['', 'admin', 'proctor', 'student'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors
                ${filter === f ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-500 hover:bg-surface-200'}`}>
              {f === '' ? 'Semua' : f === 'admin' ? 'Admin' : f === 'proctor' ? 'Proktor' : 'Siswa'}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>Import Excel</Button>
          <Button size="sm" onClick={() => setEditUser({ role: 'student', is_active: 1 })}>+ Tambah User</Button>
        </div>
      </div>

      {loading ? <div className="py-8 text-center"><Spinner /></div> : (
        <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-50 text-surface-500 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Nama</th>
                  <th className="text-left px-3 py-2">Username</th>
                  <th className="text-center px-2 py-2">Role</th>
                  <th className="text-left px-3 py-2">Ruangan</th>
                  <th className="text-center px-2 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-50">
                {filtered.map(u => (
                  <tr key={u.id} className="hover:bg-surface-50/50">
                    <td className="px-3 py-2 font-semibold text-surface-800">{u.full_name}</td>
                    <td className="px-3 py-2 font-mono text-surface-500">{u.username}</td>
                    <td className="text-center px-2 py-2">
                      <Badge color={u.role === 'admin' ? 'purple' : u.role === 'proctor' ? 'blue' : 'green'}>{u.role}</Badge>
                    </td>
                    <td className="px-3 py-2 text-surface-500">{rooms.find(r => r.id === u.room_id)?.room_name || '-'}</td>
                    <td className="text-center px-2 py-2">
                      <button onClick={() => setEditUser(u)} className="text-brand-600 hover:underline font-semibold">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={editUser?.id ? 'Edit User' : 'Tambah User'}>
        {editUser && (
          <div className="space-y-3">
            <Input label="Nama Lengkap" value={editUser.full_name || ''} onChange={e => setEditUser({ ...editUser, full_name: e.target.value })} />
            <Input label="Username" value={editUser.username || ''} onChange={e => setEditUser({ ...editUser, username: e.target.value })} disabled={!!editUser.id} />
            <Input label={editUser.id ? 'Password Baru (kosongkan jika tidak diubah)' : 'Password'} type="password"
              value={editUser.password || ''} onChange={e => setEditUser({ ...editUser, password: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Role" value={editUser.role || 'student'}
                onChange={e => setEditUser({ ...editUser, role: e.target.value })}
                options={[{ value: 'admin', label: 'Admin' }, { value: 'proctor', label: 'Proktor' }, { value: 'student', label: 'Siswa' }]} />
              <Select label="Ruangan" value={editUser.room_id || ''}
                onChange={e => setEditUser({ ...editUser, room_id: parseInt(e.target.value) || null })}
                options={[{ value: '', label: '-- Tidak ada --' }, ...rooms.map(r => ({ value: r.id, label: r.room_name }))]} />
            </div>
            <Input label="NISN" value={editUser.nisn || ''} onChange={e => setEditUser({ ...editUser, nisn: e.target.value })} />
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" size="sm" onClick={() => setEditUser(null)}>Batal</Button>
              <Button size="sm" loading={saving} onClick={save}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>
      <BulkImport type="users" open={showImport} onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); fetch(); }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ROOMS TAB
// ═══════════════════════════════════════════════════════════════
function RoomsTab() {
  const { toast } = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [editRoom, setEditRoom] = useState<Partial<Room> | null>(null);
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState<number | null>(null);

  const fetch = useCallback(async () => {
    const r = await GET<Room[]>('/api/admin/rooms');
    if (r.success) setRooms(r.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const save = async () => {
    if (!editRoom?.room_name) { toast('error', 'Nama ruangan wajib'); return; }
    setSaving(true);
    const r = editRoom.id
      ? await PUT(`/api/admin/rooms/${editRoom.id}`, editRoom)
      : await POST('/api/admin/rooms', editRoom);
    setSaving(false);
    if (r.success) { toast('success', r.message || 'Berhasil'); setEditRoom(null); fetch(); }
    else toast('error', r.error || 'Gagal');
  };

  const del = async () => {
    if (!delTarget) return;
    const r = await DEL(`/api/admin/rooms/${delTarget}`);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal');
    setDelTarget(null); fetch();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider">Ruangan ({rooms.length})</h2>
        <Button size="sm" onClick={() => setEditRoom({ capacity: 40 })}>+ Tambah</Button>
      </div>

      {loading ? <div className="py-8 text-center"><Spinner /></div> : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-surface-100 p-4 flex items-center justify-between">
              <div>
                <p className="font-bold text-sm text-surface-800">{r.room_name}</p>
                <p className="text-xs text-surface-400">Kapasitas: {r.capacity}</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditRoom(r)}>Edit</Button>
                <button onClick={() => setDelTarget(r.id)} className="p-1.5 text-red-400 hover:text-red-600">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editRoom} onClose={() => setEditRoom(null)} title={editRoom?.id ? 'Edit Ruangan' : 'Tambah Ruangan'} size="sm">
        {editRoom && (
          <div className="space-y-3">
            <Input label="Nama Ruangan" value={editRoom.room_name || ''} onChange={e => setEditRoom({ ...editRoom, room_name: e.target.value })} />
            <Input label="Kapasitas" type="number" value={editRoom.capacity || 40} onChange={e => setEditRoom({ ...editRoom, capacity: parseInt(e.target.value) })} />
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" size="sm" onClick={() => setEditRoom(null)}>Batal</Button>
              <Button size="sm" loading={saving} onClick={save}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={del} title="Hapus Ruangan?" message="Ruangan yang dihapus tidak dapat dikembalikan." />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════
export default function AdminPage() {
  return <ToastProvider><AdminContent /></ToastProvider>;
}
