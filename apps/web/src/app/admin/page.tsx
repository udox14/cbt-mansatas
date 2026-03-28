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
interface Room { id: string; room_name: string; capacity: number; jumlah_peserta?: number; proctor_names?: string }
interface CbtUser { id: string; username: string; full_name: string; role: string; room_id: string | null; nisn: string | null; is_active: number; source?: string }
interface Pendaftar { id: string; nisn: string; nama_lengkap: string; no_pendaftaran: string; ruang_tes: string; jalur: string; asal_sekolah: string; jenis_kelamin: string; tanggal_lahir: string; tanggal_tes: string; sesi_tes: string; status_verifikasi: number | null }
interface Exam { id: string; title: string; description: string | null; duration_minutes: number; active_status: string; question_count: number; is_score_visible: number; randomize_questions: number; randomize_options: number; rules_text: string | null; completion_message: string; passing_score: number }
interface Question { id: string; question_text: string; question_type: string; question_order: number; image_url: string | null; audio_url: string | null; options: QOption[] }
interface QOption { id?: string; option_label: string; option_text: string; image_url: string | null; is_correct: number }

type Page = 'pendaftar' | 'exams' | 'rooms' | 'users';

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
function AdminContent() {
  const { user, loading: authLoading, logout } = useAuth('admin');
  const [page, setPage] = useState<Page>('exams');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (authLoading) return <LoadingScreen />;
  if (!user) return null;

  const menu: { key: Page; label: string; icon: string }[] = [
    { key: 'exams', label: 'Ujian', icon: '📝' },
    { key: 'pendaftar', label: 'Peserta PMB', icon: '👥' },
    { key: 'rooms', label: 'Ruangan & Proktor', icon: '🏫' },
    { key: 'users', label: 'Pengguna CBT', icon: '⚙️' },
  ];

  const navigate = (p: Page) => { setPage(p); setSidebarOpen(false); };

  return (
    <div className="min-h-screen bg-surface-50 flex">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-60 bg-white border-r border-surface-100
        transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-surface-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white text-xs font-bold">C</div>
            <div>
              <p className="text-sm font-bold text-surface-900">CBT Admin</p>
              <p className="text-[10px] text-surface-400">{user.full_name}</p>
            </div>
          </div>
        </div>
        <nav className="p-2 space-y-0.5">
          {menu.map(m => (
            <button key={m.key} onClick={() => navigate(m.key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2.5 transition-colors
                ${page === m.key ? 'bg-brand-50 text-brand-700' : 'text-surface-600 hover:bg-surface-50'}`}>
              <span>{m.icon}</span> {m.label}
            </button>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-surface-100">
          <button onClick={logout} className="w-full text-left px-3 py-2 rounded-lg text-sm text-red-500 hover:bg-red-50 font-medium">Keluar</button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <header className="bg-white border-b border-surface-100 px-4 py-3 flex items-center gap-3 lg:hidden">
          <button onClick={() => setSidebarOpen(true)} className="p-1">
            <svg width="20" height="20" fill="none" stroke="#334155" strokeWidth="2"><path d="M3 6h14M3 10h14M3 14h14"/></svg>
          </button>
          <h1 className="text-sm font-bold text-surface-900">{menu.find(m => m.key === page)?.label}</h1>
        </header>

        <main className="p-4 max-w-5xl mx-auto">
          {page === 'exams' && <ExamsPage />}
          {page === 'pendaftar' && <PendaftarPage />}
          {page === 'rooms' && <RoomsPage />}
          {page === 'users' && <UsersPage />}
        </main>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PENDAFTAR PAGE (Read-only dari PMB)
// ══════════════════════════════════════════════════════════════
function PendaftarPage() {
  const [data, setData] = useState<Pendaftar[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    GET<Pendaftar[]>('/api/admin/pendaftar').then(r => { if (r.success) setData(r.data || []); setLoading(false); });
  }, []);

  const filtered = filter ? data.filter(p => p.ruang_tes === filter) : data;
  const rooms = Array.from(new Set(data.map(p => p.ruang_tes).filter(Boolean))).sort();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-surface-800">Peserta PMB ({data.length})</h2>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setFilter('')}
            className={`text-xs px-2.5 py-1 rounded-md font-medium ${!filter ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-500'}`}>
            Semua
          </button>
          {rooms.map(r => (
            <button key={r} onClick={() => setFilter(r)}
              className={`text-xs px-2.5 py-1 rounded-md font-medium ${filter === r ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-500'}`}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="py-8 text-center"><Spinner /></div> : filtered.length === 0 ? (
        <EmptyState title="Belum ada pendaftar" desc="Data muncul setelah pendaftaran PMB dibuka" />
      ) : (
        <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-surface-50 text-surface-500 uppercase tracking-wider">
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-3 py-2">Nama</th>
                <th className="text-left px-3 py-2">NISN</th>
                <th className="text-left px-3 py-2">No. Daftar</th>
                <th className="text-left px-3 py-2">Ruang Tes</th>
                <th className="text-left px-3 py-2">Jalur</th>
                <th className="text-left px-3 py-2">Sesi</th>
                <th className="text-left px-3 py-2">Tgl Tes</th>
              </tr></thead>
              <tbody className="divide-y divide-surface-50">
                {filtered.map((p, i) => (
                  <tr key={p.id} className="hover:bg-surface-50/50">
                    <td className="px-3 py-2 text-surface-400">{i + 1}</td>
                    <td className="px-3 py-2 font-semibold text-surface-800">{p.nama_lengkap}</td>
                    <td className="px-3 py-2 font-mono text-surface-500">{p.nisn}</td>
                    <td className="px-3 py-2 text-surface-500">{p.no_pendaftaran || '-'}</td>
                    <td className="px-3 py-2"><Badge color={p.ruang_tes ? 'blue' : 'gray'}>{p.ruang_tes || 'Belum'}</Badge></td>
                    <td className="px-3 py-2">{p.jalur}</td>
                    <td className="px-3 py-2">{p.sesi_tes || '-'}</td>
                    <td className="px-3 py-2">{p.tanggal_tes || '-'}</td>
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

// ══════════════════════════════════════════════════════════════
// ROOMS PAGE + Proktor Assignment
// ══════════════════════════════════════════════════════════════
function RoomsPage() {
  const { toast } = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [proctors, setProctors] = useState<CbtUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [assignModal, setAssignModal] = useState<Room | null>(null);
  const [selectedProctor, setSelectedProctor] = useState('');

  const fetch = useCallback(async () => {
    const [r, p] = await Promise.all([GET<Room[]>('/api/admin/rooms'), GET<CbtUser[]>('/api/admin/proctors')]);
    if (r.success) setRooms(r.data || []);
    if (p.success) setProctors(p.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const syncRooms = async () => {
    setSyncing(true);
    const r = await POST('/api/admin/rooms/sync');
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal');
    setSyncing(false);
    fetch();
  };

  const assignProctor = async () => {
    if (!assignModal || !selectedProctor) return;
    const r = await PUT(`/api/admin/proctors/${selectedProctor}/assign`, { room_id: assignModal.id });
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal');
    setAssignModal(null);
    setSelectedProctor('');
    fetch();
  };

  const unassignProctor = async (proctorId: string) => {
    const r = await PUT(`/api/admin/proctors/${proctorId}/assign`, { room_id: null });
    toast(r.success ? 'success' : 'error', r.message || 'Gagal');
    fetch();
  };

  // Proctors available (belum di-assign atau di-assign ke ruangan ini)
  const availableProctors = proctors.filter(p => !p.room_id || p.room_id === assignModal?.id);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-bold text-surface-800">Ruangan & Proktor ({rooms.length})</h2>
        <Button size="sm" loading={syncing} onClick={syncRooms}>Sinkronkan dari Data PMB</Button>
      </div>

      {loading ? <div className="py-8 text-center"><Spinner /></div> : rooms.length === 0 ? (
        <EmptyState title="Belum ada ruangan" desc='Klik "Sinkronkan dari Data PMB" untuk mengambil ruangan dari data pendaftar' />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rooms.map(r => {
            const roomProctors = proctors.filter(p => p.room_id === r.id);
            return (
              <div key={r.id} className="bg-white rounded-xl border border-surface-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-sm text-surface-900">{r.room_name}</h3>
                  <Badge color="blue">{r.jumlah_peserta || 0} peserta</Badge>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs text-surface-400">Pengawas:</p>
                  {roomProctors.length === 0 ? (
                    <p className="text-xs text-surface-300 italic">Belum ada proktor</p>
                  ) : (
                    roomProctors.map(p => (
                      <div key={p.id} className="flex items-center justify-between bg-surface-50 rounded-lg px-2.5 py-1.5">
                        <span className="text-xs font-medium text-surface-700">{p.full_name}</span>
                        <button onClick={() => unassignProctor(p.id)} className="text-[10px] text-red-500 hover:underline">Hapus</button>
                      </div>
                    ))
                  )}
                  <button onClick={() => { setAssignModal(r); setSelectedProctor(''); }}
                    className="text-xs text-brand-600 font-semibold hover:underline">+ Tambah Proktor</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Assign Proctor Modal */}
      <Modal open={!!assignModal} onClose={() => setAssignModal(null)} title={`Assign Proktor ke ${assignModal?.room_name}`} size="sm">
        {availableProctors.length === 0 ? (
          <p className="text-sm text-surface-500">Belum ada akun proktor. Buat dulu di menu Pengguna CBT dengan role Proktor.</p>
        ) : (
          <div className="space-y-3">
            <Select label="Pilih Proktor" value={selectedProctor}
              onChange={e => setSelectedProctor(e.target.value)}
              options={[{ value: '', label: '-- Pilih --' }, ...availableProctors.map(p => ({ value: p.id, label: p.full_name }))]} />
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setAssignModal(null)}>Batal</Button>
              <Button size="sm" disabled={!selectedProctor} onClick={assignProctor}>Assign</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// EXAMS PAGE
// ══════════════════════════════════════════════════════════════
function ExamsPage() {
  const { toast } = useToast();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [editExam, setEditExam] = useState<Partial<Exam> | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewExamId, setViewExamId] = useState<string | null>(null);
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
    draft: { label: 'Draft', color: 'gray' }, active: { label: 'Aktif', color: 'green' }, finished: { label: 'Selesai', color: 'blue' },
  };

  if (viewExamId && viewMode === 'questions') return <QuestionsView examId={viewExamId} onBack={() => { setViewExamId(null); setViewMode(null); }} />;
  if (viewExamId && viewMode === 'tokens') return <TokensView examId={viewExamId} onBack={() => { setViewExamId(null); setViewMode(null); }} />;
  if (viewExamId && viewMode === 'results') return <ResultsView examId={viewExamId} onBack={() => { setViewExamId(null); setViewMode(null); }} />;
  if (viewExamId && viewMode === 'monitor') return <MonitorView examId={viewExamId} onBack={() => { setViewExamId(null); setViewMode(null); }} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-surface-800">Daftar Ujian</h2>
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
                {[
                  { mode: 'questions' as const, label: 'Soal' },
                  { mode: 'tokens' as const, label: 'Token' },
                  { mode: 'monitor' as const, label: 'Monitor' },
                  { mode: 'results' as const, label: 'Hasil' },
                ].map(v => (
                  <button key={v.mode} onClick={() => { setViewExamId(e.id); setViewMode(v.mode); }}
                    className="text-xs px-2 py-1 bg-surface-50 hover:bg-surface-100 rounded-md text-surface-600 font-medium transition-colors">{v.label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editExam} onClose={() => setEditExam(null)} title={editExam?.id ? 'Edit Ujian' : 'Buat Ujian'} size="lg">
        {editExam && (
          <div className="space-y-3">
            <Input label="Judul Ujian" value={editExam.title || ''} onChange={e => setEditExam({ ...editExam, title: e.target.value })} />
            <Textarea label="Deskripsi" value={editExam.description || ''} rows={2} onChange={e => setEditExam({ ...editExam, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Durasi (menit)" type="number" value={editExam.duration_minutes || 60} onChange={e => setEditExam({ ...editExam, duration_minutes: parseInt(e.target.value) })} />
              <Select label="Status" value={editExam.active_status || 'draft'} onChange={e => setEditExam({ ...editExam, active_status: e.target.value })}
                options={[{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Aktif' }, { value: 'finished', label: 'Selesai' }]} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Tata Tertib</label>
              <RichEditor value={editExam.rules_text || ''} onChange={v => setEditExam({ ...editExam, rules_text: v })} minHeight={100} placeholder="Tulis tata tertib ujian..." />
            </div>
            <Input label="Pesan Selesai" value={editExam.completion_message || ''} onChange={e => setEditExam({ ...editExam, completion_message: e.target.value })} />
            <Input label="Nilai Minimal Lulus" type="number" value={editExam.passing_score || 0} onChange={e => setEditExam({ ...editExam, passing_score: parseFloat(e.target.value) })} />
            <div className="flex flex-wrap gap-4 text-xs">
              {[
                { key: 'randomize_questions', label: 'Acak Soal' },
                { key: 'randomize_options', label: 'Acak Opsi' },
                { key: 'is_score_visible', label: 'Tampilkan Skor' },
              ].map(c => (
                <label key={c.key} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={!!(editExam as any)[c.key]} onChange={e => setEditExam({ ...editExam, [c.key]: e.target.checked ? 1 : 0 })} className="rounded" />
                  {c.label}
                </label>
              ))}
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

// ══════════════════════════════════════════════════════════════
// QUESTIONS VIEW — hapus input URL manual, pakai upload langsung
// ══════════════════════════════════════════════════════════════
function QuestionsView({ examId, onBack }: { examId: string; onBack: () => void }) {
  const { toast } = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editQ, setEditQ] = useState<Partial<Question & { options: QOption[] }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [uploading, setUploading] = useState('');

  const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

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
    await DEL(`/api/admin/questions/${delTarget}`);
    setDelTarget(null); fetch();
  };

  const newQuestion = () => setEditQ({
    question_text: '', question_type: 'multiple_choice', image_url: null, audio_url: null,
    options: 'ABCD'.split('').map((l, i) => ({ option_label: l, option_text: '', image_url: null, is_correct: i === 0 ? 1 : 0 })),
  });

  const updateOption = (idx: number, field: string, value: any) => {
    if (!editQ?.options) return;
    const opts = [...editQ.options];
    if (field === 'is_correct') opts.forEach((o, i) => { o.is_correct = i === idx ? 1 : 0; });
    else (opts[idx] as any)[field] = value;
    setEditQ({ ...editQ, options: opts });
  };

  // Upload gambar/audio untuk soal
  const uploadFile = async (type: 'image' | 'audio', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(type);
    const fd = new FormData(); fd.append('file', file);
    const r = await POST<{ key: string; url: string }>('/api/admin/upload', fd);
    setUploading('');
    if (r.success && r.data) {
      if (type === 'image') setEditQ(prev => prev ? { ...prev, image_url: r.data!.url } : null);
      else setEditQ(prev => prev ? { ...prev, audio_url: r.data!.url } : null);
      toast('success', 'File berhasil diupload');
    } else {
      toast('error', r.error || 'Upload gagal');
    }
    e.target.value = '';
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
        <EmptyState title="Belum ada soal" />
      ) : (
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div key={q.id} className="bg-white rounded-xl border border-surface-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-surface-400 mb-0.5">#{i + 1}</p>
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
                  {(q.image_url || q.audio_url) && (
                    <div className="flex gap-2 mt-1">
                      {q.image_url && <Badge color="blue">🖼️ Gambar</Badge>}
                      {q.audio_url && <Badge color="purple">🔊 Audio</Badge>}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditQ(q)}>Edit</Button>
                  <button onClick={() => setDelTarget(q.id)} className="p-1.5 text-red-400 hover:text-red-600">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
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
              <RichEditor value={editQ.question_text || ''} onChange={v => setEditQ({ ...editQ, question_text: v })} minHeight={120} placeholder="Tulis soal di sini..." />
            </div>

            {/* Upload gambar & audio — tombol, bukan input URL manual */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Gambar Soal</label>
                {editQ.image_url ? (
                  <div className="relative">
                    <img src={`${API_URL}${editQ.image_url}`} alt="Soal" className="w-full rounded-lg border border-surface-200 max-h-32 object-cover" />
                    <button onClick={() => setEditQ({ ...editQ, image_url: null })}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center">×</button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-surface-200 rounded-lg cursor-pointer hover:border-brand-400 text-xs text-surface-500">
                    {uploading === 'image' ? <Spinner size={14} /> : '📷 Upload Gambar'}
                    <input type="file" accept="image/*" className="hidden" onChange={e => uploadFile('image', e)} />
                  </label>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Audio Soal</label>
                {editQ.audio_url ? (
                  <div className="relative">
                    <audio controls className="w-full"><source src={`${API_URL}${editQ.audio_url}`} /></audio>
                    <button onClick={() => setEditQ({ ...editQ, audio_url: null })}
                      className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center">×</button>
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-surface-200 rounded-lg cursor-pointer hover:border-brand-400 text-xs text-surface-500">
                    {uploading === 'audio' ? <Spinner size={14} /> : '🔊 Upload Audio'}
                    <input type="file" accept="audio/*" className="hidden" onChange={e => uploadFile('audio', e)} />
                  </label>
                )}
              </div>
            </div>

            {/* Options */}
            {editQ.question_type === 'multiple_choice' && editQ.options && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Opsi Jawaban</label>
                {editQ.options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="radio" name="correct" checked={!!o.is_correct} onChange={() => updateOption(i, 'is_correct', true)} className="text-brand-600" />
                    <span className="text-xs font-bold text-surface-500 w-5">{o.option_label}</span>
                    <input value={o.option_text} onChange={e => updateOption(i, 'option_text', e.target.value)}
                      className="flex-1 px-2 py-1.5 text-sm bg-surface-50 border border-surface-200 rounded-lg outline-none focus:border-brand-500" placeholder={`Opsi ${o.option_label}`} />
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

// ══════════════════════════════════════════════════════════════
// TOKENS, RESULTS, MONITOR (ringkas, sama seperti sebelumnya)
// ══════════════════════════════════════════════════════════════

function TokensView({ examId, onBack }: { examId: string; onBack: () => void }) {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetch = useCallback(async () => {
    const r = await GET(`/api/admin/exams/${examId}/tokens`);
    if (r.success) setTokens(r.data || []);
    setLoading(false);
  }, [examId]);
  useEffect(() => { fetch(); }, [fetch]);

  const generate = async () => { setGenerating(true); const r = await POST(`/api/admin/exams/${examId}/tokens/generate`, {}); setGenerating(false); toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal'); fetch(); };

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
          {tokens.map((t: any) => (
            <div key={t.id} className="bg-white rounded-xl border border-surface-100 p-4 flex items-center justify-between">
              <div><p className="text-sm font-semibold text-surface-800">{t.room_name}</p><Badge color={t.is_active ? 'green' : 'gray'}>{t.is_active ? 'Aktif' : 'Nonaktif'}</Badge></div>
              <span className="text-2xl font-mono font-extrabold text-brand-700 tracking-wider">{t.token_code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultsView({ examId, onBack }: { examId: string; onBack: () => void }) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { GET(`/api/admin/exams/${examId}/results`).then(r => { if (r.success) setResults(r.data || []); setLoading(false); }); }, [examId]);
  const doExport = async () => { await exportExamResults(results, `ujian-${examId}`); };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-surface-400 hover:text-surface-600 font-semibold">← Kembali</button>
        <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider flex-1">Hasil ({results.length})</h2>
        {results.length > 0 && <Button size="sm" variant="secondary" onClick={doExport}>Export XLSX</Button>}
      </div>
      {loading ? <div className="py-8 text-center"><Spinner /></div> : results.length === 0 ? <EmptyState title="Belum ada hasil" /> : (
        <div className="bg-white rounded-xl border border-surface-100 overflow-hidden overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-surface-50 text-surface-500 uppercase"><th className="text-left px-3 py-2">#</th><th className="text-left px-3 py-2">Nama</th><th className="text-left px-3 py-2">NISN</th><th className="text-left px-3 py-2">Ruangan</th><th className="text-center px-2 py-2">Benar</th><th className="text-center px-2 py-2">Salah</th><th className="text-center px-2 py-2">Nilai</th></tr></thead>
            <tbody className="divide-y divide-surface-50">
              {results.map((r: any, i: number) => (
                <tr key={i}><td className="px-3 py-2">{i + 1}</td><td className="px-3 py-2 font-semibold">{r.full_name}</td><td className="px-3 py-2 font-mono">{r.nisn || '-'}</td><td className="px-3 py-2">{r.room_name}</td><td className="text-center px-2 py-2 text-brand-600 font-bold">{r.total_correct}</td><td className="text-center px-2 py-2 text-red-500">{r.total_wrong}</td><td className="text-center px-2 py-2 font-bold">{r.score}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MonitorView({ examId, onBack }: { examId: string; onBack: () => void }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const fetch = useCallback(async () => { const r = await GET(`/api/admin/exams/${examId}/sessions`); if (r.success) setSessions(r.data || []); setLoading(false); }, [examId]);
  useEffect(() => { fetch(); const iv = setInterval(fetch, 10000); return () => clearInterval(iv); }, [fetch]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-surface-400 hover:text-surface-600 font-semibold">← Kembali</button>
        <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider flex-1">Monitor Live ({sessions.length})</h2>
      </div>
      {loading ? <div className="py-8 text-center"><Spinner /></div> : sessions.length === 0 ? <EmptyState title="Belum ada sesi" /> : (
        <div className="bg-white rounded-xl border border-surface-100 overflow-hidden overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-surface-50 text-surface-500 uppercase"><th className="text-left px-3 py-2">Peserta</th><th className="text-left px-3 py-2">Ruangan</th><th className="text-center px-2 py-2">Status</th><th className="text-center px-2 py-2">Warn</th><th className="text-left px-3 py-2">Heartbeat</th></tr></thead>
            <tbody className="divide-y divide-surface-50">
              {sessions.map((s: any) => {
                const isOn = s.status === 'active' && (Date.now() - new Date(s.last_heartbeat).getTime()) < 30000;
                const done = s.status === 'submitted' || s.status === 'force_submitted';
                return (
                  <tr key={s.id}><td className="px-3 py-2 font-semibold">{s.full_name}</td><td className="px-3 py-2 text-surface-500">{s.room_name}</td>
                    <td className="text-center px-2 py-2"><Badge color={done ? 'gray' : isOn ? 'green' : 'red'}>{done ? 'Selesai' : isOn ? 'Online' : 'Offline'}</Badge></td>
                    <td className="text-center px-2 py-2">{s.cheat_warnings > 0 ? <span className="text-red-600 font-bold">{s.cheat_warnings}</span> : '0'}</td>
                    <td className="px-3 py-2 text-surface-400 font-mono text-[10px]">{new Date(s.last_heartbeat).toLocaleTimeString('id-ID')}</td></tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// USERS PAGE (cbt_users — proktor & student non-PMB)
// ══════════════════════════════════════════════════════════════
function UsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<CbtUser[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<Partial<CbtUser & { password?: string }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [showImport, setShowImport] = useState(false);

  const fetch = useCallback(async () => {
    const [u, r] = await Promise.all([GET<CbtUser[]>('/api/admin/users'), GET<Room[]>('/api/admin/rooms')]);
    if (u.success) setUsers(u.data || []);
    if (r.success) setRooms(r.data || []);
    setLoading(false);
  }, []);
  useEffect(() => { fetch(); }, [fetch]);

  const save = async () => {
    if (!editUser?.username || !editUser.full_name) { toast('error', 'Data tidak lengkap'); return; }
    if (!editUser.id && !editUser.password) { toast('error', 'Password wajib untuk user baru'); return; }
    setSaving(true);
    const r = editUser.id ? await PUT(`/api/admin/users/${editUser.id}`, editUser) : await POST('/api/admin/users', editUser);
    setSaving(false);
    if (r.success) { toast('success', r.message || 'Berhasil'); setEditUser(null); fetch(); }
    else toast('error', r.error || 'Gagal');
  };

  const filtered = users.filter(u => !filter || u.role === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5">
          {[{ v: '', l: 'Semua' }, { v: 'proctor', l: 'Proktor' }, { v: 'student', l: 'Siswa' }].map(f => (
            <button key={f.v} onClick={() => setFilter(f.v)}
              className={`text-xs px-2.5 py-1 rounded-md font-medium ${filter === f.v ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-500'}`}>{f.l}</button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}>Import Excel</Button>
          <Button size="sm" onClick={() => setEditUser({ role: 'proctor', is_active: 1 })}>+ Tambah User</Button>
        </div>
      </div>

      <p className="text-xs text-surface-400">Untuk pengguna proktor dan siswa non-PMB. Pendaftar PMB otomatis bisa login tanpa perlu ditambahkan di sini.</p>

      {loading ? <div className="py-8 text-center"><Spinner /></div> : filtered.length === 0 ? (
        <EmptyState title="Belum ada pengguna CBT" desc="Tambahkan proktor atau peserta non-PMB" />
      ) : (
        <div className="bg-white rounded-xl border border-surface-100 overflow-hidden overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="bg-surface-50 text-surface-500 uppercase"><th className="text-left px-3 py-2">Nama</th><th className="text-left px-3 py-2">Username</th><th className="text-center px-2 py-2">Role</th><th className="text-left px-3 py-2">Ruangan</th><th className="text-center px-2 py-2">Aksi</th></tr></thead>
            <tbody className="divide-y divide-surface-50">
              {filtered.map(u => (
                <tr key={u.id} className="hover:bg-surface-50/50">
                  <td className="px-3 py-2 font-semibold text-surface-800">{u.full_name}</td>
                  <td className="px-3 py-2 font-mono text-surface-500">{u.username}</td>
                  <td className="text-center px-2 py-2"><Badge color={u.role === 'proctor' ? 'blue' : 'green'}>{u.role === 'proctor' ? 'Proktor' : 'Siswa'}</Badge></td>
                  <td className="px-3 py-2 text-surface-500">{rooms.find(r => r.id === u.room_id)?.room_name || '-'}</td>
                  <td className="text-center px-2 py-2"><button onClick={() => setEditUser(u)} className="text-brand-600 hover:underline font-semibold">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={editUser?.id ? 'Edit User' : 'Tambah User'}>
        {editUser && (
          <div className="space-y-3">
            <Input label="Nama Lengkap" value={editUser.full_name || ''} onChange={e => setEditUser({ ...editUser, full_name: e.target.value })} />
            <Input label="Username" value={editUser.username || ''} onChange={e => setEditUser({ ...editUser, username: e.target.value })} disabled={!!editUser.id} />
            <Input label={editUser.id ? 'Password Baru (kosongkan jika tidak diubah)' : 'Password'} type="password" value={editUser.password || ''} onChange={e => setEditUser({ ...editUser, password: e.target.value })} />
            <Select label="Role" value={editUser.role || 'proctor'} onChange={e => setEditUser({ ...editUser, role: e.target.value })}
              options={[{ value: 'proctor', label: 'Proktor' }, { value: 'student', label: 'Siswa (non-PMB)' }]} />
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

// ══════════════════════════════════════════════════════════════
export default function AdminPage() {
  return <ToastProvider><AdminContent /></ToastProvider>;
}