'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST, PUT, DEL } from '@/lib/api';
import {
  Button, Input, Textarea, Select, Modal, LoadingScreen, EmptyState,
  ToastProvider, useToast, Confirm, Spinner,
} from '@/components/ui';
import RichEditor from '@/components/admin/RichEditor';
import BulkImport from '@/components/admin/BulkImport';
import { exportExamResults } from '@/lib/export';
import {
  ClipboardList, Users, School, Shield, LogOut, Menu,
  Plus, FileDown, RefreshCw, Pencil, Trash2, Upload,
  Image, Volume2, X, UserPlus, ChevronLeft, ArrowRight, Settings,
} from 'lucide-react';

// ── TYPES ────────────────────────────────────────────────────
interface Room { id: string; room_name: string; capacity: number; jumlah_peserta?: number }
interface Proctor { id: string; username: string; full_name: string; role: string; room_id: string | null; room_name?: string }
interface Pendaftar { id: string; nisn: string; nama_lengkap: string; no_pendaftaran: string; ruang_tes: string; jalur: string; asal_sekolah: string; jenis_kelamin: string; tanggal_lahir: string; tanggal_tes: string; sesi_tes: string }
interface Exam { id: string; title: string; description: string | null; duration_minutes: number; active_status: string; question_count: number; is_score_visible: number; randomize_questions: number; randomize_options: number; rules_text: string | null; completion_message: string; passing_score: number; target_jalur: string | null; cheat_limit: number; cheat_action: string; enforce_fullscreen: number }
interface Question { id: string; question_text: string; question_type: string; question_order: number; image_url: string | null; audio_url: string | null; options: QOption[] }
interface QOption { id?: string; option_label: string; option_text: string; image_url: string | null; is_correct: number }
type Page = 'exams' | 'peserta' | 'rooms' | 'pelaksana' | 'settings';
type ExamTab = 'soal' | 'token' | 'monitor' | 'hasil' | 'peserta';

const C = {
  bg: '#f4f6f4', white: '#fff', border: '#e0e5e0', borderLight: '#edf0ed', borderMid: '#d4dbd4',
  text: '#1e2e22', textMid: '#4a6655', textMuted: '#8a9e8d', textFaint: '#a8b9aa',
  green: '#2d7a4f', greenLight: '#e2ebe3', greenBorder: '#b5d9c4',
};

// Jalur yang wajib ikut tes — filter langsung via API query param
const JALUR_TES = 'REGULER';

const KemenagLogo = ({ size = 32 }: { size?: number }) => (
  <img src="/kemenag.png" alt="Kemenag" width={size} height={size} style={{ objectFit: 'contain', flexShrink: 0 }} />
);

const StatusBadge = ({ status }: { status: string }) => {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: '#e0f0ff', color: '#1a5fa8', label: 'Aktif' },
    draft: { bg: '#f1f1f0', color: '#6b7c6e', label: 'Draft' },
    finished: { bg: C.greenLight, color: '#2d6644', label: 'Selesai' },
  };
  const s = map[status] || map.draft;
  return <span style={{ background: s.bg, color: s.color, fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px', whiteSpace: 'nowrap' }}>{s.label}</span>;
};

const EXAM_TABS: { key: ExamTab; label: string }[] = [
  { key: 'soal', label: 'Soal' }, { key: 'token', label: 'Token' },
  { key: 'peserta', label: 'Peserta' },
  { key: 'monitor', label: 'Monitor' }, { key: 'hasil', label: 'Hasil' },
];

// ── TABLE + CARD responsive helpers ──────────────────────────
function TableHead({ cols }: { cols: { label: string; center?: boolean }[] }) {
  return (
    <thead>
      <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
        {cols.map(c => (
          <th key={c.label} style={{ padding: '9px 14px', textAlign: c.center ? 'center' : 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{c.label}</th>
        ))}
      </tr>
    </thead>
  );
}

// ── TANGGAL & HARI ───────────────────────────────────────────
function TanggalHari() {
  const now = new Date();
  const hari = now.toLocaleDateString('id-ID', { weekday: 'long' });
  const tanggal = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div>
      <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, lineHeight: 1.2 }}>{hari}</p>
      <p style={{ color: C.textMuted, fontSize: '11px', fontWeight: 500, marginTop: '1px' }}>{tanggal}</p>
    </div>
  );
}

// ── MAIN ADMIN CONTENT ────────────────────────────────────────
function AdminContent() {
  const { user, loading: authLoading, logout } = useAuth('admin');
  const [page, setPage] = useState<Page>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('admin_page') as Page) || 'exams';
    }
    return 'exams';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('admin_sidebar') === 'collapsed' : false
  );
  const toggleCollapsed = () => setCollapsed(prev => {
    const next = !prev;
    localStorage.setItem('admin_sidebar', next ? 'collapsed' : 'expanded');
    return next;
  });

  if (authLoading) return <LoadingScreen />;
  if (!user) return null;

  const menu: { key: Page; label: string; icon: React.ReactNode }[] = [
    { key: 'exams', label: 'Ujian', icon: <ClipboardList size={14} strokeWidth={2} /> },
    { key: 'peserta', label: 'Peserta Tes', icon: <Users size={14} strokeWidth={2} /> },
    { key: 'rooms', label: 'Ruangan & Proktor', icon: <School size={14} strokeWidth={2} /> },
    { key: 'pelaksana', label: 'Pelaksana Tes', icon: <Shield size={14} strokeWidth={2} /> },
    { key: 'settings', label: 'Pengaturan', icon: <Settings size={14} strokeWidth={2} /> },
  ];
  const nav = (p: Page) => { setPage(p); setSidebarOpen(false); localStorage.setItem('admin_page', p); };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>

      {/* dot texture */}
      <div className="pointer-events-none fixed inset-0" style={{ backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.3, zIndex: 0 }} />

      {/* mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'rgba(30,46,34,0.3)' }} onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── SIDEBAR ── */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col transform transition-all duration-200 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ width: collapsed ? '60px' : '220px', background: C.white, borderRight: `1.5px solid ${C.border}`, minHeight: '100vh', overflow: 'hidden' }}>

        {/* brand */}
        <div style={{ padding: '0 14px', borderBottom: `1.5px solid ${C.border}`, height: '57px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: '9px', flexShrink: 0 }}>
          {!collapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
              <KemenagLogo size={28} />
              <div style={{ minWidth: 0 }}>
                <p style={{ color: C.text, fontSize: '10px', fontWeight: 800, lineHeight: 1.2, whiteSpace: 'nowrap' }}>MAN 1 TASIKMALAYA</p>
                <p style={{ color: '#7a9e86', fontSize: '8.5px', fontWeight: 600, fontStyle: 'italic', marginTop: '1px', whiteSpace: 'nowrap' }}>Bangkit · Jaya · Juara</p>
              </div>
            </div>
          )}
          {collapsed && <KemenagLogo size={28} />}
          {/* toggle collapse button — desktop only */}
          <button onClick={toggleCollapsed} className="hidden lg:flex"
            style={{ width: '26px', height: '26px', borderRadius: '8px', background: C.bg, border: `1.5px solid ${C.borderMid}`, alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {collapsed
                ? <><path d="M9 18l6-6-6-6" /><path d="M3 18l6-6-6-6" /></>
                : <><path d="M15 18l-6-6 6-6" /><path d="M21 18l-6-6 6-6" /></>}
            </svg>
          </button>
        </div>

        {/* nav */}
        <nav style={{ flex: 1, padding: '10px 6px', overflowY: 'auto', overflowX: 'hidden' }}>
          {!collapsed && <p style={{ color: C.textFaint, fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 6px', marginBottom: '5px' }}>Menu</p>}
          {menu.map(m => (
            <button key={m.key} onClick={() => nav(m.key)} title={collapsed ? m.label : undefined}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start',
                gap: '9px', padding: collapsed ? '10px' : '9px 12px', borderRadius: '11px',
                fontSize: '12.5px', fontWeight: page === m.key ? 700 : 600,
                color: page === m.key ? C.text : '#6b7c6e',
                background: page === m.key ? C.greenLight : 'none',
                border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', marginBottom: '2px',
              }}>
              {m.icon}
              {!collapsed && m.label}
            </button>
          ))}
        </nav>

        {/* user info + logout */}
        <div style={{ borderTop: `1.5px solid ${C.border}`, padding: '8px 6px', flexShrink: 0 }}>
          {!collapsed && (
            <div style={{ background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '10px', padding: '8px 10px', marginBottom: '6px' }}>
              <p style={{ color: C.text, fontSize: '12px', fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.full_name || 'Administrator'}</p>
              <p style={{ color: C.textMuted, fontSize: '10px', marginTop: '2px', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.username}</p>
            </div>
          )}
          <button onClick={logout} title={collapsed ? 'Keluar' : undefined}
            style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: '9px', padding: collapsed ? '10px' : '9px 12px', borderRadius: '11px', fontSize: '12.5px', fontWeight: 600, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}>
            <LogOut size={14} strokeWidth={2} />
            {!collapsed && 'Keluar'}
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1 }}>

        {/* header */}
        <header style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '0 20px', height: '57px', display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
          {/* mobile: hamburger */}
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Menu size={20} color="#6b7c6e" />
          </button>
          <TanggalHari />
        </header>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {page === 'exams' && <ExamsPage />}
          {page === 'peserta' && <PesertaPage />}
          {page === 'rooms' && <RoomsPage />}
          {page === 'pelaksana' && <PelaksanaPage />}
          {page === 'settings' && <SettingsPage />}
        </main>

        <footer style={{ textAlign: 'center', padding: '12px', color: '#a8b3a8', fontSize: '11px', fontWeight: 500, borderTop: `1px solid ${C.borderLight}` }}>
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
  const [jalurList, setJalurList] = useState<string[]>([]);

  const fetchExams = useCallback(async () => {
    const [r, j] = await Promise.all([
      GET<Exam[]>('/api/admin/exams'),
      GET<string[]>('/api/admin/pendaftar/jalur'),
    ]);
    if (r.success) setExams(r.data || []);
    if (j.success) setJalurList(j.data || []);
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

  if (selectedExam) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
          <button onClick={() => setSelectedExam(null)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#6b7c6e', fontSize: '12px', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <ChevronLeft size={14} strokeWidth={2.5} /> Daftar Ujian
          </button>
          <span style={{ color: C.borderMid }}>›</span>
          <span style={{ color: C.text, fontSize: '12px', fontWeight: 700 }}>{selectedExam.title}</span>
        </div>
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
              {selectedExam.target_jalur ? ` · Target: ${selectedExam.target_jalur}` : ''}
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

      {/* flat tabs */}
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '0 20px', display: 'flex' }}>
        {EXAM_TABS.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            style={{
              padding: '11px 18px 10px', fontSize: '12.5px',
              fontWeight: activeTab === t.key ? 800 : 600,
              color: activeTab === t.key ? C.green : C.textMuted,
              background: 'none', border: 'none',
              borderBottom: `2.5px solid ${activeTab === t.key ? C.green : 'transparent'}`,
              marginBottom: '-1.5px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: '16px 20px', overflow: 'auto' }}>
        {activeTab === 'soal' && <QuestionsView examId={selectedExam.id} />}
        {activeTab === 'token' && <TokensView examId={selectedExam.id} />}
        {activeTab === 'peserta' && <AssignmentsView examId={selectedExam.id} />}
        {activeTab === 'monitor' && <MonitorView examId={selectedExam.id} />}
        {activeTab === 'hasil' && <ResultsView examId={selectedExam.id} />}
      </div>

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
            {/* Target Jalur */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: C.textMid, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px' }}>Target Peserta (Jalur)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <button type="button" onClick={() => setEditExam({ ...editExam, target_jalur: null })}
                  style={{ padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', border: `1.5px solid ${!editExam.target_jalur ? C.green : C.borderMid}`, background: !editExam.target_jalur ? C.greenLight : C.white, color: !editExam.target_jalur ? C.green : C.textMuted }}>
                  Semua Jalur
                </button>
                {jalurList.map(j => {
                  const selected = (editExam.target_jalur || '').split(',').map(s => s.trim().toLowerCase()).includes(j.toLowerCase());
                  const toggle = () => {
                    const current = editExam.target_jalur ? editExam.target_jalur.split(',').map(s => s.trim()).filter(Boolean) : [];
                    const next = selected ? current.filter(c => c.toLowerCase() !== j.toLowerCase()) : [...current, j];
                    setEditExam({ ...editExam, target_jalur: next.length ? next.join(',') : null });
                  };
                  return (
                    <button key={j} type="button" onClick={toggle}
                      style={{ padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', border: `1.5px solid ${selected ? '#1a5fa8' : C.borderMid}`, background: selected ? '#e0f0ff' : C.white, color: selected ? '#1a5fa8' : C.textMuted }}>
                      {j}
                    </button>
                  );
                })}
              </div>
              {editExam.target_jalur && <p style={{ color: C.textMuted, fontSize: '10.5px', marginTop: '4px' }}>Hanya peserta dengan jalur terpilih yang bisa melihat ujian ini.</p>}
            </div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Tata Tertib</label>
              <RichEditor value={editExam.rules_text || ''} onChange={v => setEditExam({ ...editExam, rules_text: v })} minHeight={80} /></div>
            <Input label="Pesan Selesai" value={editExam.completion_message || ''} onChange={e => setEditExam({ ...editExam, completion_message: e.target.value })} />
            <div className="flex flex-wrap gap-4 text-xs text-gray-600">
              {[{ k: 'randomize_questions', l: 'Acak Soal' }, { k: 'randomize_options', l: 'Acak Opsi' }, { k: 'is_score_visible', l: 'Tampilkan Skor' }, { k: 'enforce_fullscreen', l: 'Wajib Fullscreen' }].map(c => (
                <label key={c.k} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={!!(editExam as any)[c.k]} onChange={e => setEditExam({ ...editExam, [c.k]: e.target.checked ? 1 : 0 })} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  {c.l}
                </label>
              ))}
            </div>
            {/* ── Anti-Cheat ── */}
            <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '12px', padding: '14px' }}>
              <p style={{ color: '#92400e', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '10px' }}>⚠ Pengaturan Anti-Cheat</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#b45309', marginBottom: '5px' }}>Batas Pelanggaran</label>
                  <input type="number" min={1} max={20} value={(editExam as any).cheat_limit ?? 3}
                    onChange={e => setEditExam({ ...editExam, cheat_limit: parseInt(e.target.value) || 3 })}
                    style={{ width: '100%', padding: '8px 10px', fontSize: '13px', fontWeight: 700, border: '1.5px solid #fde68a', borderRadius: '9px', outline: 'none', background: '#fff', color: '#1e2e22' }} />
                  <p style={{ fontSize: '10px', color: '#92400e', marginTop: '3px' }}>Berapa kali pelanggaran sebelum aksi dieksekusi</p>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#b45309', marginBottom: '5px' }}>Aksi Saat Batas Tercapai</label>
                  <select value={(editExam as any).cheat_action ?? 'lock'}
                    onChange={e => setEditExam({ ...editExam, cheat_action: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', fontSize: '12.5px', fontWeight: 600, border: '1.5px solid #fde68a', borderRadius: '9px', outline: 'none', background: '#fff', color: '#1e2e22' }}>
                    <option value="lock">🔒 Kunci Sesi (Proktor buka)</option>
                    <option value="auto_submit">📤 Submit Otomatis</option>
                  </select>
                  <p style={{ fontSize: '10px', color: '#92400e', marginTop: '3px' }}>"Kunci" = proktor bisa buka kembali sesi</p>
                </div>
              </div>
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
      <div style={{ flex: 1, padding: '16px 20px' }}>
        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : exams.length === 0 ? <EmptyState title="Belum ada ujian" />
            : (
              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '16px', overflow: 'hidden' }}>
                {exams.map((exam, i) => (
                  <div key={exam.id} onClick={() => openDetail(exam)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '13px 18px',
                      borderBottom: i < exams.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                      cursor: 'pointer', opacity: exam.active_status === 'finished' ? 0.65 : 1,
                      transition: 'background 0.1s',
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
                        {exam.target_jalur ? ` · ${exam.target_jalur}` : ''}
                      </p>
                    </div>
                    <ArrowRight size={15} strokeWidth={2} color={C.borderMid} />
                  </div>
                ))}
              </div>
            )}
      </div>
      <Modal open={!!editExam} onClose={() => setEditExam(null)} title="Buat Ujian" size="lg">
        {editExam && (
          <div className="space-y-3">
            <Input label="Judul" value={editExam.title || ''} onChange={e => setEditExam({ ...editExam, title: e.target.value })} />
            <Textarea label="Deskripsi" value={editExam.description || ''} rows={2} onChange={e => setEditExam({ ...editExam, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Durasi (menit)" type="number" value={editExam.duration_minutes || 60} onChange={e => setEditExam({ ...editExam, duration_minutes: parseInt(e.target.value) })} />
              <Select label="Status" value={editExam.active_status || 'draft'} onChange={e => setEditExam({ ...editExam, active_status: e.target.value })}
                options={[{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Aktif' }, { value: 'finished', label: 'Selesai' }]} />
            </div>
            {/* Target Jalur */}
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: C.textMid, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px' }}>Target Peserta (Jalur)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                <button type="button" onClick={() => setEditExam({ ...editExam, target_jalur: null })}
                  style={{ padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', border: `1.5px solid ${!editExam.target_jalur ? C.green : C.borderMid}`, background: !editExam.target_jalur ? C.greenLight : C.white, color: !editExam.target_jalur ? C.green : C.textMuted }}>
                  Semua Jalur
                </button>
                {jalurList.map(j => {
                  const selected = (editExam.target_jalur || '').split(',').map(s => s.trim().toLowerCase()).includes(j.toLowerCase());
                  const toggle = () => {
                    const current = editExam.target_jalur ? editExam.target_jalur.split(',').map(s => s.trim()).filter(Boolean) : [];
                    const next = selected ? current.filter(c => c.toLowerCase() !== j.toLowerCase()) : [...current, j];
                    setEditExam({ ...editExam, target_jalur: next.length ? next.join(',') : null });
                  };
                  return (
                    <button key={j} type="button" onClick={toggle}
                      style={{ padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', border: `1.5px solid ${selected ? '#1a5fa8' : C.borderMid}`, background: selected ? '#e0f0ff' : C.white, color: selected ? '#1a5fa8' : C.textMuted }}>
                      {j}
                    </button>
                  );
                })}
              </div>
              {editExam.target_jalur && <p style={{ color: C.textMuted, fontSize: '10.5px', marginTop: '4px' }}>Hanya peserta dengan jalur terpilih yang bisa melihat ujian ini.</p>}
            </div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Tata Tertib</label>
              <RichEditor value={editExam.rules_text || ''} onChange={v => setEditExam({ ...editExam, rules_text: v })} minHeight={80} /></div>
            <Input label="Pesan Selesai" value={editExam.completion_message || ''} onChange={e => setEditExam({ ...editExam, completion_message: e.target.value })} />
            <div className="flex flex-wrap gap-4 text-xs text-gray-600">
              {[{ k: 'randomize_questions', l: 'Acak Soal' }, { k: 'randomize_options', l: 'Acak Opsi' }, { k: 'is_score_visible', l: 'Tampilkan Skor' }, { k: 'enforce_fullscreen', l: 'Wajib Fullscreen' }].map(c => (
                <label key={c.k} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={!!(editExam as any)[c.k]} onChange={e => setEditExam({ ...editExam, [c.k]: e.target.checked ? 1 : 0 })} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  {c.l}
                </label>
              ))}
            </div>
            {/* ── Anti-Cheat ── */}
            <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '12px', padding: '14px' }}>
              <p style={{ color: '#92400e', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '10px' }}>⚠ Pengaturan Anti-Cheat</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#b45309', marginBottom: '5px' }}>Batas Pelanggaran</label>
                  <input type="number" min={1} max={20} value={(editExam as any).cheat_limit ?? 3}
                    onChange={e => setEditExam({ ...editExam, cheat_limit: parseInt(e.target.value) || 3 })}
                    style={{ width: '100%', padding: '8px 10px', fontSize: '13px', fontWeight: 700, border: '1.5px solid #fde68a', borderRadius: '9px', outline: 'none', background: '#fff', color: '#1e2e22' }} />
                  <p style={{ fontSize: '10px', color: '#92400e', marginTop: '3px' }}>Berapa kali pelanggaran sebelum aksi dieksekusi</p>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#b45309', marginBottom: '5px' }}>Aksi Saat Batas Tercapai</label>
                  <select value={(editExam as any).cheat_action ?? 'lock'}
                    onChange={e => setEditExam({ ...editExam, cheat_action: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', fontSize: '12.5px', fontWeight: 600, border: '1.5px solid #fde68a', borderRadius: '9px', outline: 'none', background: '#fff', color: '#1e2e22' }}>
                    <option value="lock">🔒 Kunci Sesi (Proktor buka)</option>
                    <option value="auto_submit">📤 Submit Otomatis</option>
                  </select>
                  <p style={{ fontSize: '10px', color: '#92400e', marginTop: '3px' }}>"Kunci" = proktor bisa buka kembali sesi</p>
                </div>
              </div>
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
  const newQ = () => setEditQ({
    question_text: '', question_type: 'multiple_choice', image_url: null, audio_url: null,
    options: 'ABCD'.split('').map((l, i) => ({ option_label: l, option_text: '', image_url: null, is_correct: i === 0 ? 1 : 0 }))
  });
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
                  <div className="flex-1 min-w-0" style={{ fontSize: '12.5px', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    dangerouslySetInnerHTML={{ __html: q.question_text }} />
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {q.options?.map(o => (
                      <span key={o.option_label} style={{ background: o.is_correct ? C.greenLight : '#f1f1f0', color: o.is_correct ? '#2d6644' : '#8a9e8d', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px' }}>{o.option_label}</span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => setEditQ(q)} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.greenLight; (e.currentTarget as HTMLElement).style.color = C.green; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}>
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setDelTarget(q.id)} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; (e.currentTarget as HTMLElement).style.color = '#dc2626'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}>
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
      <Confirm open={!!delTarget} onClose={() => setDelTarget(null)}
        onConfirm={async () => { if (!delTarget) return; await DEL(`/api/admin/questions/${delTarget}`); setDelTarget(null); fetchQ(); }}
        title="Hapus Soal?" message="Soal yang dihapus tidak dapat dikembalikan." />
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
                <TableHead cols={[{ label: '#' }, { label: 'Nama' }, { label: 'NISN' }, { label: 'Ruangan' }, { label: 'Benar', center: true }, { label: 'Salah', center: true }, { label: 'Nilai', center: true }]} />
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

// ── ASSIGNMENTS VIEW — Assign peserta ke ujian ───────────────
function AssignmentsView({ examId }: { examId: string }) {
  const { toast } = useToast();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    const r = await GET(`/api/admin/exams/${examId}/assignments`);
    if (r.success) setAssignments(r.data || []);
    setLoading(false);
  }, [examId]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = async () => {
    setShowAdd(true); setSearch(''); setSelected(new Set());
    // Fetch all students (pendaftar + cbt_users student)
    const [pmb, manual] = await Promise.all([
      GET<any[]>('/api/admin/pendaftar'),
      GET<any[]>('/api/admin/users?role=student'),
    ]);
    const pmbList = (pmb.success ? (pmb.data || []) : []).map((p: any) => ({
      id: p.id, name: p.nama_lengkap, nisn: p.nisn, jalur: p.jalur || '', user_type: 'pendaftar',
    }));
    const manualList = (manual.success ? (manual.data || []) : []).map((u: any) => ({
      id: u.id, name: u.full_name, nisn: u.nisn || u.username, jalur: '', user_type: 'cbt_user',
    }));
    // Exclude already assigned
    const assignedIds = new Set(assignments.map((a: any) => `${a.user_id}:${a.user_type}`));
    setCandidates([...pmbList, ...manualList].filter(c => !assignedIds.has(`${c.id}:${c.user_type}`)));
  };

  const toggleSelect = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectAll = () => {
    const visible = filteredCandidates.map(c => `${c.id}:${c.user_type}`);
    setSelected(prev => {
      const next = new Set(prev);
      const allSelected = visible.every(k => next.has(k));
      if (allSelected) visible.forEach(k => next.delete(k));
      else visible.forEach(k => next.add(k));
      return next;
    });
  };

  const saveAssignments = async () => {
    const users = Array.from(selected).map(k => {
      const [user_id, user_type] = k.split(':');
      return { user_id, user_type };
    });
    if (!users.length) { toast('error', 'Pilih minimal 1 peserta'); return; }
    const r = await POST(`/api/admin/exams/${examId}/assignments`, { users });
    if (r.success) { toast('success', `${users.length} peserta di-assign`); setShowAdd(false); fetchData(); }
    else toast('error', r.error || 'Gagal');
  };

  const removeAssignment = async (id: string) => {
    await DEL(`/api/admin/exams/${examId}/assignments/${id}`);
    toast('success', 'Dihapus');
    fetchData();
  };

  const filteredCandidates = candidates.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name?.toLowerCase().includes(q) || c.nisn?.toLowerCase().includes(q) || c.jalur?.toLowerCase().includes(q);
  });

  if (loading) return <div className="py-12 text-center"><Spinner /></div>;

  return (
    <div className="space-y-3">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Peserta di-assign — {assignments.length} orang</p>
          <p style={{ color: C.textFaint, fontSize: '10.5px', marginTop: '2px' }}>Peserta yang di-assign bisa mengakses ujian ini terlepas dari filter jalur.</p>
        </div>
        <button onClick={openAdd}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
          <Plus size={13} strokeWidth={2.5} /> Tambah Peserta
        </button>
      </div>

      {assignments.length === 0
        ? <EmptyState title="Belum ada peserta di-assign" />
        : (
          <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <TableHead cols={[{ label: '#' }, { label: 'Nama' }, { label: 'NISN' }, { label: 'Tipe' }, { label: 'Aksi', center: true }]} />
              <tbody>
                {assignments.map((a: any, i: number) => (
                  <tr key={a.id} style={{ borderBottom: i < assignments.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                    <td style={{ padding: '10px 14px', color: C.textMuted }}>{i + 1}</td>
                    <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{a.full_name || '—'}</td>
                    <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{a.nisn || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ background: a.user_type === 'pendaftar' ? '#e2ebe3' : '#fffbeb', color: a.user_type === 'pendaftar' ? '#2d6644' : '#b45309', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>
                        {a.user_type === 'pendaftar' ? 'PMB' : 'Manual'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <button onClick={() => removeAssignment(a.id)}
                        style={{ color: '#dc2626', fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {/* Modal tambah peserta */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Assign Peserta ke Ujian" size="lg">
        <div className="space-y-3">
          <Input placeholder="Cari nama, NISN, atau jalur..." value={search} onChange={e => setSearch(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ color: C.textMuted, fontSize: '11px' }}>{filteredCandidates.length} peserta tersedia · {selected.size} dipilih</p>
            <button onClick={selectAll} style={{ color: C.green, fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
              {filteredCandidates.length > 0 && filteredCandidates.every(c => selected.has(`${c.id}:${c.user_type}`)) ? 'Batal Semua' : 'Pilih Semua'}
            </button>
          </div>
          <div style={{ maxHeight: '320px', overflow: 'auto', border: `1.5px solid ${C.borderMid}`, borderRadius: '12px' }}>
            {filteredCandidates.length === 0
              ? <p style={{ padding: '20px', textAlign: 'center', color: C.textFaint, fontSize: '12px' }}>Tidak ada peserta</p>
              : filteredCandidates.map(c => {
                const key = `${c.id}:${c.user_type}`;
                const checked = selected.has(key);
                return (
                  <div key={key} onClick={() => toggleSelect(key)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', cursor: 'pointer', borderBottom: `1px solid ${C.borderLight}`, background: checked ? C.greenLight : 'transparent' }}>
                    <div style={{ width: '18px', height: '18px', borderRadius: '5px', border: `2px solid ${checked ? C.green : C.borderMid}`, background: checked ? C.green : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ color: C.text, fontSize: '12px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</p>
                      <p style={{ color: C.textFaint, fontSize: '10px', fontFamily: 'monospace' }}>{c.nisn}</p>
                    </div>
                    {c.jalur && <span style={{ background: '#f0e6ff', color: '#6d28d9', fontSize: '9px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px', flexShrink: 0 }}>{c.jalur}</span>}
                  </div>
                );
              })}
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setShowAdd(false)}>Batal</Button>
            <Button size="sm" onClick={saveAssignments}>Assign {selected.size} Peserta</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── PESERTA PAGE ──────────────────────────────────────────────
// Hanya menampilkan peserta jalur REGULER MURNI (jalur yang membutuhkan tes)
function PesertaPage() {
  const { toast } = useToast();
  const [data, setData] = useState<Pendaftar[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRoom, setFilterRoom] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [editPeserta, setEditPeserta] = useState<any | null>(null);
  const [savingPeserta, setSavingPeserta] = useState(false);
  const [assignTarget, setAssignTarget] = useState<any | null>(null);
  const [assignRoom, setAssignRoom] = useState('');
  const [assignJalur, setAssignJalur] = useState('');
  const [savingAssign, setSavingAssign] = useState(false);
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [allJalur, setAllJalur] = useState<string[]>([]);
  const [confirmDelPeserta, setConfirmDelPeserta] = useState<any | null>(null);
  const [deletingPeserta, setDeletingPeserta] = useState(false);

  const savePeserta = async () => {
    if (!editPeserta?.nisn || !editPeserta?.nama_lengkap) { toast('error', 'NISN dan nama wajib diisi'); return; }
    setSavingPeserta(true);
    // Post as a student user — NISN as username, tanggal lahir DDMMYYYY as password
    const r = await POST('/api/admin/users', {
      username: editPeserta.nisn,
      full_name: editPeserta.nama_lengkap,
      // Password: tanggal lahir format DDMMYYYY (misal: 2005-03-22 → 22032005)
      password: editPeserta.tanggal_lahir
        ? (() => { const [y, m, d] = editPeserta.tanggal_lahir.split('-'); return `${d}${m}${y}`; })()
        : editPeserta.nisn,
      role: 'student',
      nisn: editPeserta.nisn,
    });
    setSavingPeserta(false);
    if (r.success) { toast('success', 'Peserta berhasil ditambahkan'); setEditPeserta(null); fetchPeserta(); }
    else toast('error', r.error || 'Gagal');
  };

  const saveAssignRoom = async () => {
    if (!assignTarget) return;
    setSavingAssign(true);
    const sumber = (assignTarget as any)._sumber;
    let r;
    if (sumber === 'manual') {
      // cbt_users: update room_id via PUT /api/admin/users/:id
      r = await PUT(`/api/admin/users/${assignTarget.id}`, {
        full_name: assignTarget.nama_lengkap,
        role: 'student',
        room_id: (allRooms.find(r => r.room_name === assignRoom))?.id || null,
      });
    } else {
      // pendaftar PMB: update ruang_tes + jalur
      const [r1, r2] = await Promise.all([
        PUT(`/api/admin/pendaftar/${assignTarget.id}/ruang`, { ruang_tes: assignRoom || null }),
        assignJalur !== (assignTarget.jalur || '')
          ? PUT(`/api/admin/pendaftar/${assignTarget.id}/jalur`, { jalur: assignJalur })
          : Promise.resolve({ success: true } as any),
      ]);
      r = r1.success && r2.success ? r1 : { success: false, error: r1.error || r2.error };
    }
    setSavingAssign(false);
    if (r.success) { toast('success', 'Data berhasil diubah'); setAssignTarget(null); fetchPeserta(); }
    else toast('error', r.error || 'Gagal');
  };

  const deletePeserta = async () => {
    if (!confirmDelPeserta) return;
    setDeletingPeserta(true);
    const sumber = confirmDelPeserta._sumber;
    let r;
    if (sumber === 'manual') {
      r = await DEL(`/api/admin/users/${confirmDelPeserta.id}`);
    } else {
      r = await DEL(`/api/admin/pendaftar/${confirmDelPeserta.id}`);
    }
    setDeletingPeserta(false);
    if (r.success) { toast('success', 'Peserta berhasil dihapus'); setConfirmDelPeserta(null); fetchPeserta(); }
    else toast('error', r.error || 'Gagal menghapus');
  };

  const fetchPeserta = useCallback(async () => {
    // Ambil dari semua sumber: semua pendaftar PMB + cbt_users (role student) + jalur list
    const [pmb, manual, rooms, jalur] = await Promise.all([
      GET<Pendaftar[]>('/api/admin/pendaftar'),
      GET<any[]>('/api/admin/users?role=student'),
      GET<Room[]>('/api/admin/rooms'),
      GET<string[]>('/api/admin/pendaftar/jalur'),
    ]);
    const pmbData: Pendaftar[] = pmb.success ? (pmb.data || []) : [];
    const roomList = rooms.success ? (rooms.data || []) : [];
    if (rooms.success) setAllRooms(roomList);
    if (jalur.success) setAllJalur(jalur.data || []);
    // Map cbt_users student ke format Pendaftar
    const manualData: Pendaftar[] = (manual.success ? (manual.data || []) : []).map((u: any) => ({
      id: u.id, nisn: u.nisn || u.username, nama_lengkap: u.full_name,
      no_pendaftaran: '—', ruang_tes: roomList.find((r: Room) => r.id === u.room_id)?.room_name || '',
      jalur: 'REGULER', asal_sekolah: '', jenis_kelamin: '',
      tanggal_lahir: '', tanggal_tes: '', sesi_tes: '',
      _sumber: 'manual' as const,
    }));
    // Tag PMB data with source
    const taggedPmb = pmbData.map(p => ({ ...p, _sumber: 'pmb' as const }));
    // Hindari duplikat berdasarkan NISN
    const allNisn = new Set(taggedPmb.map(p => p.nisn));
    const uniqueManual = manualData.filter(p => p.nisn && !allNisn.has(p.nisn));
    setData([...taggedPmb, ...uniqueManual] as any);
    setLoading(false);
  }, []);
  useEffect(() => { fetchPeserta(); }, [fetchPeserta]);

  // derive filter options from data
  const roomOpts = Array.from(new Set(data.map((p: any) => p.ruang_tes).filter(Boolean))).sort() as string[];
  const sesiOpts = Array.from(new Set(data.map((p: any) => p.sesi_tes).filter(Boolean))).sort() as string[];
  const tglOpts = Array.from(new Set(data.map((p: any) => p.tanggal_tes).filter(Boolean))).sort() as string[];
  const [filterSesi, setFilterSesi] = useState('');
  const [filterSumber, setFilterSumber] = useState('');
  const [filterTgl, setFilterTgl] = useState('');
  const [filterJk, setFilterJk] = useState('');
  const [filterJalur, setFilterJalur] = useState('');
  const jalurOpts = Array.from(new Set(data.map((p: any) => p.jalur).filter(Boolean))).sort() as string[];

  const filtered = data.filter((p: any) => {
    if (filterRoom && p.ruang_tes !== filterRoom) return false;
    if (filterSesi && p.sesi_tes !== filterSesi) return false;
    if (filterSumber && p._sumber !== filterSumber) return false;
    if (filterTgl && p.tanggal_tes !== filterTgl) return false;
    if (filterJk && (p.jenis_kelamin || '').toUpperCase() !== filterJk) return false;
    if (filterJalur && (p.jalur || '').toUpperCase() !== filterJalur.toUpperCase()) return false;
    return true;
  });

  const selStyle = (val: string): React.CSSProperties => ({
    padding: '7px 11px', fontSize: '12px', fontWeight: 600,
    background: C.white, border: `1.5px solid ${val ? C.green : C.borderMid}`,
    borderRadius: '10px', outline: 'none', color: val ? C.text : C.textMuted,
    cursor: 'pointer', fontFamily: 'inherit',
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800, letterSpacing: '-0.3px' }}>Peserta Tes</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>{filtered.length} dari {data.length} peserta</p>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => setShowImport(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.bg, color: C.textMid, fontSize: '12px', fontWeight: 700, padding: '8px 13px', borderRadius: '10px', border: `1.5px solid ${C.borderMid}`, cursor: 'pointer' }}>
            <Upload size={13} /> Import
          </button>
          <button onClick={() => setEditPeserta({ jalur: JALUR_TES })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 13px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
            <Plus size={13} strokeWidth={2.5} /> Tambah
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: '16px 20px' }} className="space-y-3">
        {/* FILTER BAR */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)} style={selStyle(filterRoom)}>
            <option value="">Semua Ruangan</option>
            {roomOpts.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filterSesi} onChange={e => setFilterSesi(e.target.value)} style={selStyle(filterSesi)}>
            <option value="">Semua Sesi</option>
            {sesiOpts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterTgl} onChange={e => setFilterTgl(e.target.value)} style={selStyle(filterTgl)}>
            <option value="">Semua Tanggal</option>
            {tglOpts.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterSumber} onChange={e => setFilterSumber(e.target.value)} style={selStyle(filterSumber)}>
            <option value="">Semua Sumber</option>
            <option value="pmb">PMB</option>
            <option value="manual">Manual</option>
          </select>
          <select value={filterJk} onChange={e => setFilterJk(e.target.value)} style={selStyle(filterJk)}>
            <option value="">Semua JK</option>
            <option value="L">Laki-laki</option>
            <option value="P">Perempuan</option>
          </select>
          <select value={filterJalur} onChange={e => setFilterJalur(e.target.value)} style={selStyle(filterJalur)}>
            <option value="">Semua Jalur</option>
            {jalurOpts.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
          {(filterRoom || filterSesi || filterTgl || filterSumber || filterJk || filterJalur) && (
            <button onClick={() => { setFilterRoom(''); setFilterSesi(''); setFilterTgl(''); setFilterSumber(''); setFilterJk(''); setFilterJalur(''); }}
              style={{ fontSize: '11.5px', fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '10px', padding: '7px 12px', cursor: 'pointer' }}>
              Reset
            </button>
          )}
        </div>

        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : filtered.length === 0 ? <EmptyState title="Belum ada peserta" desc="Hanya peserta jalur Reguler Murni yang ditampilkan" />
            : (
              <>
                {/* DESKTOP: table */}
                <div className="hidden md:block" style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <TableHead cols={[{ label: '#' }, { label: 'Nama' }, { label: 'NISN' }, { label: 'JK', center: true }, { label: 'Jalur' }, { label: 'Ruang' }, { label: 'Sesi' }, { label: 'Tgl Tes' }, { label: 'Sumber' }, { label: 'Aksi', center: true }, { label: '', center: true }]} />
                    <tbody>
                      {filtered.map((p, i) => (
                        <tr key={p.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                          <td style={{ padding: '10px 14px', color: C.textMuted }}>{i + 1}</td>
                          <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{p.nama_lengkap}</td>
                          <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{p.nisn}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', color: C.textMuted, fontWeight: 600 }}>{p.jenis_kelamin ? (p.jenis_kelamin === 'L' || p.jenis_kelamin?.toUpperCase() === 'LAKI-LAKI' ? 'L' : 'P') : '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            {p.jalur
                              ? <span style={{ background: '#f0e6ff', color: '#6d28d9', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{p.jalur}</span>
                              : <span style={{ color: C.borderMid }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            {p.ruang_tes
                              ? <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{p.ruang_tes}</span>
                              : <span style={{ color: C.borderMid }}>—</span>}
                          </td>
                          <td style={{ padding: '10px 14px', color: C.textMuted }}>{p.sesi_tes || '—'}</td>
                          <td style={{ padding: '10px 14px', color: C.textMuted, whiteSpace: 'nowrap' }}>{p.tanggal_tes || '—'}</td>
                          <td style={{ padding: '10px 14px' }}>
                            {(p as any)._sumber === 'manual'
                              ? <span style={{ background: '#fffbeb', color: '#b45309', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>Manual</span>
                              : <span style={{ background: '#e2ebe3', color: '#2d6644', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>PMB</span>}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <button onClick={() => { setAssignTarget(p); setAssignRoom((p as any).ruang_tes || ''); setAssignJalur((p as any).jalur || ''); }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: C.green, fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                              <UserPlus size={12} /> {p.ruang_tes ? 'Pindah' : 'Assign'}
                            </button>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <button onClick={() => setConfirmDelPeserta(p)}
                              style={{ width: '28px', height: '28px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; (e.currentTarget as HTMLElement).style.color = '#dc2626'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}>
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* MOBILE: cards — compact & consistent */}
                <div className="md:hidden flex flex-col gap-2">
                  {(filtered as any[]).map((p: any) => (
                    <div key={p.id} style={{ background: C.white, border: `1.5px solid ${p.ruang_tes ? C.borderMid : C.borderMid}`, borderRadius: '14px', padding: '12px 14px' }}>
                      {/* Row 1: nama + ruangan badge */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                        <p style={{ color: C.text, fontSize: '13.5px', fontWeight: 800, lineHeight: 1.2, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nama_lengkap}</p>
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                          {p.ruang_tes
                            ? <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px', whiteSpace: 'nowrap' }}>{p.ruang_tes}</span>
                            : <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px' }}>Belum ada ruangan</span>}
                          {p._sumber === 'manual'
                            ? <span style={{ background: '#fffbeb', color: '#b45309', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px' }}>Manual</span>
                            : <span style={{ background: '#e2ebe3', color: '#2d6644', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px' }}>PMB</span>}
                        </div>
                      </div>
                      {/* Row 2: sesi + tgl + jk */}
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                        {p.sesi_tes && <span style={{ color: C.textMuted, fontSize: '11px' }}>{p.sesi_tes}</span>}
                        {p.tanggal_tes && <span style={{ color: C.textMuted, fontSize: '11px' }}>{p.tanggal_tes}</span>}
                        {p.jenis_kelamin && <span style={{ color: C.textMuted, fontSize: '11px' }}>{p.jenis_kelamin === 'L' || p.jenis_kelamin === 'LAKI-LAKI' ? 'L' : 'P'}</span>}
                      </div>
                      {/* Row 3: actions — full width, consistent */}
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => { setAssignTarget(p); setAssignRoom(p.ruang_tes || ''); setAssignJalur((p as any).jalur || ''); }}
                          style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px', color: C.green, background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '9px', padding: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                          <UserPlus size={13} /> {p.ruang_tes ? 'Pindah Ruangan' : 'Assign Ruangan'}
                        </button>
                        <button onClick={() => setConfirmDelPeserta(p)}
                          style={{ width: '36px', height: '36px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9px', background: '#fef2f2', border: '1.5px solid #fecaca', cursor: 'pointer', color: '#dc2626', flexShrink: 0 }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
      </div>

      {/* Modal tambah peserta manual */}
      <Modal open={!!editPeserta} onClose={() => setEditPeserta(null)} title="Tambah Peserta" size="sm">
        {editPeserta && (
          <div className="space-y-3">
            <Input label="NISN" value={editPeserta.nisn || ''} onChange={e => setEditPeserta({ ...editPeserta, nisn: e.target.value })} placeholder="0012345678" />
            <Input label="Nama Lengkap" value={editPeserta.nama_lengkap || ''} onChange={e => setEditPeserta({ ...editPeserta, nama_lengkap: e.target.value })} />
            <Input label="Tanggal Lahir" type="date" value={editPeserta.tanggal_lahir || ''} onChange={e => setEditPeserta({ ...editPeserta, tanggal_lahir: e.target.value })} />
            <Select label="Jenis Kelamin" value={editPeserta.jenis_kelamin || ''} onChange={e => setEditPeserta({ ...editPeserta, jenis_kelamin: e.target.value })}
              options={[{ value: '', label: '— Pilih —' }, { value: 'L', label: 'Laki-laki' }, { value: 'P', label: 'Perempuan' }]} />
            <p style={{ color: C.textFaint, fontSize: '11px' }}>Password otomatis: tanggal lahir format DDMMYYYY.</p>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="secondary" size="sm" onClick={() => setEditPeserta(null)}>Batal</Button>
              <Button size="sm" loading={savingPeserta} onClick={savePeserta}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal assign ruangan + jalur */}
      <Modal open={!!assignTarget} onClose={() => setAssignTarget(null)} title={`Edit Peserta — ${assignTarget?.nama_lengkap}`} size="sm">
        {assignTarget && (
          <div className="space-y-3">
            <Select label="Ruangan" value={assignRoom} onChange={e => setAssignRoom(e.target.value)}
              options={[
                { value: '', label: '— Tanpa Ruangan —' },
                ...allRooms.map(r => ({ value: r.room_name, label: r.room_name })),
              ]} />
            {(assignTarget as any)._sumber !== 'manual' && (
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: C.textMid, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px' }}>Jalur / Tag</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {allJalur.map(j => (
                    <button key={j} type="button" onClick={() => setAssignJalur(j)}
                      style={{
                        padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer',
                        border: `1.5px solid ${assignJalur === j ? '#1a5fa8' : C.borderMid}`,
                        background: assignJalur === j ? '#e0f0ff' : C.white,
                        color: assignJalur === j ? '#1a5fa8' : C.textMuted
                      }}>
                      {j}
                    </button>
                  ))}
                  <Input value={assignJalur} onChange={e => setAssignJalur(e.target.value)} className="!py-1 !px-2 !text-xs" style={{ maxWidth: '140px' }} />
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="secondary" size="sm" onClick={() => setAssignTarget(null)}>Batal</Button>
              <Button size="sm" loading={savingAssign} onClick={saveAssignRoom}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm hapus peserta — custom UI */}
      <Modal open={!!confirmDelPeserta} onClose={() => setConfirmDelPeserta(null)} title="Hapus Peserta?" size="sm">
        {confirmDelPeserta && (
          <div>
            {/* Info peserta */}
            <div style={{ background: C.bg, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', padding: '12px 14px', marginBottom: '16px' }}>
              <p style={{ color: C.text, fontSize: '13.5px', fontWeight: 800, marginBottom: '2px' }}>{confirmDelPeserta.nama_lengkap}</p>
              <p style={{ color: C.textMuted, fontSize: '11.5px', fontFamily: 'monospace' }}>{confirmDelPeserta.nisn}</p>
              <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {confirmDelPeserta.ruang_tes && <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{confirmDelPeserta.ruang_tes}</span>}
                {confirmDelPeserta._sumber === 'manual'
                  ? <span style={{ background: '#fffbeb', color: '#b45309', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>Manual</span>
                  : <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>PMB</span>}
              </div>
            </div>
            <p style={{ color: '#dc2626', fontSize: '12.5px', fontWeight: 600, marginBottom: '18px', lineHeight: 1.5 }}>
              {confirmDelPeserta._sumber === 'manual'
                ? 'Akun peserta ini akan dihapus permanen dan tidak dapat dikembalikan.'
                : 'Data peserta ini akan dihapus dari sistem CBT. Data di PMB tidak terpengaruh.'}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelPeserta(null)}
                style={{ padding: '9px 18px', fontSize: '12.5px', fontWeight: 700, color: C.textMid, background: C.bg, border: `1.5px solid ${C.borderMid}`, borderRadius: '10px', cursor: 'pointer' }}>
                Batal
              </button>
              <button onClick={deletePeserta} disabled={deletingPeserta}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '9px 18px', fontSize: '12.5px', fontWeight: 700, color: '#fff', background: '#dc2626', border: 'none', borderRadius: '10px', cursor: 'pointer', opacity: deletingPeserta ? 0.6 : 1 }}>
                {deletingPeserta ? <><Spinner size={13} /> Menghapus...</> : <><Trash2 size={13} /> Ya, Hapus</>}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import Excel peserta */}
      <BulkImport type="users" open={showImport} onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); fetchPeserta(); }} />
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
  const [roomDetail, setRoomDetail] = useState<Room | null>(null);
  const [roomStudents, setRoomStudents] = useState<any[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  const fetchData = useCallback(async () => {
    const [r, p] = await Promise.all([GET<Room[]>('/api/admin/rooms'), GET<Proctor[]>('/api/admin/proctors')]);
    if (r.success) setRooms(r.data || []);
    if (p.success) setProctors(p.data || []);
    setLoading(false);
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const syncRooms = async () => { setSyncing(true); const r = await POST('/api/admin/rooms/sync', {}); toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal'); setSyncing(false); fetchData(); };
  const assignProctor = async () => { if (!assignModal || !selectedProctor) return; await PUT(`/api/admin/proctors/${selectedProctor}/assign`, { room_id: assignModal.id }); toast('success', 'Berhasil'); setAssignModal(null); setSelectedProctor(''); fetchData(); };
  const unassignProctor = async (pid: string) => { await PUT(`/api/admin/proctors/${pid}/assign`, { room_id: null }); toast('success', 'Proktor dihapus'); fetchData(); };
  const unassigned = proctors.filter(p => !p.room_id);

  const openRoomDetail = async (room: Room) => {
    setRoomDetail(room);
    setLoadingStudents(true);
    setRoomStudents([]);
    // Ambil dari dua sumber: pendaftar PMB + cbt_users manual (room_id)
    const [pmb, manual] = await Promise.all([
      GET<any[]>(`/api/admin/pendaftar?ruang_tes=${encodeURIComponent(room.room_name)}`),
      GET<any[]>(`/api/admin/users?role=student&room_id=${encodeURIComponent(room.id)}`),
    ]);
    const pmbList = (pmb.success ? pmb.data || [] : []).map((p: any) => ({
      nama: p.nama_lengkap, nisn: p.nisn, sesi: p.sesi_tes, sumber: 'PMB',
    }));
    const manualList = (manual.success ? manual.data || [] : []).map((u: any) => ({
      nama: u.full_name, nisn: u.nisn || u.username, sesi: '—', sumber: 'Manual',
    }));
    setRoomStudents([...pmbList, ...manualList]);
    setLoadingStudents(false);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800 }}>Ruangan & Proktor</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>Assign proktor ke ruangan ujian</p>
        </div>
        <Button size="sm" loading={syncing} onClick={syncRooms}><RefreshCw size={13} /> Sinkronkan</Button>
      </div>
      <div style={{ flex: 1, padding: '16px 20px' }} className="space-y-3">
        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : rooms.length === 0 ? <EmptyState title="Belum ada ruangan" desc="Klik Sinkronkan dari PMB" />
            : (
              <>
                {/* DESKTOP: table */}
                <div className="hidden md:block" style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <TableHead cols={[{ label: '#' }, { label: 'Ruangan' }, { label: 'Peserta', center: true }, { label: 'Proktor' }, { label: 'Aksi', center: true }]} />
                    <tbody>
                      {rooms.map((r, i) => {
                        const rp = proctors.filter(p => p.room_id === r.id);
                        return (
                          <tr key={r.id} style={{ borderBottom: i < rooms.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                            <td style={{ padding: '10px 14px', color: C.textMuted }}>{i + 1}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <button onClick={() => openRoomDetail(r)}
                                style={{ color: C.green, fontWeight: 800, fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                                {r.room_name}
                              </button>
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}><span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{r.jumlah_peserta || 0}</span></td>
                            <td style={{ padding: '10px 14px' }}>
                              {rp.length === 0 ? <span style={{ color: C.borderMid }}>Belum ada</span>
                                : <div className="space-y-1">{rp.map(p => <div key={p.id} className="flex items-center gap-1.5 text-xs" style={{ color: C.textMid }}><span>{p.full_name}</span><button onClick={() => unassignProctor(p.id)} style={{ color: C.borderMid, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}><X size={11} /></button></div>)}</div>}
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

                {/* MOBILE: cards */}
                <div className="md:hidden flex flex-col gap-2">
                  {rooms.map(r => {
                    const rp = proctors.filter(p => p.room_id === r.id);
                    return (
                      <div key={r.id} style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <button onClick={() => openRoomDetail(r)}
                            style={{ color: C.green, fontSize: '13.5px', fontWeight: 800, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                            {r.room_name}
                          </button>
                          <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px' }}>{r.jumlah_peserta || 0} peserta</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            {rp.length === 0
                              ? <p style={{ color: C.textFaint, fontSize: '11.5px' }}>Belum ada proktor</p>
                              : rp.map(p => <p key={p.id} style={{ color: C.textMid, fontSize: '11.5px', fontWeight: 600 }}>{p.full_name}</p>)}
                          </div>
                          <button onClick={() => { setAssignModal(r); setSelectedProctor(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: C.green, fontSize: '11.5px', fontWeight: 700, background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '8px', padding: '5px 10px', cursor: 'pointer' }}>
                            <UserPlus size={12} /> Assign
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
      </div>

      {/* Modal detail siswa per ruangan */}
      <Modal open={!!roomDetail} onClose={() => setRoomDetail(null)} title={`Siswa — ${roomDetail?.room_name}`} size="md">
        {loadingStudents
          ? <div className="py-8 text-center"><Spinner /></div>
          : roomStudents.length === 0
            ? <EmptyState title="Belum ada siswa di ruangan ini" />
            : (
              <div>
                <p style={{ color: C.textMuted, fontSize: '11.5px', marginBottom: '12px' }}>{roomStudents.length} siswa terdaftar</p>
                <div style={{ background: C.bg, borderRadius: '12px', overflow: 'hidden', border: `1.5px solid ${C.borderMid}` }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>#</th>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Nama</th>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>NISN</th>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sesi</th>
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sumber</th>
                      </tr>
                    </thead>
                    <tbody>
                      {roomStudents.map((s, i) => (
                        <tr key={i} style={{ borderBottom: i < roomStudents.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: C.white }}>
                          <td style={{ padding: '9px 14px', color: C.textMuted }}>{i + 1}</td>
                          <td style={{ padding: '9px 14px', color: C.text, fontWeight: 700 }}>{s.nama}</td>
                          <td style={{ padding: '9px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{s.nisn}</td>
                          <td style={{ padding: '9px 14px', color: C.textMuted }}>{s.sesi || '—'}</td>
                          <td style={{ padding: '9px 14px' }}>
                            {s.sumber === 'Manual'
                              ? <span style={{ background: '#fffbeb', color: '#b45309', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>Manual</span>
                              : <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>PMB</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
      </Modal>

      <Modal open={!!assignModal} onClose={() => setAssignModal(null)} title={`Assign Proktor — ${assignModal?.room_name}`} size="sm">
        {unassigned.length === 0
          ? <p style={{ color: C.textMuted, fontSize: '13px' }}>Semua proktor sudah di-assign.</p>
          : <div className="space-y-3">
            <Select label="Pilih Proktor" value={selectedProctor} onChange={e => setSelectedProctor(e.target.value)}
              options={[{ value: '', label: '— Pilih —' }, ...unassigned.map(p => ({ value: p.id, label: `${p.full_name} (${p.username})` }))]} />
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setAssignModal(null)}>Batal</Button>
              <Button size="sm" disabled={!selectedProctor} onClick={assignProctor}>Assign</Button>
            </div>
          </div>}
      </Modal>
    </div>
  );
}

// ── PELAKSANA PAGE ────────────────────────────────────────────
// Tab Proktor + Tab Admin
function PelaksanaPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<'proktor' | 'admin'>('proktor');
  const [users, setUsers] = useState<Proctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editUser, setEditUser] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Proctor | null>(null);

  const fetchData = useCallback(async () => {
    // Fetch proctors + admins via /users endpoint which returns role field
    const r = await GET<Proctor[]>('/api/admin/users');
    if (r.success) {
      const all = (r.data || []).filter((u: any) => u.role === 'proctor' || u.role === 'admin');
      setUsers(all);
    }
    setLoading(false);
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  // Map tab name (Indonesian) → DB role (English)
  const TAB_TO_ROLE: Record<string, string> = { proktor: 'proctor', admin: 'admin' };
  const dbRole = TAB_TO_ROLE[tab] || tab;
  const displayed = users.filter(u => u.role === dbRole);

  const save = async () => {
    if (!editUser?.username || !editUser.full_name) { toast('error', 'Data tidak lengkap'); return; }
    if (!editUser.id && !editUser.password) { toast('error', 'Password wajib'); return; }
    setSaving(true);
    const role = TAB_TO_ROLE[editUser.role] || editUser.role || dbRole;
    const r = editUser.id
      ? await PUT(`/api/admin/users/${editUser.id}`, { ...editUser, role })
      : await POST('/api/admin/users', { ...editUser, role });
    setSaving(false);
    if (r.success) { toast('success', 'Berhasil'); setEditUser(null); fetchData(); } else toast('error', r.error || 'Gagal');
  };

  const del = async () => {
    if (!confirmDel) return;
    await DEL(`/api/admin/users/${confirmDel.id}`);
    toast('success', 'Dihapus');
    setConfirmDel(null);
    fetchData();
  };

  const TABS = [
    { key: 'proktor' as const, label: 'Proktor' },
    { key: 'admin' as const, label: 'Admin' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800 }}>Pelaksana Tes</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>{displayed.length} {tab} terdaftar</p>
        </div>
        <button onClick={() => setEditUser({ role: tab, is_active: 1 })}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
          <Plus size={13} strokeWidth={2.5} /> Tambah {tab === 'proktor' ? 'Proktor' : 'Admin'}
        </button>
      </div>

      {/* flat tabs */}
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '0 20px', display: 'flex' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '11px 18px 10px', fontSize: '12.5px',
              fontWeight: tab === t.key ? 800 : 600,
              color: tab === t.key ? C.green : C.textMuted,
              background: 'none', border: 'none',
              borderBottom: `2.5px solid ${tab === t.key ? C.green : 'transparent'}`,
              marginBottom: '-1.5px', cursor: 'pointer',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: '16px 20px' }} className="space-y-3">
        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : displayed.length === 0 ? <EmptyState title={`Belum ada ${tab}`} />
            : (
              <>
                {/* DESKTOP: table */}
                <div className="hidden md:block" style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <TableHead cols={[
                      { label: '#' }, { label: 'Nama' }, { label: 'Username' },
                      ...(tab === 'proktor' ? [{ label: 'Ruangan' }] : []),
                      { label: 'Aksi', center: true },
                    ]} />
                    <tbody>
                      {displayed.map((p, i) => (
                        <tr key={p.id} style={{ borderBottom: i < displayed.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                          <td style={{ padding: '10px 14px', color: C.textMuted }}>{i + 1}</td>
                          <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{p.full_name}</td>
                          <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{p.username}</td>
                          {tab === 'proktor' && (
                            <td style={{ padding: '10px 14px' }}>
                              {p.room_name
                                ? <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{p.room_name}</span>
                                : <span style={{ color: C.borderMid }}>—</span>}
                            </td>
                          )}
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                              <button onClick={() => setEditUser({ id: p.id, username: p.username, full_name: p.full_name, role: p.role })}
                                style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.greenLight; (e.currentTarget as HTMLElement).style.color = C.green; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}>
                                <Pencil size={13} />
                              </button>
                              <button onClick={() => setConfirmDel(p)}
                                style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; (e.currentTarget as HTMLElement).style.color = '#dc2626'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* MOBILE: cards */}
                <div className="md:hidden flex flex-col gap-2">
                  {displayed.map(p => (
                    <div key={p.id} style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                        <div>
                          <p style={{ color: C.text, fontSize: '13.5px', fontWeight: 800 }}>{p.full_name}</p>
                          <p style={{ color: C.textMuted, fontSize: '11px', fontFamily: 'monospace', marginTop: '2px' }}>{p.username}</p>
                          {tab === 'proktor' && p.room_name && (
                            <span style={{ display: 'inline-block', marginTop: '6px', background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{p.room_name}</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                          <button onClick={() => setEditUser({ id: p.id, username: p.username, full_name: p.full_name, role: p.role })}
                            style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9px', background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, cursor: 'pointer', color: C.green }}>
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setConfirmDel(p)}
                            style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9px', background: '#fef2f2', border: '1.5px solid #fecaca', cursor: 'pointer', color: '#dc2626' }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
      </div>

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title={editUser?.id ? `Edit ${tab === 'proktor' ? 'Proktor' : 'Admin'}` : `Tambah ${tab === 'proktor' ? 'Proktor' : 'Admin'}`} size="sm">
        {editUser && (
          <div className="space-y-3">
            <Input label="Nama Lengkap" value={editUser.full_name || ''} onChange={e => setEditUser({ ...editUser, full_name: e.target.value })} />
            <Input label="Username" value={editUser.username || ''} onChange={e => setEditUser({ ...editUser, username: e.target.value })} disabled={!!editUser.id} />
            <Input label={editUser.id ? 'Password Baru (opsional)' : 'Password'} type="password" value={editUser.password || ''} onChange={e => setEditUser({ ...editUser, password: e.target.value })} />
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="secondary" size="sm" onClick={() => setEditUser(null)}>Batal</Button>
              <Button size="sm" loading={saving} onClick={save}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!confirmDel} onClose={() => setConfirmDel(null)} onConfirm={del}
        title={`Hapus ${tab === 'proktor' ? 'Proktor' : 'Admin'}?`}
        message={`Akun "${confirmDel?.full_name}" akan dihapus permanen.`} />
    </div>
  );
}

// ── SETTINGS PAGE — Landing Page Editor ──────────────────────
function SettingsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const defaults: Record<string, string> = {
    landing_badge: 'Penerimaan Murid Baru 2025/2026',
    landing_title_1: 'Ujian Seleksi',
    landing_title_2: 'Penerimaan',
    landing_title_3: 'Murid Baru',
    landing_subtitle: 'Sistem CBT resmi MAN 1 Tasikmalaya. Aman, terstruktur, dan hasil tersedia langsung setelah ujian.',
    landing_login_hint: 'NISN & tanggal lahir (DDMMYYYY) sebagai password',
    landing_trust: 'Data terintegrasi langsung dari sistem pendaftaran PMB.',
  };

  useEffect(() => {
    GET<Record<string, string>>('/api/admin/settings').then(r => {
      if (r.success) setSettings({ ...defaults, ...(r.data || {}) });
      else setSettings({ ...defaults });
      setLoading(false);
    });
  }, []);

  const upd = (key: string, val: string) => setSettings(prev => ({ ...prev, [key]: val }));

  const save = async () => {
    setSaving(true);
    const r = await PUT('/api/admin/settings', settings);
    setSaving(false);
    toast(r.success ? 'success' : 'error', r.success ? 'Tersimpan!' : r.error || 'Gagal');
  };

  if (loading) return <div className="py-12 text-center"><Spinner /></div>;

  const EditableText = ({ k, style: s, className: cn }: { k: string; style?: React.CSSProperties; className?: string }) => (
    <span contentEditable suppressContentEditableWarning
      className={cn}
      style={{ ...s, outline: 'none', borderBottom: '2px dashed rgba(45,122,79,0.3)', cursor: 'text', minWidth: '20px', display: 'inline-block' }}
      onBlur={e => upd(k, e.currentTarget.textContent || '')}
      dangerouslySetInnerHTML={{ __html: settings[k] || '' }} />
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800 }}>Pengaturan Landing Page</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>Klik teks di preview untuk mengedit langsung</p>
        </div>
        <Button size="sm" loading={saving} onClick={save}>Simpan Perubahan</Button>
      </div>

      <div style={{ flex: 1, padding: '20px', overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
        {/* LIVE PREVIEW */}
        <div style={{ width: '100%', maxWidth: '400px', background: '#f4f6f4', borderRadius: '24px', border: `2px solid ${C.borderMid}`, padding: '0', overflow: 'hidden', position: 'relative' }}>

          {/* dot texture */}
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.4, pointerEvents: 'none' }} />

          <div style={{ position: 'relative', zIndex: 1, padding: '32px 24px 24px' }}>
            {/* Nav */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '20px' }}>
              <img src="/kemenag.png" alt="" width={36} height={36} style={{ objectFit: 'contain' }} />
              <div>
                <p style={{ color: '#1e2e22', fontSize: '11px', fontWeight: 800, letterSpacing: '0.01em' }}>MAN 1 TASIKMALAYA</p>
                <p style={{ color: '#7a9e86', fontSize: '9.5px', fontWeight: 600, fontStyle: 'italic' }}>Bangkit ·  · Juara</p>
              </div>
            </div>

            <div style={{ height: '1px', background: 'linear-gradient(to right,transparent,#c4cec4,transparent)', marginBottom: '24px' }} />

            {/* Badge */}
            <div style={{ marginBottom: '16px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#e2ebe3', border: '1.5px solid #c4d4c7', color: '#2d6644', fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em', padding: '5px 12px', borderRadius: '999px', textTransform: 'uppercase' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#2d7a4f' }} />
                <EditableText k="landing_badge" />
              </span>
            </div>

            {/* Titles */}
            <div style={{ marginBottom: '12px' }}>
              <p style={{ lineHeight: 1.06 }}><EditableText k="landing_title_1" style={{ color: '#1e2e22', fontSize: '28px', fontWeight: 900, letterSpacing: '-1px' }} /></p>
              <p style={{ lineHeight: 1.06 }}><EditableText k="landing_title_2" style={{ color: '#2d7a4f', fontSize: '28px', fontWeight: 900, letterSpacing: '-1px' }} /></p>
              <p style={{ lineHeight: 1.06 }}><EditableText k="landing_title_3" style={{ color: '#6b7c6e', fontSize: '28px', fontWeight: 900, letterSpacing: '-1px' }} /></p>
            </div>

            {/* Subtitle */}
            <p style={{ marginBottom: '20px', maxWidth: '280px' }}>
              <EditableText k="landing_subtitle" style={{ color: '#8a9e8d', fontSize: '12px', fontWeight: 500, lineHeight: '1.6' }} />
            </p>

            {/* CTA mock */}
            <div style={{ background: '#2d7a4f', padding: '13px 18px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#fff', fontSize: '14px', fontWeight: 800 }}>Masuk ke Ujian</span>
              <span style={{ width: '30px', height: '30px', background: 'rgba(255,255,255,0.15)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ArrowRight size={14} color="#fff" strokeWidth={2.5} />
              </span>
            </div>
            <p style={{ textAlign: 'center', marginBottom: '16px' }}>
              <EditableText k="landing_login_hint" style={{ color: '#a8b9aa', fontSize: '10px', fontWeight: 500 }} />
            </p>

            {/* Trust */}
            <div style={{ background: '#fff', border: '1.5px solid #d4dbd4', borderRadius: '12px', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#2d7a4f', flexShrink: 0, fontSize: '13px' }}>✓</span>
              <EditableText k="landing_trust" style={{ color: '#8a9e8d', fontSize: '10px', fontWeight: 500, lineHeight: '1.4' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() { return <ToastProvider><AdminContent /></ToastProvider>; }
