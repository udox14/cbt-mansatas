'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST, PUT, DEL } from '@/lib/api';
import {
  Button, Input, Textarea, Select, Modal, Badge, LoadingScreen, EmptyState,
  ToastProvider, useToast, Confirm, Spinner,
} from '@/components/ui';
import RichEditor from '@/components/admin/RichEditor';
import BulkImport from '@/components/admin/BulkImport';
import { exportExamResults } from '@/lib/export';
import {
  ClipboardList, Users, School, Shield, LogOut, Menu,
  Plus, FileDown, RefreshCw, Pencil, Trash2, Upload,
  Image, Volume2, X, UserPlus, ChevronLeft, ArrowRight,
} from 'lucide-react';

// ── TYPES ────────────────────────────────────────────────────
interface Room { id: string; room_name: string; capacity: number; jumlah_peserta?: number }
interface Proctor { id: string; username: string; full_name: string; room_id: string | null; room_name?: string }
interface Pendaftar { id: string; nisn: string; nama_lengkap: string; no_pendaftaran: string; ruang_tes: string; jalur: string; asal_sekolah: string; jenis_kelamin: string; tanggal_lahir: string; tanggal_tes: string; sesi_tes: string }
interface Exam { id: string; title: string; description: string | null; duration_minutes: number; active_status: string; question_count: number; is_score_visible: number; randomize_questions: number; randomize_options: number; rules_text: string | null; completion_message: string; passing_score: number }
interface Question { id: string; question_text: string; question_type: string; question_order: number; image_url: string | null; audio_url: string | null; options: QOption[] }
interface QOption { id?: string; option_label: string; option_text: string; image_url: string | null; is_correct: number }
type Page = 'exams' | 'peserta' | 'rooms' | 'pelaksana';
type ExamTab = 'soal' | 'token' | 'monitor' | 'hasil';

// ── SHARED STYLE TOKENS ───────────────────────────────────────
const C = {
  bg: '#f4f6f4',
  white: '#fff',
  border: '#e0e5e0',
  borderLight: '#edf0ed',
  borderMid: '#d4dbd4',
  text: '#1e2e22',
  textMid: '#4a6655',
  textMuted: '#8a9e8d',
  textFaint: '#a8b9aa',
  green: '#2d7a4f',
  greenLight: '#e2ebe3',
  greenBorder: '#b5d9c4',
};

const KemenagLogo = ({ size = 32 }: { size?: number }) => (
  <div style={{ width: size, height: size, borderRadius: '50%', background: C.bg, border: `1.5px solid #cdd4cd`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 100 100" fill="none">
      <g transform="translate(50,50)">
        <polygon points="0,-20 4.5,-10 15,-14 10,-5 20,0 10,5 15,14 4.5,10 0,20 -4.5,10 -15,14 -10,5 -20,0 -10,-5 -15,-14 -4.5,-10" fill="#2d7a4f" />
        <circle cx="0" cy="0" r="9" fill="#fff" /><circle cx="0" cy="0" r="6" fill="#2d7a4f" /><circle cx="0" cy="0" r="3" fill="#fff" />
      </g>
    </svg>
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    active:   { bg: '#e0f0ff', color: '#1a5fa8', label: 'Aktif' },
    draft:    { bg: '#f1f1f0', color: '#6b7c6e', label: 'Draft' },
    finished: { bg: C.greenLight, color: '#2d6644', label: 'Selesai' },
  };
  const s = map[status] || map.draft;
  return <span style={{ background: s.bg, color: s.color, fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', whiteSpace: 'nowrap' }}>{s.label}</span>;
};

// ── FLAT TAB ──────────────────────────────────────────────────
const EXAM_TABS: { key: ExamTab; label: string }[] = [
  { key: 'soal', label: 'Soal' }, { key: 'token', label: 'Token' },
  { key: 'monitor', label: 'Monitor' }, { key: 'hasil', label: 'Hasil' },
];

// ── MAIN ADMIN CONTENT ────────────────────────────────────────
function AdminContent() {
  const { user, loading: authLoading, logout } = useAuth('admin');
  const [page, setPage] = useState<Page>('exams');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  if (authLoading) return <LoadingScreen />;
  if (!user) return null;

  const menu: { key: Page; label: string; icon: React.ReactNode }[] = [
    { key: 'exams',    label: 'Ujian',            icon: <ClipboardList size={14} strokeWidth={2} /> },
    { key: 'peserta',  label: 'Peserta Tes',       icon: <Users size={14} strokeWidth={2} /> },
    { key: 'rooms',    label: 'Ruangan & Proktor', icon: <School size={14} strokeWidth={2} /> },
    { key: 'pelaksana',label: 'Pelaksana Tes',     icon: <Shield size={14} strokeWidth={2} /> },
  ];
  const nav = (p: Page) => { setPage(p); setSidebarOpen(false); };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>

      {/* dot texture */}
      <div className="pointer-events-none fixed inset-0" style={{ backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.3, zIndex: 0 }} />

      {/* mobile overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* ── SIDEBAR ── */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ width: '220px', background: C.white, borderRight: `1.5px solid ${C.border}`, minHeight: '100vh', position: 'relative', zIndex: 50 }}>

        {/* brand */}
        <div style={{ padding: '18px 14px 14px', borderBottom: `1.5px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '11px' }}>
            <KemenagLogo size={34} />
            <div>
              <p style={{ color: C.text, fontSize: '10.5px', fontWeight: 800, lineHeight: 1.2 }}>MAN 1 TASIKMALAYA</p>
              <p style={{ color: '#7a9e86', fontSize: '9px', fontWeight: 600, fontStyle: 'italic', marginTop: '1px' }}>Bangkit · Maju · Juara</p>
            </div>
          </div>
          <div style={{ background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '10px', padding: '7px 10px' }}>
            <p style={{ color: C.text, fontSize: '11.5px', fontWeight: 700 }}>Administrator</p>
            <p style={{ color: '#6b7c6e', fontSize: '10px', marginTop: '1px' }}>{user.username}</p>
          </div>
        </div>

        {/* nav */}
        <nav style={{ flex: 1, padding: '10px 8px' }}>
          <p style={{ color: C.textFaint, fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 6px', marginBottom: '5px' }}>Menu</p>
          {menu.map(m => (
            <button key={m.key} onClick={() => nav(m.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 12px', borderRadius: '11px',
                fontSize: '12.5px', fontWeight: page === m.key ? 700 : 600,
                color: page === m.key ? C.text : '#6b7c6e',
                background: page === m.key ? C.greenLight : 'none',
                border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', marginBottom: '2px',
              }}>
              {m.icon} {m.label}
            </button>
          ))}
        </nav>

        {/* logout */}
        <div style={{ padding: '8px', borderTop: `1.5px solid ${C.border}` }}>
          <button onClick={logout}
            style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 12px', borderRadius: '11px', fontSize: '12.5px', fontWeight: 600, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}>
            <LogOut size={14} strokeWidth={2} /> Keluar
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>

        {/* mobile header */}
        <header className="lg:hidden" style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <Menu size={20} color="#6b7c6e" />
          </button>
          <p style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>{menu.find(m => m.key === page)?.label}</p>
        </header>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {page === 'exams'     && <ExamsPage />}
          {page === 'peserta'   && <PesertaPage />}
          {page === 'rooms'     && <RoomsPage />}
          {page === 'pelaksana' && <PelaksanaPage />}
        </main>

        <footer style={{ textAlign: 'center', padding: '12px', color: '#a8b3a8', fontSize: '11px', fontWeight: 500, borderTop: `1px solid ${C.borderLight}`, background: C.bg }}>
          © 2026 MAN 1 Tasikmalaya — DRUDOX
        </footer>
      </div>
    </div>
  );
}

// ── EXAMS PAGE ────────────────────────────────────────────────
function ExamsPage() {
  const { toast } = useToast();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [editExam, setEditExam] = useState<Partial<Exam> | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [activeTab, setActiveTab] = useState<ExamTab>('soal');
  const [confirmDel, setConfirmDel] = useState<Exam | null>(null);

  const fetchExams = useCallback(async () => {
    const r = await GET<Exam[]>('/api/admin/exams');
    if (r.success) setExams(r.data || []);
    setLoading(false);
  }, []);
  useEffect(() => { fetchExams(); }, [fetchExams]);

  const saveExam = async () => {
    if (!editExam?.title) { toast('error', 'Judul wajib'); return; }
    setSaving(true);
    const r = editExam.id ? await PUT(`/api/admin/exams/${editExam.id}`, editExam) : await POST('/api/admin/exams', editExam);
    setSaving(false);
    if (r.success) { toast('success', 'Berhasil'); setEditExam(null); fetchExams(); } else toast('error', r.error || 'Gagal');
  };
  const deleteExam = async () => {
    if (!confirmDel) return;
    await DEL(`/api/admin/exams/${confirmDel.id}`);
    toast('success', 'Ujian dihapus');
    setConfirmDel(null);
    if (selectedExam?.id === confirmDel.id) setSelectedExam(null);
    fetchExams();
  };

  const openDetail = (exam: Exam) => { setSelectedExam(exam); setActiveTab('soal'); };

  // ── DETAIL VIEW ──
  if (selectedExam) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

      {/* detail header */}
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px' }}>
        {/* breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
          <button onClick={() => setSelectedExam(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#6b7c6e', fontSize: '12px', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <ChevronLeft size={14} strokeWidth={2.5} /> Daftar Ujian
          </button>
          <span style={{ color: C.borderMid }}>›</span>
          <span style={{ color: C.text, fontSize: '12px', fontWeight: 700 }}>{selectedExam.title}</span>
        </div>
        {/* title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
              <span style={{ color: C.text, fontSize: '16px', fontWeight: 900, letterSpacing: '-0.3px' }}>{selectedExam.title}</span>
              <StatusBadge status={selectedExam.active_status} />
            </div>
            <p style={{ color: C.textMuted, fontSize: '11.5px' }}>
              {selectedExam.duration_minutes} menit · {selectedExam.question_count} soal
              {selectedExam.randomize_questions ? ' · Acak soal' : ''}
              {selectedExam.randomize_options ? ' · Acak opsi' : ''}
              {selectedExam.is_score_visible ? ' · Skor tampil' : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button onClick={() => setEditExam(selectedExam)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.bg, color: C.textMid, fontSize: '11.5px', fontWeight: 700, padding: '7px 13px', borderRadius: '10px', border: `1.5px solid ${C.borderMid}`, cursor: 'pointer' }}>
              <Pencil size={12} strokeWidth={2} /> Edit
            </button>
            <button onClick={() => setConfirmDel(selectedExam)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#fef2f2', color: '#dc2626', fontSize: '11.5px', fontWeight: 700, padding: '7px 13px', borderRadius: '10px', border: '1.5px solid #fecaca', cursor: 'pointer' }}>
              <Trash2 size={12} strokeWidth={2} /> Hapus
            </button>
          </div>
        </div>
      </div>

      {/* FLAT TAB STRIP */}
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '0 20px', display: 'flex', gap: 0 }}>
        {EXAM_TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            style={{
              padding: '11px 18px 10px', fontSize: '12.5px', fontWeight: activeTab === t.key ? 800 : 600,
              color: activeTab === t.key ? C.green : C.textMuted,
              background: 'none', border: 'none',
              borderBottom: `2.5px solid ${activeTab === t.key ? C.green : 'transparent'}`,
              marginBottom: '-1.5px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      <div style={{ flex: 1, padding: '16px 20px', overflow: 'auto' }}>
        {activeTab === 'soal'    && <QuestionsView examId={selectedExam.id} />}
        {activeTab === 'token'   && <TokensView examId={selectedExam.id} />}
        {activeTab === 'monitor' && <MonitorView examId={selectedExam.id} />}
        {activeTab === 'hasil'   && <ResultsView examId={selectedExam.id} />}
      </div>
    </div>
  );

  // ── LIST VIEW ──
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* topbar */}
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800, letterSpacing: '-0.3px' }}>Daftar Ujian</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>{exams.length} ujian terdaftar</p>
        </div>
        <button onClick={() => setEditExam({ duration_minutes: 60, active_status: 'draft' })}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
          <Plus size={13} strokeWidth={2.5} /> Buat Ujian
        </button>
      </div>

      {/* list */}
      <div style={{ flex: 1, padding: '16px 20px' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center' }}><Spinner /></div>
        ) : exams.length === 0 ? (
          <EmptyState title="Belum ada ujian" />
        ) : (
          <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '16px', overflow: 'hidden' }}>
            {exams.map((exam, i) => (
              <div key={exam.id}
                onClick={() => openDetail(exam)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '13px 18px',
                  borderBottom: i < exams.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                  cursor: 'pointer',
                  opacity: exam.active_status === 'finished' ? 0.65 : 1,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f9fbf9')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                    <span style={{ color: exam.active_status === 'finished' ? '#6b7c6e' : C.text, fontSize: '13.5px', fontWeight: 800 }}>{exam.title}</span>
                    <StatusBadge status={exam.active_status} />
                  </div>
                  <p style={{ color: exam.active_status === 'finished' ? C.textFaint : C.textMuted, fontSize: '11.5px' }}>
                    {exam.duration_minutes} menit · {exam.question_count} soal
                    {exam.randomize_questions ? ' · Acak soal' : ''}
                    {exam.randomize_options ? ' · Acak opsi' : ''}
                    {exam.is_score_visible ? ' · Skor tampil' : ''}
                  </p>
                </div>
                <ArrowRight size={15} strokeWidth={2} color={C.borderMid} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MODAL: Edit/Buat Ujian */}
      <Modal open={!!editExam} onClose={() => setEditExam(null)} title={editExam?.id ? 'Edit Ujian' : 'Buat Ujian'} size="lg">
        {editExam && (
          <div className="space-y-3">
            <Input label="Judul" value={editExam.title || ''} onChange={e => setEditExam({ ...editExam, title: e.target.value })} />
            <Textarea label="Deskripsi" value={editExam.description || ''} rows={2} onChange={e => setEditExam({ ...editExam, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Durasi (menit)" type="number" value={editExam.duration_minutes || 60} onChange={e => setEditExam({ ...editExam, duration_minutes: parseInt(e.target.value) })} />
              <Select label="Status" value={editExam.active_status || 'draft'} onChange={e => setEditExam({ ...editExam, active_status: e.target.value })}
                options={[{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Aktif' }, { value: 'finished', label: 'Selesai' }]} />
            </div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Tata Tertib</label>
              <RichEditor value={editExam.rules_text || ''} onChange={v => setEditExam({ ...editExam, rules_text: v })} minHeight={80} /></div>
            <Input label="Pesan Selesai" value={editExam.completion_message || ''} onChange={e => setEditExam({ ...editExam, completion_message: e.target.value })} />
            <div className="flex flex-wrap gap-4 text-xs text-gray-600">
              {[{ k: 'randomize_questions', l: 'Acak Soal' }, { k: 'randomize_options', l: 'Acak Opsi' }, { k: 'is_score_visible', l: 'Tampilkan Skor' }].map(c => (
                <label key={c.k} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={!!(editExam as any)[c.k]} onChange={e => setEditExam({ ...editExam, [c.k]: e.target.checked ? 1 : 0 })} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  {c.l}
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

      <Confirm open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={deleteExam}
        title="Hapus Ujian?" message={`Ujian "${confirmDel?.title}" beserta semua soal dan hasil akan dihapus permanen.`} />
    </div>
  );
}

// ── QUESTIONS VIEW ────────────────────────────────────────────
function QuestionsView({ examId }: { examId: string }) {
  const { toast } = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editQ, setEditQ] = useState<Partial<Question & { options: QOption[] }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [uploading, setUploading] = useState('');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

  const fetchQ = useCallback(async () => {
    const r = await GET<Question[]>(`/api/admin/exams/${examId}/questions`);
    if (r.success) setQuestions(r.data || []);
    setLoading(false);
  }, [examId]);
  useEffect(() => { fetchQ(); }, [fetchQ]);

  const saveQ = async () => {
    if (!editQ?.question_text) { toast('error', 'Teks soal wajib'); return; }
    setSaving(true);
    const r = editQ.id
      ? await PUT(`/api/admin/questions/${editQ.id}`, editQ)
      : await POST(`/api/admin/exams/${examId}/questions`, { ...editQ, question_order: questions.length + 1 });
    setSaving(false);
    if (r.success) { toast('success', 'Berhasil'); setEditQ(null); fetchQ(); } else toast('error', r.error || 'Gagal');
  };
  const newQ = () => setEditQ({ question_text: '', question_type: 'multiple_choice', image_url: null, audio_url: null,
    options: 'ABCD'.split('').map((l, i) => ({ option_label: l, option_text: '', image_url: null, is_correct: i === 0 ? 1 : 0 })) });
  const updOpt = (idx: number, f: string, v: any) => {
    if (!editQ?.options) return;
    const o = [...editQ.options];
    if (f === 'is_correct') o.forEach((x, i) => { x.is_correct = i === idx ? 1 : 0; }); else (o[idx] as any)[f] = v;
    setEditQ({ ...editQ, options: o });
  };
  const upload = async (type: 'image' | 'audio', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(type);
    const fd = new FormData(); fd.append('file', file);
    const r = await POST<{ url: string }>('/api/admin/upload', fd);
    setUploading('');
    if (r.success && r.data) { setEditQ(prev => prev ? { ...prev, [type === 'image' ? 'image_url' : 'audio_url']: r.data!.url } : null); toast('success', 'Upload berhasil'); }
    else toast('error', r.error || 'Gagal');
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{questions.length} Soal</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}><Upload size={13} /> Import</Button>
          <Button size="sm" onClick={newQ}><Plus size={13} /> Tambah Soal</Button>
        </div>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : questions.length === 0 ? <EmptyState title="Belum ada soal" />
        : (
          <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
            {questions.map((q, i) => (
              <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 14px', borderBottom: i < questions.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                <span style={{ color: C.textFaint, fontSize: '12px', fontWeight: 700, width: '22px', flexShrink: 0 }}>{i + 1}</span>
                <div className="flex-1 min-w-0" dangerouslySetInnerHTML={{ __html: q.question_text }} style={{ fontSize: '12.5px', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
                <div style={{ display: 'flex', gap: '3px' }}>
                  {q.options?.map(o => (
                    <span key={o.option_label} style={{ background: o.is_correct ? C.greenLight : '#f1f1f0', color: o.is_correct ? '#2d6644' : '#8a9e8d', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px' }}>{o.option_label}</span>
                  ))}
                  {q.image_url && <Image size={12} color="#0ea5e9" style={{ marginLeft: '4px' }} />}
                  {q.audio_url && <Volume2 size={12} color="#8b5cf6" style={{ marginLeft: '4px' }} />}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button onClick={() => setEditQ(q)} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#8a9e8d' }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.greenLight; e.currentTarget.style.color = C.green; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#8a9e8d'; }}>
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => setDelTarget(q.id)} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#8a9e8d' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#dc2626'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#8a9e8d'; }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      <Modal open={!!editQ} onClose={() => setEditQ(null)} title={editQ?.id ? 'Edit Soal' : 'Tambah Soal'} size="lg">
        {editQ && (
          <div className="space-y-3">
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Teks Soal</label>
              <RichEditor value={editQ.question_text || ''} onChange={v => setEditQ({ ...editQ, question_text: v })} minHeight={100} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Gambar</label>
                {editQ.image_url
                  ? <div className="relative"><img src={`${API_URL}${editQ.image_url}`} alt="" className="w-full rounded-lg border max-h-28 object-cover" /><button onClick={() => setEditQ({ ...editQ, image_url: null })} className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"><X size={10} /></button></div>
                  : <label className="flex items-center justify-center gap-1.5 px-3 py-3 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-400 text-xs text-gray-400">{uploading === 'image' ? <Spinner size={14} /> : <><Image size={14} /> Upload Gambar</>}<input type="file" accept="image/*" className="hidden" onChange={e => upload('image', e)} /></label>}
              </div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Audio</label>
                {editQ.audio_url
                  ? <div className="relative"><audio controls className="w-full"><source src={`${API_URL}${editQ.audio_url}`} /></audio><button onClick={() => setEditQ({ ...editQ, audio_url: null })} className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"><X size={10} /></button></div>
                  : <label className="flex items-center justify-center gap-1.5 px-3 py-3 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-400 text-xs text-gray-400">{uploading === 'audio' ? <Spinner size={14} /> : <><Volume2 size={14} /> Upload Audio</>}<input type="file" accept="audio/*" className="hidden" onChange={e => upload('audio', e)} /></label>}
              </div>
            </div>
            {editQ.question_type === 'multiple_choice' && editQ.options && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-500">Opsi Jawaban</label>
                {editQ.options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="radio" name="correct" checked={!!o.is_correct} onChange={() => updOpt(i, 'is_correct', true)} className="text-primary-600" />
                    <span className="text-xs font-semibold text-gray-400 w-4">{o.option_label}</span>
                    <input value={o.option_text} onChange={e => updOpt(i, 'option_text', e.target.value)} placeholder={`Opsi ${o.option_label}`}
                      className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
                  </div>
                ))}
                {editQ.options.length < 5 && (
                  <button onClick={() => setEditQ({ ...editQ, options: [...editQ.options!, { option_label: 'ABCDE'[editQ.options!.length], option_text: '', image_url: null, is_correct: 0 }] })}
                    className="text-xs text-primary-600 font-medium hover:underline">+ Tambah Opsi</button>
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
      <Confirm open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={async () => { if (!delTarget) return; await DEL(`/api/admin/questions/${delTarget}`); setDelTarget(null); fetchQ(); }} title="Hapus Soal?" message="Soal yang dihapus tidak dapat dikembalikan." />
      <BulkImport type="questions" examId={examId} open={showImport} onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); fetchQ(); }} />
    </div>
  );
}

// ── TOKENS VIEW ───────────────────────────────────────────────
function TokensView({ examId }: { examId: string }) {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [gen, setGen] = useState(false);
  const fetchT = useCallback(async () => { const r = await GET(`/api/admin/exams/${examId}/tokens`); if (r.success) setTokens(r.data || []); setLoading(false); }, [examId]);
  useEffect(() => { fetchT(); }, [fetchT]);
  const generate = async () => { setGen(true); const r = await POST(`/api/admin/exams/${examId}/tokens/generate`, {}); setGen(false); toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal'); fetchT(); };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Token per Ruangan</span>
        <Button size="sm" loading={gen} onClick={generate}><RefreshCw size={13} /> Generate</Button>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : tokens.length === 0 ? <EmptyState title="Belum ada token" />
        : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tokens.map((t: any) => (
              <div key={t.id} style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', padding: '14px 16px' }}>
                <p style={{ color: C.textMuted, fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}>{t.room_name}</p>
                <p style={{ color: C.green, fontSize: '22px', fontWeight: 900, letterSpacing: '0.18em', fontVariantNumeric: 'tabular-nums' }}>{t.token_code}</p>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ── MONITOR VIEW ──────────────────────────────────────────────
function MonitorView({ examId }: { examId: string }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchS = useCallback(async () => { const r = await GET(`/api/admin/exams/${examId}/sessions`); if (r.success) setSessions(r.data || []); setLoading(false); }, [examId]);
  useEffect(() => { fetchS(); const iv = setInterval(fetchS, 10000); return () => clearInterval(iv); }, [fetchS]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Sesi Aktif — {sessions.length} peserta</span>
        <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px' }}>Auto-refresh 10s</span>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : sessions.length === 0 ? <EmptyState title="Belum ada sesi" />
        : (
          <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
            {sessions.map((s: any, i: number) => {
              const online = s.status === 'active' && (Date.now() - new Date(s.last_heartbeat).getTime()) < 30000;
              const done = s.status === 'submitted' || s.status === 'force_submitted';
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderBottom: i < sessions.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                  <span style={{ flex: 1, color: C.text, fontSize: '12.5px', fontWeight: 700 }}>{s.full_name}</span>
                  <span style={{ color: '#6b7c6e', fontSize: '11.5px' }}>{s.room_name}</span>
                  <span style={{ background: done ? '#f1f1f0' : online ? C.greenLight : '#fef2f2', color: done ? '#6b7c6e' : online ? '#2d6644' : '#dc2626', fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px' }}>
                    {done ? 'Selesai' : online ? 'Online' : 'Offline'}
                  </span>
                  <span style={{ fontSize: '11px', fontWeight: s.cheat_warnings > 0 ? 700 : 400, color: s.cheat_warnings > 0 ? '#dc2626' : C.textFaint }}>
                    {s.cheat_warnings} pelanggaran
                  </span>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ── RESULTS VIEW ──────────────────────────────────────────────
function ResultsView({ examId }: { examId: string }) {
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { GET(`/api/admin/exams/${examId}/results`).then(r => { if (r.success) setResults(r.data || []); setLoading(false); }); }, [examId]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{results.length} Hasil Masuk</span>
        {results.length > 0 && <Button variant="secondary" size="sm" onClick={() => exportExamResults(results, `ujian-${examId}`)}><FileDown size={13} /> Export Excel</Button>}
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : results.length === 0 ? <EmptyState title="Belum ada hasil" />
        : (
          <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead><tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                {['#', 'Nama', 'NISN', 'Ruangan', 'Benar', 'Salah', 'Nilai'].map((h, i) => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: i >= 4 ? 'center' : 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {results.map((r: any, i: number) => (
                  <tr key={i} style={{ borderBottom: i < results.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                    <td style={{ padding: '10px 14px', color: C.textMuted, fontWeight: 600 }}>{i + 1}</td>
                    <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{r.full_name}</td>
                    <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{r.nisn || '—'}</td>
                    <td style={{ padding: '10px 14px', color: C.textMuted }}>{r.room_name}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', color: C.green, fontWeight: 700 }}>{r.total_correct}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>{r.total_wrong}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', color: C.text, fontWeight: 900 }}>{r.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

// ── PESERTA PAGE ──────────────────────────────────────────────
function PesertaPage() {
  const [data, setData] = useState<Pendaftar[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  useEffect(() => { GET<Pendaftar[]>('/api/admin/pendaftar').then(r => { if (r.success) setData(r.data || []); setLoading(false); }); }, []);
  const filtered = filter ? data.filter(p => p.ruang_tes === filter) : data;
  const rooms = Array.from(new Set(data.map(p => p.ruang_tes).filter(Boolean))).sort();
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px' }}>
        <p style={{ color: C.text, fontSize: '15px', fontWeight: 800, letterSpacing: '-0.3px' }}>Peserta Tes</p>
        <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>{data.length} peserta terdaftar</p>
      </div>
      <div style={{ flex: 1, padding: '16px 20px' }} className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilter('')} style={{ fontSize: '11px', padding: '4px 12px', borderRadius: '999px', fontWeight: 700, border: 'none', cursor: 'pointer', background: !filter ? C.green : C.bg, color: !filter ? '#fff' : '#6b7c6e' }}>Semua</button>
          {rooms.map(r => <button key={r} onClick={() => setFilter(r)} style={{ fontSize: '11px', padding: '4px 12px', borderRadius: '999px', fontWeight: 700, border: 'none', cursor: 'pointer', background: filter === r ? C.green : C.bg, color: filter === r ? '#fff' : '#6b7c6e' }}>{r}</button>)}
        </div>
        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : filtered.length === 0 ? <EmptyState title="Belum ada peserta" />
          : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead><tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                  {['#', 'Nama', 'NISN', 'No. Daftar', 'Ruang', 'Jalur', 'Sesi', 'Tgl Tes'].map(h => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.map((p, i) => (
                    <tr key={p.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                      <td style={{ padding: '10px 14px', color: C.textMuted }}>{i + 1}</td>
                      <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{p.nama_lengkap}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{p.nisn}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted }}>{p.no_pendaftaran || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>{p.ruang_tes ? <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{p.ruang_tes}</span> : <span style={{ color: '#d4dbd4' }}>—</span>}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted }}>{p.jalur}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted }}>{p.sesi_tes || '—'}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted, whiteSpace: 'nowrap' }}>{p.tanggal_tes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  );
}

// ── ROOMS PAGE ────────────────────────────────────────────────
function RoomsPage() {
  const { toast } = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [proctors, setProctors] = useState<Proctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [assignModal, setAssignModal] = useState<Room | null>(null);
  const [selectedProctor, setSelectedProctor] = useState('');
  const fetchData = useCallback(async () => { const [r, p] = await Promise.all([GET<Room[]>('/api/admin/rooms'), GET<Proctor[]>('/api/admin/proctors')]); if (r.success) setRooms(r.data || []); if (p.success) setProctors(p.data || []); setLoading(false); }, []);
  useEffect(() => { fetchData(); }, [fetchData]);
  const syncRooms = async () => { setSyncing(true); const r = await POST('/api/admin/rooms/sync', {}); toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal'); setSyncing(false); fetchData(); };
  const assignProctor = async () => { if (!assignModal || !selectedProctor) return; await PUT(`/api/admin/proctors/${selectedProctor}/assign`, { room_id: assignModal.id }); toast('success', 'Berhasil'); setAssignModal(null); setSelectedProctor(''); fetchData(); };
  const unassignProctor = async (pid: string) => { await PUT(`/api/admin/proctors/${pid}/assign`, { room_id: null }); toast('success', 'Proktor dihapus'); fetchData(); };
  const unassigned = proctors.filter(p => !p.room_id);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><p style={{ color: C.text, fontSize: '15px', fontWeight: 800 }}>Ruangan & Proktor</p><p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>Assign proktor ke ruangan ujian</p></div>
        <Button size="sm" loading={syncing} onClick={syncRooms}><RefreshCw size={13} /> Sinkronkan</Button>
      </div>
      <div style={{ flex: 1, padding: '16px 20px' }}>
        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : rooms.length === 0 ? <EmptyState title="Belum ada ruangan" desc="Klik Sinkronkan dari PMB" />
          : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead><tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                  {['#', 'Ruangan', 'Peserta', 'Proktor', 'Aksi'].map((h, i) => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: i === 2 || i === 4 ? 'center' : 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {rooms.map((r, i) => {
                    const rp = proctors.filter(p => p.room_id === r.id);
                    return (
                      <tr key={r.id} style={{ borderBottom: i < rooms.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                        <td style={{ padding: '10px 14px', color: C.textMuted }}>{i + 1}</td>
                        <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{r.room_name}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}><span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{r.jumlah_peserta || 0}</span></td>
                        <td style={{ padding: '10px 14px' }}>
                          {rp.length === 0 ? <span style={{ color: C.borderMid }}>Belum ada</span>
                            : <div className="space-y-1">{rp.map(p => <div key={p.id} className="flex items-center gap-1.5 text-xs" style={{ color: '#4a6655' }}><span>{p.full_name}</span><button onClick={() => unassignProctor(p.id)} style={{ color: C.borderMid, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}><X size={11} /></button></div>)}</div>}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                          <button onClick={() => { setAssignModal(r); setSelectedProctor(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: C.green, fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                            <UserPlus size={12} /> Assign
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>
      <Modal open={!!assignModal} onClose={() => setAssignModal(null)} title={`Assign Proktor — ${assignModal?.room_name}`} size="sm">
        {unassigned.length === 0
          ? <p className="text-sm text-gray-500">Semua proktor sudah di-assign.</p>
          : <div className="space-y-3">
              <Select label="Pilih Proktor" value={selectedProctor} onChange={e => setSelectedProctor(e.target.value)}
                options={[{ value: '', label: '— Pilih —' }, ...unassigned.map(p => ({ value: p.id, label: `${p.full_name} (${p.username})` }))]} />
              <div className="flex gap-2 justify-end"><Button variant="secondary" size="sm" onClick={() => setAssignModal(null)}>Batal</Button><Button size="sm" disabled={!selectedProctor} onClick={assignProctor}>Assign</Button></div>
            </div>}
      </Modal>
    </div>
  );
}

// ── PELAKSANA PAGE ────────────────────────────────────────────
function PelaksanaPage() {
  const { toast } = useToast();
  const [proctors, setProctors] = useState<Proctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const fetchData = useCallback(async () => { const p = await GET<Proctor[]>('/api/admin/proctors'); if (p.success) setProctors(p.data || []); setLoading(false); }, []);
  useEffect(() => { fetchData(); }, [fetchData]);
  const save = async () => {
    if (!editUser?.username || !editUser.full_name) { toast('error', 'Data tidak lengkap'); return; }
    if (!editUser.id && !editUser.password) { toast('error', 'Password wajib'); return; }
    setSaving(true);
    const r = editUser.id ? await PUT(`/api/admin/users/${editUser.id}`, { ...editUser, role: 'proctor' }) : await POST('/api/admin/users', { ...editUser, role: 'proctor' });
    setSaving(false);
    if (r.success) { toast('success', 'Berhasil'); setEditUser(null); fetchData(); } else toast('error', r.error || 'Gagal');
  };
  const del = async (id: string) => { await DEL(`/api/admin/users/${id}`); toast('success', 'Dihapus'); fetchData(); };
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><p style={{ color: C.text, fontSize: '15px', fontWeight: 800 }}>Pelaksana Tes</p><p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>{proctors.length} proktor terdaftar</p></div>
        <Button size="sm" onClick={() => setEditUser({ role: 'proctor', is_active: 1 })}><Plus size={13} /> Tambah Proktor</Button>
      </div>
      <div style={{ flex: 1, padding: '16px 20px' }}>
        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : proctors.length === 0 ? <EmptyState title="Belum ada proktor" />
          : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead><tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                  {['#', 'Nama', 'Username', 'Ruangan', 'Aksi'].map((h, i) => (
                    <th key={h} style={{ padding: '9px 14px', textAlign: i === 4 ? 'center' : 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {proctors.map((p, i) => (
                    <tr key={p.id} style={{ borderBottom: i < proctors.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                      <td style={{ padding: '10px 14px', color: C.textMuted }}>{i + 1}</td>
                      <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{p.full_name}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{p.username}</td>
                      <td style={{ padding: '10px 14px' }}>{p.room_name ? <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{p.room_name}</span> : <span style={{ color: C.borderMid }}>—</span>}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          <button onClick={() => setEditUser({ id: p.id, username: p.username, full_name: p.full_name })} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#8a9e8d' }}><Pencil size={13} /></button>
                          <button onClick={() => del(p.id)} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: '#8a9e8d' }}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={editUser?.id ? 'Edit Proktor' : 'Tambah Proktor'} size="sm">
        {editUser && <div className="space-y-3">
          <Input label="Nama Lengkap" value={editUser.full_name || ''} onChange={e => setEditUser({ ...editUser, full_name: e.target.value })} />
          <Input label="Username" value={editUser.username || ''} onChange={e => setEditUser({ ...editUser, username: e.target.value })} disabled={!!editUser.id} />
          <Input label={editUser.id ? 'Password Baru (opsional)' : 'Password'} type="password" value={editUser.password || ''} onChange={e => setEditUser({ ...editUser, password: e.target.value })} />
          <div className="flex gap-2 justify-end pt-1"><Button variant="secondary" size="sm" onClick={() => setEditUser(null)}>Batal</Button><Button size="sm" loading={saving} onClick={save}>Simpan</Button></div>
        </div>}
      </Modal>
    </div>
  );
}

export default function AdminPage() { return <ToastProvider><AdminContent /></ToastProvider>; }
