'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST, PUT, DEL } from '@/lib/api';
import {
  Button, Input, Textarea, Select, Modal, LoadingScreen, EmptyState,
  ToastProvider, useToast, Confirm, Spinner,
} from '@/components/ui';
import RichEditor from '@/components/admin/RichEditor';
import BulkImport from '@/components/admin/BulkImport';
import MathContent from '@/components/content/MathContent';
import { exportExamResults, exportExamAnalytics } from '@/lib/export';
import { generateAttendanceDocx, downloadDocxBlob, ParticipantDocxData, MapelAttendanceData, AttendanceDocxOptions } from '@/lib/attendanceDocx';
import { generateExamResultsDocx, downloadResultsDocxBlob, ExamResultDocxItem, ExamResultsDocxOptions } from '@/lib/examResultsDocx';
import { isFullArabic } from '@/lib/rtl';
import {
  ClipboardList, Users, School, Shield, LogOut, Menu, Layers,
  Plus, FileDown, RefreshCw, Pencil, Trash2, Upload, Download,
  Image, Volume2, X, UserPlus, ChevronLeft, ArrowRight, Settings, Power, Sparkles, Search,
} from 'lucide-react';

const DEFAULT_RULES_TEMPLATE = `<ol>
  <li>Berdoa sebelum memulai pengerjaan soal.</li>
  <li>Kerjakan soal secara mandiri, jujur, dan tidak bekerja sama dengan peserta lain.</li>
  <li>Dilarang membuka tab lain, berpindah aplikasi, atau mematikan mode layar penuh (fullscreen).</li>
  <li>Perhatikan sisa waktu pengerjaan yang tertera pada layar.</li>
  <li>Jika terjadi kendala teknis, segera hubungi pengawas atau proktor ujian.</li>
</ol>`;

const DEFAULT_COMPLETION_MESSAGE = `Terima kasih telah menyelesaikan ujian ini dengan jujur dan tertib.

• Jawaban Anda telah tersimpan secara otomatis di sistem.
• Harap tetap tenang dan duduk di tempat Anda.
• Tunggu instruksi lebih lanjut dari pengawas sebelum meninggalkan ruangan.

Semoga mendapatkan hasil yang terbaik!`;


// ── TYPES ────────────────────────────────────────────────────
interface Room { id: string; room_name: string; capacity: number; jumlah_peserta?: number; event_id?: string | null; event_code?: string; event_name?: string }
interface Proctor { id: string; username: string; full_name: string; role: string; room_id: string | null; room_name?: string }
interface Pendaftar { id: string; nisn: string; nama_lengkap: string; no_pendaftaran: string; ruang_tes: string; jalur: string; asal_sekolah: string; jenis_kelamin: string; tanggal_lahir: string; tanggal_tes: string; sesi_tes: string }
interface Exam { id: string; title: string; subject_name?: string | null; sequence_order?: number; description: string | null; duration_minutes: number; active_status: string; question_count: number; is_score_visible: number; randomize_questions: number; randomize_options: number; rules_text: string | null; completion_message: string; passing_score: number; target_jalur: string | null; cheat_limit: number; cheat_action: string; enforce_fullscreen: number; event_id?: string | null; event_name?: string | null; event_code?: string | null }
interface CbtEvent { id: string; code: string; name: string; activity_type: string; participant_source: 'pmb' | 'mansatas' | 'cbt_user'; status: string; exam_count?: number; roster_count?: number }
interface RosterParticipant { source_id: string; source_key: string; username: string; nisn: string; full_name: string; class_name: string; grade: string; gender: string; is_active: number | boolean; room_name?: string | null; tanggal_tes?: string | null; sesi_tes?: string | null }
interface Question { id: string; question_text: string; question_type: string; question_order: number; image_url: string | null; audio_url: string | null; options: QOption[] }
interface QOption { id?: string; option_label: string; option_text: string; image_url: string | null; is_correct: number }
type Page = 'exams' | 'kegiatan' | 'peserta' | 'rooms' | 'pelaksana' | 'settings';
type ExamTab = 'soal' | 'token' | 'monitor' | 'hasil' | 'peserta' | 'analitik';

const normalizeJenisKelamin = (value?: string | null) => {
  const normalized = (value || '').trim().toUpperCase().replace(/[\s_-]+/g, ' ');
  if (!normalized) return '';
  if (normalized === 'L' || normalized.startsWith('LAKI') || normalized === 'PRIA') return 'L';
  if (normalized === 'P' || normalized.startsWith('PEREMPUAN') || normalized === 'WANITA') return 'P';
  return normalized;
};

const C = {
  bg: '#f4f6f4', white: '#fff', border: '#e0e5e0', borderLight: '#edf0ed', borderMid: '#d4dbd4',
  text: '#1e2e22', textMid: '#4a6655', textMuted: '#8a9e8d', textFaint: '#a8b9aa',
  green: '#2d7a4f', greenLight: '#e2ebe3', greenBorder: '#b5d9c4',
};

const parseServerTime = (value: string) => {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : Date.now();
};

const sessionFilterKey = (row: any) => `${row?.tanggal_tes || ''}|${row?.sesi_tes || ''}`;

const sessionFilterLabel = (row: any) => {
  const tanggal = row?.tanggal_tes || '';
  const sesi = row?.sesi_tes || '';
  if (!tanggal && !sesi) return 'Tanpa Sesi / Simulasi';
  return [tanggal || 'Tanpa tanggal', sesi || 'Tanpa sesi'].join(' - ');
};

const buildSessionFilters = (rows: any[]) => Array.from(new Map(rows.map((row: any) => {
  const key = sessionFilterKey(row);
  return [key, { key, label: sessionFilterLabel(row) }];
})).values()).sort((a: any, b: any) => {
  if (a.key === '|') return 1;
  if (b.key === '|') return -1;
  return a.label.localeCompare(b.label);
});

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
  { key: 'analitik', label: 'Analitik' },
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

  // ── ACTIVE EVENT CONTEXT ──
  const [activeEventId, setActiveEventIdState] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cbt_active_event_id') || null;
    }
    return null;
  });
  const [allEventsList, setAllEventsList] = useState<CbtEvent[]>([]);
  const [showEventModal, setShowEventModal] = useState(false);

  const fetchEventsHeader = useCallback(async () => {
    const res = await GET<CbtEvent[]>('/api/admin/events');
    if (res.success && res.data) {
      setAllEventsList(res.data);
    }
  }, []);

  useEffect(() => {
    fetchEventsHeader();
  }, [fetchEventsHeader]);

  const setActiveEventId = (id: string | null) => {
    setActiveEventIdState(id);
    if (id) {
      localStorage.setItem('cbt_active_event_id', id);
    } else {
      localStorage.removeItem('cbt_active_event_id');
    }
  };

  const currentActiveEvent = allEventsList.find(e => e.id === activeEventId) || null;

  const toggleCollapsed = () => setCollapsed(prev => {
    const next = !prev;
    localStorage.setItem('admin_sidebar', next ? 'collapsed' : 'expanded');
    return next;
  });

  if (authLoading) return <LoadingScreen />;
  if (!user) return null;

  const menu: { key: Page; label: string; icon: React.ReactNode }[] = [
    { key: 'exams', label: 'Ujian', icon: <ClipboardList size={14} strokeWidth={2} /> },
    { key: 'kegiatan', label: 'Kegiatan & Roster', icon: <Layers size={14} strokeWidth={2} /> },
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* mobile: hamburger */}
            <button className="lg:hidden" onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
              <Menu size={20} color="#6b7c6e" />
            </button>

            {/* Active Event Banner & Switcher */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: currentActiveEvent ? '#f0fdf4' : '#fffbe6', border: `1.5px solid ${currentActiveEvent ? C.greenBorder : '#ffe58f'}`, padding: '5px 12px', borderRadius: '999px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: currentActiveEvent ? C.green : '#d48806', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: currentActiveEvent ? C.green : '#faad14' }} />
                {currentActiveEvent ? `KEGIATAN AKTIF: ${currentActiveEvent.code} · ${currentActiveEvent.name}` : 'SEMUA KEGIATAN (GLOBAL)'}
              </span>
              <button
                onClick={() => setShowEventModal(true)}
                style={{ background: 'none', border: 'none', color: '#1a5fa8', fontSize: '11px', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px', padding: '0 2px' }}>
                [ 🔄 Ganti Kegiatan ]
              </button>
            </div>
          </div>
          <TanggalHari />
        </header>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {page === 'exams' && <ExamsPage activeEventId={activeEventId} />}
          {page === 'kegiatan' && <KegiatanPage activeEventId={activeEventId} setActiveEventId={setActiveEventId} />}
          {page === 'peserta' && <PesertaPage activeEventId={activeEventId} />}
          {page === 'rooms' && <RoomsPage activeEventId={activeEventId} />}
          {page === 'pelaksana' && <PelaksanaPage />}
          {page === 'settings' && <SettingsPage />}
        </main>

        <footer style={{ textAlign: 'center', padding: '12px', color: '#a8b3a8', fontSize: '11px', fontWeight: 500, borderTop: `1px solid ${C.borderLight}` }}>
          © 2026 MAN 1 Tasikmalaya — DRUDOX
        </footer>
      </div>

      {/* Modal Switcher Kegiatan */}
      <Modal open={showEventModal} onClose={() => setShowEventModal(false)} title="Pilih Kegiatan / Event" size="md">
        <div className="space-y-3">
          <p style={{ color: C.textMuted, fontSize: '11.5px' }}>Pilih kegiatan yang ingin Anda kelola. Seluruh menu (Ujian, Peserta, Ruangan, Token, & Monitoring) akan disesuaikan secara otomatis.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', maxHeight: '350px', overflowY: 'auto' }}>
            <div
              onClick={() => { setActiveEventId(null); setShowEventModal(false); }}
              style={{ background: !activeEventId ? C.greenLight : C.white, border: `1.5px solid ${!activeEventId ? C.green : C.borderMid}`, borderRadius: '12px', padding: '12px', cursor: 'pointer' }}>
              <p style={{ fontSize: '12px', fontWeight: 800, color: !activeEventId ? C.green : C.text }}>🌐 Semua Kegiatan (Global)</p>
              <p style={{ fontSize: '10.5px', color: C.textFaint, marginTop: '2px' }}>Tampilkan semua data tanpa filter kegiatan tunggal</p>
            </div>
            {allEventsList.map(ev => {
              const isSel = activeEventId === ev.id;
              return (
                <div
                  key={ev.id}
                  onClick={() => { setActiveEventId(ev.id); setShowEventModal(false); }}
                  style={{ background: isSel ? C.greenLight : C.white, border: `1.5px solid ${isSel ? C.green : C.borderMid}`, borderRadius: '12px', padding: '12px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ background: '#f0fdf4', color: C.green, border: `1px solid ${C.greenBorder}`, fontSize: '9.5px', fontWeight: 800, padding: '2px 7px', borderRadius: '999px' }}>{ev.code}</span>
                    {isSel && <span style={{ color: C.green, fontSize: '10px', fontWeight: 800 }}>✓ AKTIF</span>}
                  </div>
                  <p style={{ fontSize: '12.5px', fontWeight: 800, color: C.text, marginTop: '6px' }}>{ev.name}</p>
                  <p style={{ fontSize: '10.5px', color: C.textFaint, marginTop: '2px' }}>Sumber: {(ev.participant_source || 'cbt').toUpperCase()}</p>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="secondary" size="sm" onClick={() => setShowEventModal(false)}>Tutup</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── DOWNLOAD ATTENDANCE MODAL ────────────────────────────────
function DownloadAttendanceModal({
  open,
  onClose,
  initialEventId,
  initialExamId,
  events,
  exams,
  rooms,
}: {
  open: boolean;
  onClose: () => void;
  initialEventId?: string | null;
  initialExamId?: string | null;
  events: CbtEvent[];
  exams: Exam[];
  rooms: Room[];
}) {
  const { toast } = useToast();
  const [eventId, setEventId] = useState<string>('');
  const [examId, setExamId] = useState<string>('ALL');
  const [roomId, setRoomId] = useState<string>('ALL');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (open) {
      const evId = initialEventId || (events[0]?.id ?? '');
      setEventId(evId);
      setExamId(initialExamId || 'ALL');
      setRoomId('ALL');
    }
  }, [open, initialEventId, initialExamId, events]);

  const selectedEvent = events.find(e => e.id === eventId) || null;
  const filteredExams = useMemo(() => {
    if (!eventId) return [];
    return exams.filter(e => e.event_id === eventId);
  }, [exams, eventId]);

  const handleDownload = async () => {
    if (!eventId) {
      toast('error', 'Pilih kegiatan terlebih dahulu');
      return;
    }
    setDownloading(true);
    try {
      let targetExams: Exam[] = [];
      if (examId !== 'ALL') {
        const found = exams.find(e => e.id === examId);
        if (found) targetExams = [found];
      } else {
        targetExams = filteredExams;
      }

      if (targetExams.length === 0) {
        targetExams = [{
          id: 'default',
          title: selectedEvent?.name || 'Ujian',
          subject_name: selectedEvent?.name || 'Ujian',
          description: null,
          duration_minutes: 60,
          active_status: 'active',
          question_count: 0,
          is_score_visible: 0,
          randomize_questions: 0,
          randomize_options: 0,
          rules_text: null,
          completion_message: '',
          passing_score: 0,
          target_jalur: null,
          cheat_limit: 3,
          cheat_action: 'lock',
          enforce_fullscreen: 0,
        }];
      }

      const selectedRoom = rooms.find(r => r.id === roomId || r.room_name === roomId);
      const roomFilterName = selectedRoom ? selectedRoom.room_name : (roomId !== 'ALL' ? roomId : undefined);

      const mapelsDocx: MapelAttendanceData[] = [];

      for (const ex of targetExams) {
        let roster: any[] = [];
        if (ex.id !== 'default') {
          const res = await GET<any[]>(`/api/admin/exams/${ex.id}/roster`);
          if (res.success && Array.isArray(res.data)) {
            roster = res.data;
          }
        }

        if (roster.length === 0) {
          const eventRes = await GET<any[]>(`/api/admin/roster?event_id=${eventId}`);
          if (eventRes.success && Array.isArray(eventRes.data)) {
            roster = eventRes.data;
          }
        }

        if (roomFilterName) {
          roster = roster.filter((r: any) =>
            r.room_id === roomId ||
            r.room_name === roomFilterName ||
            r.room_id === roomFilterName
          );
        }

        if (roster.length === 0) continue;

        const subjectTitle = ex.subject_name || ex.title || 'Mata Pelajaran';
        const sampleRow = roster[0];
        const tanggalTes = sampleRow?.tanggal_tes || '-';
        const sesiTes = sampleRow?.sesi_tes || '-';
        const roomNameStr = roomFilterName || sampleRow?.room_name || 'Semua Ruangan';

        const participantData: ParticipantDocxData[] = roster.map((p: any, idx: number) => ({
          no: idx + 1,
          nisn: p.nisn || p.username || '-',
          full_name: p.full_name || 'Peserta',
          gender: normalizeJenisKelamin(p.gender) || '-',
          mapel: subjectTitle,
        }));

        mapelsDocx.push({
          exam_id: ex.id,
          subject_name: subjectTitle,
          title: ex.title,
          tanggal_tes: tanggalTes,
          sesi_tes: sesiTes,
          room_name: roomNameStr,
          participants: participantData,
        });
      }

      if (mapelsDocx.length === 0) {
        toast('error', 'Tidak ada data peserta/roster pada filter yang dipilih');
        setDownloading(false);
        return;
      }

      const docxOptions: AttendanceDocxOptions = {
        event_name: selectedEvent?.name || 'UJIAN CBT',
        event_code: selectedEvent?.code || '',
        room_name: roomFilterName,
        mapels: mapelsDocx,
      };

      const blob = await generateAttendanceDocx(docxOptions);
      const filename = `Absensi-${(selectedEvent?.code || 'UJIAN').replace(/[^a-zA-Z0-9_-]/g, '_')}${roomFilterName ? `-${roomFilterName}` : ''}`;
      downloadDocxBlob(blob, filename);

      toast('success', 'Absensi Word (.docx) berhasil diunduh');
      onClose();
    } catch (err: any) {
      console.error('Error generating attendance docx:', err);
      toast('error', err?.message || 'Gagal membuat file absensi Word');
    } finally {
      setDownloading(false);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Cetak / Download Absensi Word (.docx)" size="md">
      <div style={{ padding: '4px 0' }}>
        <p style={{ fontSize: '12px', color: C.textMid, lineHeight: 1.5, marginBottom: '14px' }}>
          Format dokumen <strong>A4</strong> dengan header resmi kegiatan, margin konsisten, serta tabel absensi dengan kolom <strong>Tanda Tangan Side-to-Side (Ganjil-Genap)</strong> 2-baris.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            KEGIATAN
            <select
              value={eventId}
              onChange={e => { setEventId(e.target.value); setExamId('ALL'); }}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.code} · {ev.name}</option>)}
            </select>
          </label>

          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            MATA PELAJARAN / UJIAN
            <select
              value={examId}
              onChange={e => setExamId(e.target.value)}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              <option value="ALL">Semua Mapel (Lembar terpisah per mapel)</option>
              {filteredExams.map(ex => (
                <option key={ex.id} value={ex.id}>{ex.subject_name || ex.title}{ex.subject_name ? ` (${ex.title})` : ''}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            RUANGAN
            <select
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              <option value="ALL">Semua Ruangan</option>
              {rooms.map(r => (
                <option key={r.id} value={r.id}>{r.room_name}</option>
              ))}
            </select>
          </label>

          <div style={{ background: '#f0fdf4', border: `1.5px solid ${C.greenBorder}`, borderRadius: '10px', padding: '10px 12px', marginTop: '4px' }}>
            <p style={{ fontSize: '11px', color: C.green, fontWeight: 800 }}>📌 Fitur Multi-Mapel Page Break</p>
            <p style={{ fontSize: '11px', color: C.textMid, marginTop: '3px', lineHeight: 1.4 }}>
              Jika memilih <strong>Semua Mapel</strong>, setiap mata pelajaran dalam kegiatan ini akan otomatis dipisahkan di lembar A4 tersendiri dengan margin dan header yang tetap konsisten.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button
            onClick={onClose}
            disabled={downloading}
            style={{ background: C.bg, color: C.textMid, border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', padding: '9px 15px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            Batal
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading || !eventId}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: C.green, color: '#fff', border: 'none', borderRadius: '9px', padding: '9px 18px', fontSize: '12px', fontWeight: 900, cursor: downloading ? 'not-allowed' : 'pointer', opacity: downloading ? 0.7 : 1 }}
          >
            {downloading ? <Spinner size={14} /> : <FileDown size={14} />}
            {downloading ? 'Memproses Word...' : 'Download Absensi (.docx)'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DownloadExamResultsModal({
  open,
  onClose,
  initialExamId,
  events,
  exams,
  rooms,
}: {
  open: boolean;
  onClose: () => void;
  initialExamId?: string | null;
  events: CbtEvent[];
  exams: Exam[];
  rooms: Room[];
}) {
  const { toast } = useToast();
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [sortBy, setSortBy] = useState<'score' | 'name'>('score');
  const [selectedRoom, setSelectedRoom] = useState<string>('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialExamId && exams.some(e => e.id === initialExamId)) {
        setSelectedExamId(initialExamId);
      } else if (exams[0]) {
        setSelectedExamId(exams[0].id);
      }
    }
  }, [open, initialExamId, exams]);

  const handleDownload = async () => {
    if (!selectedExamId) {
      toast('error', 'Pilih ujian terlebih dahulu');
      return;
    }
    const targetExam = exams.find(e => e.id === selectedExamId);
    if (!targetExam) return;

    setLoading(true);
    try {
      const response = await GET<any[]>(`/api/admin/exams/${selectedExamId}/results-export`);
      if (!response.success || !response.data) {
        toast('error', response.error || 'Gagal memuat hasil ujian');
        setLoading(false);
        return;
      }

      let rawData = response.data || [];
      if (selectedRoom !== 'all') {
        rawData = rawData.filter((item: any) =>
          item.room_id === selectedRoom || item.room_name === selectedRoom
        );
      }

      const results: ExamResultDocxItem[] = rawData.map((item: any) => ({
        nisn: item.nisn || item.username || '-',
        full_name: item.full_name || 'Peserta',
        class_name: item.class_name || item.grade || '-',
        total_questions: Number(item.total_questions || 0),
        total_correct: Number(item.total_correct || 0),
        total_wrong: Number(item.total_wrong || 0),
        total_unanswered: Number(item.total_unanswered || 0),
        score: Number(item.score || 0),
        room_name: item.room_name || '-',
        status_pengerjaan: item.status_pengerjaan || 'Selesai',
      }));

      if (results.length === 0) {
        toast('error', 'Tidak ada data hasil pengerjaan peserta untuk ujian ini');
        setLoading(false);
        return;
      }

      const eventObj = events.find(e => e.id === targetExam.event_id);
      const roomObj = rooms.find(r => r.id === selectedRoom);

      const blob = await generateExamResultsDocx({
        exam_title: targetExam.title,
        subject_name: targetExam.subject_name || targetExam.title,
        event_name: eventObj?.name || 'CBT MAN 1 TASIKMALAYA',
        room_name: selectedRoom === 'all' ? 'Semua Ruangan / Kelas' : (roomObj?.room_name || selectedRoom),
        sortBy,
        results,
      });

      const fileName = `Hasil_Ujian_${targetExam.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${sortBy === 'score' ? 'Peringkat' : 'Nama'}`;
      downloadResultsDocxBlob(blob, fileName);

      toast('success', 'File Word (.docx) hasil ujian berhasil di-download!');
      onClose();
    } catch (err: any) {
      console.error('Error generating exam results docx:', err);
      toast('error', 'Gagal membuat file Word hasil ujian');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Cetak / Download Hasil Ujian (.docx)" size="md">
      <div style={{ padding: '4px 0' }}>
        <p style={{ fontSize: '12px', color: C.textMid, lineHeight: 1.5, marginBottom: '14px' }}>
          Format dokumen <strong>A4</strong> hasil pengerjaan ujian, lengkap dengan kolom <strong>Kelas</strong>, <strong>Jawaban Benar</strong>, <strong>Nilai Akhir</strong>, ringkasan statistik, dan footer tanda tangan.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            UJIAN / MATA PELAJARAN
            <select
              value={selectedExamId}
              onChange={e => setSelectedExamId(e.target.value)}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              {exams.map(ex => (
                <option key={ex.id} value={ex.id}>
                  {ex.title} {ex.subject_name ? `(${ex.subject_name})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            URUTAN DATA (SORTING)
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'score' | 'name')}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              <option value="score">🏆 Urutkan Berdasarkan Nilai Tertinggi (Peringkat / Rank)</option>
              <option value="name">🔤 Urutkan Berdasarkan Nama Peserta (A - Z)</option>
            </select>
          </label>

          <label style={{ display: 'block', fontSize: '11px', fontWeight: 800, color: C.textMid }}>
            RUANGAN / KELAS
            <select
              value={selectedRoom}
              onChange={e => setSelectedRoom(e.target.value)}
              style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12.5px', background: C.white, fontWeight: 700 }}
            >
              <option value="all">Semua Ruangan / Kelas</option>
              {rooms.map(rm => (
                <option key={rm.id} value={rm.id}>
                  {rm.room_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{ background: C.bg, color: C.textMid, border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', padding: '9px 15px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
          >
            Batal
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || !selectedExamId}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: C.green, color: '#fff', border: 'none', borderRadius: '9px', padding: '9px 18px', fontSize: '12px', fontWeight: 900, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? <Spinner size={14} /> : <FileDown size={14} />}
            {loading ? 'Memproses Word...' : 'Download Hasil (.docx)'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── EXAMS PAGE ────────────────────────────────────────────────
function ExamsPage({ activeEventId }: { activeEventId?: string | null }) {
  const { toast } = useToast();
  const [exams, setExams] = useState<Exam[]>([]);
  const [events, setEvents] = useState<CbtEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editExam, setEditExam] = useState<Partial<Exam> | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [activeTab, setActiveTab] = useState<ExamTab>('soal');
  const [confirmDel, setConfirmDel] = useState<Exam | null>(null);
  const [jalurList, setJalurList] = useState<string[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(() => activeEventId || 'ALL');
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [attendanceEventId, setAttendanceEventId] = useState<string | null>(null);
  const [attendanceExamId, setAttendanceExamId] = useState<string | null>(null);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [resultsExamId, setResultsExamId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    setSelectedEventId(activeEventId || 'ALL');
  }, [activeEventId]);

  const filteredExams = useMemo(() => {
    if (selectedEventId === 'ALL') return exams;
    if (selectedEventId === 'NO_EVENT') return exams.filter(e => !e.event_id);
    return exams.filter(e => e.event_id === selectedEventId);
  }, [exams, selectedEventId]);

  const fetchExams = useCallback(async () => {
    const [r, j, e, rm] = await Promise.all([
      GET<Exam[]>('/api/admin/exams'),
      GET<string[]>('/api/admin/pendaftar/jalur'),
      GET<CbtEvent[]>('/api/admin/events'),
      GET<Room[]>('/api/admin/rooms'),
    ]);
    if (r.success) setExams(r.data || []);
    if (j.success) setJalurList(j.data || []);
    if (e.success) setEvents(e.data || []);
    if (rm.success) setRooms(rm.data || []);
    setLoading(false);
  }, []);
  useEffect(() => { fetchExams(); }, [fetchExams]);

  const saveExam = async () => {
    if (!editExam?.title) { toast('error', 'Judul wajib'); return; }
    if (!editExam.event_id) { toast('error', 'Pilih kegiatan terlebih dahulu'); return; }
    setSaving(true);
    const payload = {
      ...editExam,
      event_id: editExam.event_id,
      subject_name: editExam.subject_name || null,
      sequence_order: Number(editExam.sequence_order || 0),
      cheat_action: 'lock',
    };
    const r = editExam.id ? await PUT(`/api/admin/exams/${editExam.id}`, payload) : await POST('/api/admin/exams', payload);
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
  const openNewExam = () => {
    const defaultEvId = (selectedEventId !== 'ALL' && selectedEventId !== 'NO_EVENT')
      ? selectedEventId
      : (events.find(e => e.id === 'event-pmb')?.id || events[0]?.id || '');

    setEditExam({
      duration_minutes: 60,
      active_status: 'draft',
      event_id: defaultEvId,
      subject_name: '',
      sequence_order: 1,
      rules_text: DEFAULT_RULES_TEMPLATE,
      completion_message: DEFAULT_COMPLETION_MESSAGE,
    });
  };

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
            <p style={{ color: C.green, fontSize: '11px', fontWeight: 800, marginBottom: '4px' }}>
              {selectedExam.event_code || 'KEGIATAN'} · {selectedExam.event_name || 'Belum terhubung'}
              {selectedExam.subject_name ? ` · Mapel: ${selectedExam.subject_name}` : ''}
              {selectedExam.sequence_order ? ` · Urutan ${selectedExam.sequence_order}` : ''}
            </p>
            <p style={{ color: C.textMuted, fontSize: '11.5px' }}>
              {selectedExam.duration_minutes} menit · {selectedExam.question_count} soal
              {selectedExam.randomize_questions ? ' · Acak soal' : ''}
              {selectedExam.randomize_options ? ' · Acak opsi' : ''}
              {selectedExam.is_score_visible ? ' · Skor tampil' : ''}
              {selectedExam.target_jalur ? ` · Target: ${selectedExam.target_jalur}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button onClick={() => { setAttendanceEventId(selectedExam.event_id || null); setAttendanceExamId(selectedExam.id); setShowAttendanceModal(true); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.white, color: C.green, fontSize: '11.5px', fontWeight: 800, padding: '7px 13px', borderRadius: '10px', border: `1.5px solid ${C.greenBorder}`, cursor: 'pointer' }}>
              <FileDown size={13} strokeWidth={2} /> Cetak Absensi (.docx)
            </button>
            <button onClick={() => { setResultsExamId(selectedExam.id); setShowResultsModal(true); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.white, color: C.green, fontSize: '11.5px', fontWeight: 800, padding: '7px 13px', borderRadius: '10px', border: `1.5px solid ${C.greenBorder}`, cursor: 'pointer' }}>
              <FileDown size={13} strokeWidth={2} /> Cetak Hasil (.docx)
            </button>
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
        {activeTab === 'peserta' && <AssignmentsView examId={selectedExam.id} eventId={selectedExam.event_id} />}
        {activeTab === 'monitor' && <MonitorView examId={selectedExam.id} />}
        {activeTab === 'hasil' && <ResultsView examId={selectedExam.id} />}
        {activeTab === 'analitik' && <AnalyticsView examId={selectedExam.id} />}
      </div>

      <Modal open={!!editExam} onClose={() => setEditExam(null)} title={editExam?.id ? 'Edit Ujian' : 'Buat Ujian'} size="lg">
        {editExam && (
          <div className="space-y-3">
            <Input label="Judul" value={editExam.title || ''} onChange={e => setEditExam({ ...editExam, title: e.target.value })} />
            <Textarea label="Deskripsi" value={editExam.description || ''} rows={2} onChange={e => setEditExam({ ...editExam, description: e.target.value })} />
            <Select label="Kegiatan" value={editExam.event_id || ''} onChange={e => setEditExam({ ...editExam, event_id: e.target.value })}
              options={[{ value: '', label: 'Pilih kegiatan' }, ...events.map(event => ({ value: event.id, label: `${event.code} · ${event.name}` }))]} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Mapel / bagian" placeholder="Contoh: Matematika" value={editExam.subject_name || ''} onChange={e => setEditExam({ ...editExam, subject_name: e.target.value })} />
              <Input label="Urutan mapel" type="number" min={0} value={editExam.sequence_order ?? 1} onChange={e => setEditExam({ ...editExam, sequence_order: parseInt(e.target.value) || 0 })} />
            </div>
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
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-500">Tata Tertib</label>
                <button
                  type="button"
                  onClick={() => setEditExam({ ...editExam, rules_text: DEFAULT_RULES_TEMPLATE })}
                  className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 hover:underline flex items-center gap-1 cursor-pointer"
                  title="Gunakan template tata tertib bawaan"
                >
                  <Sparkles size={12} /> Isi Template Bawaan
                </button>
              </div>
              <RichEditor value={editExam.rules_text || ''} onChange={v => setEditExam({ ...editExam, rules_text: v })} minHeight={80} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-500">Pesan Selesai</label>
                <button
                  type="button"
                  onClick={() => setEditExam({ ...editExam, completion_message: DEFAULT_COMPLETION_MESSAGE })}
                  className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 hover:underline flex items-center gap-1 cursor-pointer"
                  title="Gunakan template pesan selesai bawaan"
                >
                  <Sparkles size={12} /> Isi Template Bawaan
                </button>
              </div>
              <Textarea
                value={editExam.completion_message || ''}
                rows={5}
                placeholder={'Contoh:\nTerima kasih sudah mengikuti ujian.\n- Tetap duduk di tempat\n- Tunggu instruksi proktor'}
                onChange={e => setEditExam({ ...editExam, completion_message: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-gray-600">
              {[{ k: 'randomize_questions', l: 'Acak Soal' }, { k: 'randomize_options', l: 'Acak Opsi' }, { k: 'is_score_visible', l: 'Tampilkan Skor' }, { k: 'enforce_fullscreen', l: 'Wajib Fullscreen' }].map(c => (
                <label key={c.k} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={!!(editExam as any)[c.k]} onChange={e => setEditExam({ ...editExam, [c.k]: e.target.checked ? 1 : 0 })} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  {c.l}
                </label>
              ))}
            </div>
            {/* ── Anti-Cheat ── */}
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-3">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
                <Shield size={14} className="text-amber-600" /> Pengaturan Anti-Cheat
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Input
                    type="number"
                    label="Batas Pelanggaran"
                    value={String((editExam as any).cheat_limit ?? 3)}
                    onChange={e => setEditExam({ ...editExam, cheat_limit: parseInt(e.target.value) || 3 })}
                  />
                  <p className="text-[10px] text-amber-700 mt-1">Berapa kali pelanggaran sebelum aksi dieksekusi</p>
                </div>
                <div>
                  <Select
                    label="Aksi Saat Batas Tercapai"
                    value="lock"
                    onChange={() => setEditExam({ ...editExam, cheat_action: 'lock' })}
                    options={[
                      { value: 'lock', label: '🔒 Kunci Sesi (Proktor buka)' },
                    ]}
                  />
                  <p className="text-[10px] text-amber-700 mt-1">"Kunci" = proktor bisa buka kembali sesi</p>
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
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>
            {filteredExams.length} dari {exams.length} ujian terdaftar
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { setAttendanceEventId(selectedEventId !== 'ALL' && selectedEventId !== 'NO_EVENT' ? selectedEventId : null); setAttendanceExamId('ALL'); setShowAttendanceModal(true); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.white, color: C.green, fontSize: '12px', fontWeight: 800, padding: '8px 14px', borderRadius: '10px', border: `1.5px solid ${C.greenBorder}`, cursor: 'pointer' }}>
            <FileDown size={13} strokeWidth={2.5} /> Cetak Absensi (.docx)
          </button>
          <button onClick={() => { setResultsExamId(null); setShowResultsModal(true); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.white, color: C.green, fontSize: '12px', fontWeight: 800, padding: '8px 14px', borderRadius: '10px', border: `1.5px solid ${C.greenBorder}`, cursor: 'pointer' }}>
            <FileDown size={13} strokeWidth={2.5} /> Cetak Hasil (.docx)
          </button>
          <button onClick={openNewExam}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
            <Plus size={13} strokeWidth={2.5} /> Buat Ujian
          </button>
        </div>
      </div>

      {/* ── FILTER JENIS KEGIATAN ── */}
      <div style={{ background: '#f8faf8', borderBottom: `1.5px solid ${C.border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: C.green, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', marginRight: '4px' }}>
          Kegiatan:
        </span>
        <button type="button" onClick={() => setSelectedEventId('ALL')}
          style={{
            padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1.5px solid ${selectedEventId === 'ALL' ? C.green : C.borderMid}`,
            background: selectedEventId === 'ALL' ? C.greenLight : C.white,
            color: selectedEventId === 'ALL' ? C.green : C.textMuted,
            transition: 'all 0.12s',
          }}>
          Semua Kegiatan ({exams.length})
        </button>
        {events.map(ev => {
          const count = exams.filter(x => x.event_id === ev.id).length;
          const isSelected = selectedEventId === ev.id;
          return (
            <button key={ev.id} type="button" onClick={() => setSelectedEventId(ev.id)}
              style={{
                padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
                border: `1.5px solid ${isSelected ? C.green : C.borderMid}`,
                background: isSelected ? C.greenLight : C.white,
                color: isSelected ? C.green : C.textMuted,
                transition: 'all 0.12s',
              }}>
              {ev.code} · {ev.name} ({count})
            </button>
          );
        })}
        {exams.some(x => !x.event_id) && (
          <button type="button" onClick={() => setSelectedEventId('NO_EVENT')}
            style={{
              padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1.5px solid ${selectedEventId === 'NO_EVENT' ? C.green : C.borderMid}`,
              background: selectedEventId === 'NO_EVENT' ? C.greenLight : C.white,
              color: selectedEventId === 'NO_EVENT' ? C.green : C.textMuted,
              transition: 'all 0.12s',
            }}>
            Tanpa Kegiatan ({exams.filter(x => !x.event_id).length})
          </button>
        )}
      </div>

      <div style={{ flex: 1, padding: '16px 20px' }}>
        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : filteredExams.length === 0 ? (
            <div className="py-10 text-center space-y-3 bg-white rounded-2xl border border-gray-200 p-6">
              <EmptyState title="Belum ada ujian pada kegiatan ini" desc="Klik tombol di bawah untuk membuat ujian baru." />
              <button onClick={openNewExam}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
                <Plus size={13} strokeWidth={2.5} /> Buat Ujian Baru
              </button>
            </div>
          ) : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '16px', overflow: 'hidden' }}>
              {filteredExams.map((exam, i) => (
                <div key={exam.id} onClick={() => openDetail(exam)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '13px 18px',
                    borderBottom: i < filteredExams.length - 1 ? `1px solid ${C.borderLight}` : 'none',
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
                    <p style={{ color: C.green, fontSize: '10.5px', fontWeight: 800, marginBottom: '3px' }}>
                      {exam.event_code || 'KEGIATAN'} · {exam.event_name || 'Belum terhubung'}
                      {exam.subject_name ? ` · Mapel: ${exam.subject_name}` : ''}
                      {exam.sequence_order ? ` · #${exam.sequence_order}` : ''}
                    </p>
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
            <Select label="Kegiatan" value={editExam.event_id || ''} onChange={e => setEditExam({ ...editExam, event_id: e.target.value })}
              options={[{ value: '', label: 'Pilih kegiatan' }, ...events.map(event => ({ value: event.id, label: `${event.code} · ${event.name}` }))]} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Mapel / bagian" placeholder="Contoh: Matematika" value={editExam.subject_name || ''} onChange={e => setEditExam({ ...editExam, subject_name: e.target.value })} />
              <Input label="Urutan mapel" type="number" min={0} value={editExam.sequence_order ?? 1} onChange={e => setEditExam({ ...editExam, sequence_order: parseInt(e.target.value) || 0 })} />
            </div>
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
            <Textarea
              label="Pesan Selesai"
              value={editExam.completion_message || ''}
              rows={5}
              placeholder={'Contoh:\nTerima kasih sudah mengikuti ujian.\n- Tetap duduk di tempat\n- Tunggu instruksi proktor'}
              onChange={e => setEditExam({ ...editExam, completion_message: e.target.value })}
            />
            <div className="flex flex-wrap gap-4 text-xs text-gray-600">
              {[{ k: 'randomize_questions', l: 'Acak Soal' }, { k: 'randomize_options', l: 'Acak Opsi' }, { k: 'is_score_visible', l: 'Tampilkan Skor' }, { k: 'enforce_fullscreen', l: 'Wajib Fullscreen' }].map(c => (
                <label key={c.k} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={!!(editExam as any)[c.k]} onChange={e => setEditExam({ ...editExam, [c.k]: e.target.checked ? 1 : 0 })} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  {c.l}
                </label>
              ))}
            </div>
            {/* ── Anti-Cheat ── */}
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-3">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
                <Shield size={14} className="text-amber-600" /> Pengaturan Anti-Cheat
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Input
                    type="number"
                    label="Batas Pelanggaran"
                    value={String((editExam as any).cheat_limit ?? 3)}
                    onChange={e => setEditExam({ ...editExam, cheat_limit: parseInt(e.target.value) || 3 })}
                  />
                  <p className="text-[10px] text-amber-700 mt-1">Berapa kali pelanggaran sebelum aksi dieksekusi</p>
                </div>
                <div>
                  <Select
                    label="Aksi Saat Batas Tercapai"
                    value="lock"
                    onChange={() => setEditExam({ ...editExam, cheat_action: 'lock' })}
                    options={[
                      { value: 'lock', label: '🔒 Kunci Sesi (Proktor buka)' },
                    ]}
                  />
                  <p className="text-[10px] text-amber-700 mt-1">"Kunci" = proktor bisa buka kembali sesi</p>
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

      <DownloadAttendanceModal
        open={showAttendanceModal}
        onClose={() => setShowAttendanceModal(false)}
        initialEventId={attendanceEventId}
        initialExamId={attendanceExamId}
        events={events}
        exams={exams}
        rooms={rooms}
      />

      <DownloadExamResultsModal
        open={showResultsModal}
        onClose={() => setShowResultsModal(false)}
        initialExamId={resultsExamId}
        events={events}
        exams={exams}
        rooms={rooms}
      />
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
                  <MathContent
                    html={q.question_text}
                    className="flex-1 min-w-0"
                    style={{ fontSize: '12.5px', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  />
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
                <p className="text-[10px] text-gray-400">Untuk rumus, ketik dengan delimiter <code>$...$</code> atau <code>$$...$$</code>.</p>
                {editQ.options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="radio" name="correct" checked={!!o.is_correct} onChange={() => updOpt(i, 'is_correct', true)} className="text-primary-600" />
                    <span className="text-xs font-semibold text-gray-400 w-4">{o.option_label}</span>
                    <input value={o.option_text} onChange={e => updOpt(i, 'option_text', e.target.value)} placeholder={`Opsi ${o.option_label} — contoh $x^2$`} dir="auto"
                      className={`flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 ${isFullArabic(o.option_text) ? 'arabic' : ''}`} />
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
  const [regenId, setRegenId] = useState<string | null>(null);
  const [toggleId, setToggleId] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState('');
  const [settingManual, setSettingManual] = useState(false);
  const [filterRoom, setFilterRoom] = useState('all');
  const [filterGroup, setFilterGroup] = useState('all');
  const fetchT = useCallback(async () => { const r = await GET(`/api/admin/exams/${examId}/tokens`); if (r.success) setTokens(r.data || []); setLoading(false); }, [examId]);
  useEffect(() => { fetchT(); }, [fetchT]);
  const generate = async () => { setGen(true); const r = await POST(`/api/admin/exams/${examId}/tokens/generate`, {}); setGen(false); toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal'); fetchT(); };
  const regenerateOne = async (tokenId: string) => {
    setRegenId(tokenId);
    const r = await POST(`/api/admin/exams/${examId}/tokens/generate`, { token_id: tokenId });
    setRegenId(null);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal');
    fetchT();
  };
  const setTokenManual = async () => {
    const token_code = manualToken.trim().toUpperCase();
    if (!token_code) { toast('error', 'Isi token manual dulu'); return; }
    setSettingManual(true);
    const r = await POST(`/api/admin/exams/${examId}/tokens/set-code`, { token_code });
    setSettingManual(false);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal');
    if (r.success) { setManualToken(token_code); fetchT(); }
  };
  const toggleTokenActive = async (token: any) => {
    setToggleId(token.id);
    const nextActive = Number(token.is_active) === 1 ? 0 : 1;
    const r = await POST(`/api/admin/exams/${examId}/tokens/${token.id}/active`, { is_active: nextActive });
    setToggleId(null);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal mengubah status token');
    if (r.success) fetchT();
  };
  const rooms = Array.from(new Set(tokens.map((t: any) => t.room_name))).sort();
  const groups = Array.from(new Map(tokens.map((t: any) => [`${t.tanggal_tes || ''}|${t.sesi_tes || ''}`, {
    key: `${t.tanggal_tes || ''}|${t.sesi_tes || ''}`,
    tanggal_tes: t.tanggal_tes || '',
    sesi_tes: t.sesi_tes || '',
  }])).values()).sort((a: any, b: any) => `${a.tanggal_tes} ${a.sesi_tes}`.localeCompare(`${b.tanggal_tes} ${b.sesi_tes}`));
  const visible = tokens.filter((t: any) => {
    if (filterRoom !== 'all' && t.room_name !== filterRoom) return false;
    if (filterGroup !== 'all' && `${t.tanggal_tes || ''}|${t.sesi_tes || ''}` !== filterGroup) return false;
    return true;
  });
  const formatDate = (value?: string) => {
    if (!value) return 'Tanpa tanggal';
    const raw = String(value).trim();
    const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const dt = new Date(`${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}T00:00:00+07:00`);
      if (!Number.isNaN(dt.getTime())) return dt.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }
    const clean = raw.replace(/^[A-Za-zÀ-ÿ]+,\s*/i, '').trim();
    const monthMap: Record<string, number> = {
      januari: 1, jan: 1, februari: 2, feb: 2, maret: 3, mar: 3, april: 4, apr: 4,
      mei: 5, juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, ags: 8,
      september: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, desember: 12, des: 12,
    };
    const parts = clean.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/i);
    if (parts) {
      const month = monthMap[parts[2].toLowerCase()];
      if (month) {
        const dt = new Date(`${parts[3]}-${String(month).padStart(2, '0')}-${parts[1].padStart(2, '0')}T00:00:00+07:00`);
        if (!Number.isNaN(dt.getTime())) return dt.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      }
    }
    return raw;
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{visible.length} Token</span>
          <p style={{ color: C.textFaint, fontSize: '11px', marginTop: '2px' }}>Token dibuat per tanggal, sesi, dan ruangan.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {groups.length > 1 && (
            <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer', maxWidth: '220px' }}>
              <option value="all">Semua Sesi</option>
              {groups.map((g: any) => <option key={g.key} value={g.key}>{formatDate(g.tanggal_tes)} · {g.sesi_tes || 'Tanpa sesi'}</option>)}
            </select>
          )}
          {rooms.length > 1 && (
            <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}>
              <option value="all">Semua Ruangan</option>
              {rooms.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <input
            value={manualToken}
            onChange={e => setManualToken(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 20))}
            placeholder="TOKEN SAMA"
            style={{ width: '128px', fontSize: '12px', fontWeight: 800, letterSpacing: '0.08em', padding: '7px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', background: C.white, color: C.text, outline: 'none', textTransform: 'uppercase' }}
          />
          <Button variant="secondary" size="sm" loading={settingManual} disabled={!manualToken.trim()} onClick={setTokenManual}>Set Semua</Button>
          <Button size="sm" loading={gen} onClick={generate}><RefreshCw size={13} /> Generate Semua</Button>
        </div>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : visible.length === 0 ? <EmptyState title="Belum ada token" />
          : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((t: any) => (
                <div key={t.id} style={{ background: C.white, border: `1.5px solid ${Number(t.is_active) === 1 ? C.borderMid : '#fecaca'}`, borderRadius: '12px', padding: '14px 16px', opacity: Number(t.is_active) === 1 ? 1 : 0.72 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '8px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <p style={{ color: C.textMuted, fontSize: '11px', fontWeight: 700 }}>{t.room_name}</p>
                        <span style={{ background: Number(t.is_active) === 1 ? C.greenLight : '#fef2f2', color: Number(t.is_active) === 1 ? C.green : '#dc2626', border: `1px solid ${Number(t.is_active) === 1 ? C.greenBorder : '#fecaca'}`, borderRadius: '999px', padding: '1px 7px', fontSize: '9.5px', fontWeight: 800 }}>
                          {Number(t.is_active) === 1 ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </div>
                      <p style={{ color: C.textFaint, fontSize: '10.5px', marginTop: '2px' }}>{formatDate(t.tanggal_tes)} · {t.sesi_tes || 'Tanpa sesi'}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      <button onClick={() => toggleTokenActive(t)} disabled={toggleId === t.id}
                        title={Number(t.is_active) === 1 ? 'Nonaktifkan token ruangan/sesi ini' : 'Aktifkan token ruangan/sesi ini'}
                        style={{ width: '28px', height: '28px', borderRadius: '8px', border: `1.5px solid ${Number(t.is_active) === 1 ? '#fecaca' : C.greenBorder}`, background: Number(t.is_active) === 1 ? '#fef2f2' : C.greenLight, color: Number(t.is_active) === 1 ? '#dc2626' : C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: toggleId === t.id ? 'wait' : 'pointer' }}>
                        <Power size={13} />
                      </button>
                      <button onClick={() => regenerateOne(t.id)} disabled={regenId === t.id}
                        title="Regenerate token ini"
                        style={{ width: '28px', height: '28px', borderRadius: '8px', border: `1.5px solid ${C.greenBorder}`, background: C.greenLight, color: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: regenId === t.id ? 'wait' : 'pointer' }}>
                        <RefreshCw size={13} />
                      </button>
                    </div>
                  </div>
                  <p style={{ color: Number(t.is_active) === 1 ? C.green : C.textMuted, fontSize: '22px', fontWeight: 900, letterSpacing: '0.18em', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>{t.token_code}</p>
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
  const [filterRoom, setFilterRoom] = useState('all');
  const [filterSession, setFilterSession] = useState('all');
  const fetchS = useCallback(async () => { const r = await GET(`/api/admin/exams/${examId}/sessions`); if (r.success) setSessions(r.data || []); setLoading(false); }, [examId]);
  useEffect(() => { fetchS(); const iv = setInterval(fetchS, 10000); return () => clearInterval(iv); }, [fetchS]);
  const rooms = Array.from(new Set(sessions.map((s: any) => s.room_name).filter(Boolean))).sort();
  const sessionOptions = buildSessionFilters(sessions);
  const visible = sessions.filter((s: any) => {
    if (filterSession !== 'all' && sessionFilterKey(s) !== filterSession) return false;
    if (filterRoom !== 'all' && s.room_name !== filterRoom) return false;
    return true;
  });
  const online = visible.filter((s: any) => s.status === 'active' && (Date.now() - parseServerTime(s.last_heartbeat)) < 30000).length;
  const done = visible.filter((s: any) => s.status === 'submitted').length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{visible.length} Peserta</span>
          {visible.length > 0 && (
            <>
              <span style={{ background: C.greenLight, color: C.green, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>🟢 {online} Online</span>
              <span style={{ background: '#f1f1f0', color: '#6b7c6e', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>✓ {done} Selesai</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {sessionOptions.length > 1 && (
            <select value={filterSession} onChange={e => setFilterSession(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer', maxWidth: '220px' }}>
              <option value="all">Semua Sesi</option>
              {sessionOptions.map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
          {rooms.length > 1 && (
            <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}>
              <option value="all">Semua Ruangan</option>
              {rooms.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px' }}>Auto-refresh 10s</span>
        </div>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : visible.length === 0 ? <EmptyState title="Belum ada sesi" />
          : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
              {visible.map((s: any, i: number) => {
                const isOnline = s.status === 'active' && (Date.now() - parseServerTime(s.last_heartbeat)) < 30000;
                const isDone = s.status === 'submitted';
                const isLocked = s.is_time_locked && !isDone;
                const violationTotal = Number(s.cheat_log_count || s.cheat_warnings || 0);
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderBottom: i < visible.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                    <span style={{ flex: 1, color: C.text, fontSize: '12.5px', fontWeight: 700 }}>{s.full_name}</span>
                    <span style={{ color: C.textFaint, fontSize: '10.5px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionFilterLabel(s)}</span>
                    <span style={{ color: '#6b7c6e', fontSize: '11.5px' }}>{s.room_name}</span>
                    <span style={{ background: isDone ? '#f1f1f0' : isLocked ? '#fef3c7' : isOnline ? C.greenLight : '#fef2f2', color: isDone ? '#6b7c6e' : isLocked ? '#92400e' : isOnline ? '#2d6644' : '#dc2626', fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px' }}>
                      {isDone ? 'Selesai' : isLocked ? '🔒 Dikunci' : isOnline ? 'Online' : 'Offline'}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: violationTotal > 0 ? 700 : 400, color: violationTotal > 0 ? '#dc2626' : C.textFaint }}>
                      {violationTotal} ⚠
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
  const { toast } = useToast();
  const [results, setResults] = useState<any[]>([]);
  const [exportRows, setExportRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [filterRoom, setFilterRoom] = useState('all');
  const [filterSession, setFilterSession] = useState('all');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'score', dir: 'desc' });
  const fetchResults = useCallback(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      GET(`/api/admin/exams/${examId}/results`),
      GET(`/api/admin/exams/${examId}/results-export`),
    ]).then(([resultResponse, exportResponse]) => {
      if (!alive) return;
      if (resultResponse.success) setResults(resultResponse.data || []);
      if (exportResponse.success) setExportRows(exportResponse.data || []);
      setLoading(false);
    }).catch(() => {
      if (!alive) return;
      toast('error', 'Gagal memuat hasil ujian');
      setLoading(false);
    });
    return () => { alive = false; };
  }, [examId, toast]);
  useEffect(() => {
    return fetchResults();
  }, [fetchResults]);

  const deleteResultSession = async (sessionId: string, studentName: string) => {
    if (!confirm(`Hapus hasil pengerjaan "${studentName}"? Data nilai dan jawaban akan dibersihkan.`)) return;
    const res = await DEL(`/api/admin/exams/${examId}/results/${sessionId}`);
    if (res.success) {
      toast('success', res.message || 'Hasil berhasil dihapus');
      fetchResults();
    } else {
      toast('error', res.error || 'Gagal menghapus hasil');
    }
  };

  const filterSource = exportRows.length ? exportRows : results;
  const rooms = Array.from(new Set(filterSource.map((r: any) => r.room_name).filter(Boolean))).sort();
  const sessionOptions = buildSessionFilters(filterSource);
  const visible = results.filter((r: any) => {
    if (filterSession !== 'all' && sessionFilterKey(r) !== filterSession) return false;
    if (filterRoom !== 'all' && r.room_name !== filterRoom) return false;
    return true;
  });
  const exportVisible = exportRows.filter((r: any) => {
    if (filterSession !== 'all' && sessionFilterKey(r) !== filterSession) return false;
    if (filterRoom !== 'all' && r.room_name !== filterRoom) return false;
    return true;
  });
  const resultSortColumns = [
    { key: 'full_name', label: 'Nama' },
    { key: 'asal_sekolah', label: 'Asal Sekolah' },
    { key: 'session', label: 'Sesi' },
    { key: 'room_name', label: 'Ruangan' },
    { key: 'total_correct', label: 'Benar', center: true },
    { key: 'total_wrong', label: 'Salah', center: true },
    { key: 'score', label: 'Nilai', center: true },
    { key: 'actions', label: 'Aksi', center: true },
  ];
  const getSortValue = (row: any, key: string) => {
    if (key === 'session') return sessionFilterLabel(row);
    if (['total_correct', 'total_wrong', 'score'].includes(key)) return Number(row[key] || 0);
    return String(row[key] || '').toLowerCase();
  };
  const sortRows = (rows: any[]) => [...rows].sort((a: any, b: any) => {
    const av = getSortValue(a, sort.key);
    const bv = getSortValue(b, sort.key);
    const compared = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sort.dir === 'asc' ? compared : -compared;
  });
  const sortedVisible = sortRows(visible);
  const sortedExportVisible = sortRows(exportVisible);
  const toggleSort = (key: string) => setSort(prev => prev.key === key
    ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: ['total_correct', 'total_wrong', 'score'].includes(key) ? 'desc' : 'asc' });
  const handleExport = async () => {
    const rows = sortedExportVisible.length ? sortedExportVisible : sortedVisible;
    if (!rows.length) {
      toast('warning', 'Tidak ada peserta untuk diexport pada filter ini');
      return;
    }
    setExporting(true);
    try {
      await exportExamResults(rows, `ujian-${examId}${filterSession !== 'all' ? `-${filterSession.replace(/[^a-zA-Z0-9]+/g, '-')}` : ''}${filterRoom !== 'all' ? `-${filterRoom}` : ''}`);
    } finally {
      setExporting(false);
    }
  };
  const recoverMissingResults = async () => {
    setRecovering(true);
    const r = await POST<{ repaired: number }>(`/api/admin/exams/${examId}/results/recompute-missing`, {});
    setRecovering(false);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal memulihkan hasil');
    if (r.success) fetchResults();
  };
  const avgScore = visible.length ? Math.round(visible.reduce((s: number, r: any) => s + (r.score ?? 0), 0) / visible.length) : 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{visible.length} Hasil</span>
          {visible.length > 0 && <span style={{ background: C.greenLight, color: C.green, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>Rata-rata {avgScore}</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {sessionOptions.length > 1 && (
            <select value={filterSession} onChange={e => setFilterSession(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer', maxWidth: '220px' }}>
              <option value="all">Semua Sesi</option>
              {sessionOptions.map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
          {rooms.length > 1 && (
            <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}>
              <option value="all">Semua Ruangan</option>
              {rooms.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          {!loading && <Button variant="secondary" size="sm" loading={recovering} onClick={recoverMissingResults}><RefreshCw size={13} /> Pulihkan</Button>}
          {!loading && <Button variant="secondary" size="sm" loading={exporting} onClick={handleExport}><FileDown size={13} /> Export</Button>}
        </div>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : visible.length === 0 ? <EmptyState title="Belum ada hasil" />
          : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                    <th style={{ padding: '9px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>#</th>
                    {resultSortColumns.map(col => (
                      <th key={col.key} style={{ padding: '0', textAlign: col.center ? 'center' : 'left', whiteSpace: 'nowrap' }}>
                        <button onClick={() => toggleSort(col.key)}
                          style={{
                            width: '100%',
                            padding: '9px 14px',
                            textAlign: col.center ? 'center' : 'left',
                            color: sort.key === col.key ? C.green : C.textMid,
                            fontSize: '10.5px',
                            fontWeight: sort.key === col.key ? 900 : 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                          }}>
                          {col.label} {sort.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedVisible.map((r: any, i: number) => (
                    <tr key={i} style={{ borderBottom: i < sortedVisible.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                      <td style={{ padding: '10px 14px', color: C.textMuted, fontWeight: 600 }}>{i + 1}</td>
                      <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{r.full_name}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted }}>{r.asal_sekolah || '—'}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted, fontSize: '11px' }}>{sessionFilterLabel(r)}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted }}>{r.room_name}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', color: C.green, fontWeight: 700 }}>{r.total_correct}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>{r.total_wrong}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', color: C.text, fontWeight: 900 }}>{r.score}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <button onClick={() => deleteResultSession(r.session_id, r.full_name)}
                          title="Hapus Hasil Ujian"
                          style={{ width: '26px', height: '26px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '7px', background: '#fef2f2', border: '1.5px solid #fecaca', cursor: 'pointer', color: '#dc2626' }}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}
// ── ASSIGNMENTS VIEW ─────────────────────────────────────────
// ── ANALYTICS VIEW ────────────────────────────────────────────
function AnalyticsView({ examId }: { examId: string }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [questionAnalytics, setQuestionAnalytics] = useState<any>({ questions: [], options: [], rows: [] });
  const [loading, setLoading] = useState(true);
  const [filterRoom, setFilterRoom] = useState('all');
  const [filterSession, setFilterSession] = useState('all');
  const [analyticsTab, setAnalyticsTab] = useState<'ringkasan' | 'nilai' | 'pelanggaran' | 'soal' | 'sesi'>('ringkasan');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      GET(`/api/admin/exams/${examId}/sessions`),
      GET(`/api/admin/exams/${examId}/results`),
      GET(`/api/admin/exams/${examId}/question-analytics`),
    ])
      .then(([s, r, q]) => {
        if (s.success) setSessions(s.data || []);
        if (r.success) setResults(r.data || []);
        if (q.success) setQuestionAnalytics(q.data || { questions: [], options: [], rows: [] });
      })
      .finally(() => setLoading(false));
  }, [examId]);

  const rooms = useMemo(() => Array.from(new Set([...sessions, ...results].map((x: any) => x.room_name).filter(Boolean))).sort(), [sessions, results]);
  const sessionOptions = useMemo(() => buildSessionFilters([...sessions, ...results]), [sessions, results]);
  const filteredSessions = sessions.filter((s: any) => {
    if (filterSession !== 'all' && sessionFilterKey(s) !== filterSession) return false;
    if (filterRoom !== 'all' && s.room_name !== filterRoom) return false;
    return true;
  });
  const filteredResults = results.filter((r: any) => {
    if (filterSession !== 'all' && sessionFilterKey(r) !== filterSession) return false;
    if (filterRoom !== 'all' && r.room_name !== filterRoom) return false;
    return true;
  });

  const submittedIds = new Set(filteredResults.map((r: any) => r.session_id));
  const started = filteredSessions.length;
  const finished = filteredSessions.filter((s: any) => s.status === 'submitted' || submittedIds.has(s.id)).length;
  const locked = filteredSessions.filter((s: any) => Number(s.is_time_locked) === 1 && s.status !== 'submitted').length;
  const totalViolations = filteredSessions.reduce((sum: number, s: any) => sum + Number(s.cheat_log_count || s.cheat_warnings || 0), 0);
  const avgScore = filteredResults.length ? Math.round(filteredResults.reduce((sum: number, r: any) => sum + Number(r.score || 0), 0) / filteredResults.length) : 0;
  const scores = filteredResults.map((r: any) => Number(r.score || 0));
  const maxScore = scores.length ? Math.max(...scores) : 0;
  const minScore = scores.length ? Math.min(...scores) : 0;
  const totalCorrect = filteredResults.reduce((sum: number, r: any) => sum + Number(r.total_correct || 0), 0);
  const totalWrong = filteredResults.reduce((sum: number, r: any) => sum + Number(r.total_wrong || 0), 0);
  const totalUnanswered = filteredResults.reduce((sum: number, r: any) => sum + Number(r.total_unanswered || 0), 0);

  const scoreBuckets = [
    { label: '0-40', count: scores.filter(score => score <= 40).length },
    { label: '41-60', count: scores.filter(score => score > 40 && score <= 60).length },
    { label: '61-75', count: scores.filter(score => score > 60 && score <= 75).length },
    { label: '76-90', count: scores.filter(score => score > 75 && score <= 90).length },
    { label: '91-100', count: scores.filter(score => score > 90).length },
  ];
  const maxBucket = Math.max(1, ...scoreBuckets.map(b => b.count));
  const topScorers = [...filteredResults]
    .sort((a: any, b: any) => Number(b.score || 0) - Number(a.score || 0) || String(a.full_name || '').localeCompare(String(b.full_name || '')))
    .slice(0, 10);

  const resultGroups = filteredResults.reduce((map: Map<string, number[]>, r: any) => {
    const key = `${sessionFilterKey(r)}|${r.room_name || 'Tanpa ruangan'}`;
    const list = map.get(key) || [];
    list.push(Number(r.score || 0));
    map.set(key, list);
    return map;
  }, new Map());
  const roomSessionRows = Array.from(filteredSessions.reduce((map: Map<string, any>, s: any) => {
    const key = `${sessionFilterKey(s)}|${s.room_name || 'Tanpa ruangan'}`;
    const row = map.get(key) || { key, label: sessionFilterLabel(s), room: s.room_name || 'Tanpa ruangan', peserta: 0, selesai: 0, dikunci: 0, pelanggaran: 0 };
    row.peserta += 1;
    if (s.status === 'submitted' || submittedIds.has(s.id)) row.selesai += 1;
    if (Number(s.is_time_locked) === 1 && s.status !== 'submitted') row.dikunci += 1;
    row.pelanggaran += Number(s.cheat_log_count || s.cheat_warnings || 0);
    map.set(key, row);
    return map;
  }, new Map()).values()).map((row: any) => {
    const scoresForRow = resultGroups.get(row.key) || [];
    return { ...row, rata: scoresForRow.length ? Math.round(scoresForRow.reduce((a: number, b: number) => a + b, 0) / scoresForRow.length) : 0 };
  }).sort((a: any, b: any) => `${a.label} ${a.room}`.localeCompare(`${b.label} ${b.room}`));

  const topViolations = filteredSessions
    .map((s: any) => ({ ...s, total: Number(s.cheat_log_count || s.cheat_warnings || 0) }))
    .filter((s: any) => s.total > 0)
    .sort((a: any, b: any) => b.total - a.total)
    .slice(0, 5);

  const qaRows = (questionAnalytics.rows || []).filter((row: any) => {
    if (filterSession !== 'all' && sessionFilterKey(row) !== filterSession) return false;
    if (filterRoom !== 'all' && row.room_name !== filterRoom) return false;
    return true;
  });
  const sessionCount = new Set(qaRows.map((row: any) => row.session_id)).size;
  const optionCounts = qaRows.reduce((map: Map<string, number>, row: any) => {
    if (row.selected_option_id) map.set(row.selected_option_id, (map.get(row.selected_option_id) || 0) + 1);
    return map;
  }, new Map());
  const questionRows = (questionAnalytics.questions || []).map((q: any) => {
    const rows = qaRows.filter((row: any) => row.question_id === q.id);
    const answered = rows.filter((row: any) => Number(row.answered) === 1).length;
    const correct = rows.filter((row: any) => Number(row.is_correct) === 1).length;
    const blank = Math.max(0, sessionCount - answered);
    const wrong = Math.max(0, answered - correct);
    const correctRate = sessionCount ? Math.round((correct / sessionCount) * 100) : 0;
    const difficulty = correctRate >= 76 ? 'Mudah' : correctRate >= 41 ? 'Sedang' : 'Sulit';
    const flag = sessionCount === 0
      ? 'Belum ada data'
      : correctRate <= 20
        ? 'Perlu review'
        : blank / Math.max(1, sessionCount) >= 0.3
          ? 'Banyak kosong'
          : '';
    const options = (questionAnalytics.options || [])
      .filter((option: any) => option.question_id === q.id)
      .map((option: any) => ({ ...option, count: optionCounts.get(option.id) || 0 }));
    return {
      ...q,
      answered_count: answered,
      correct_count: correct,
      wrong_count: wrong,
      blank_count: blank,
      correct_rate: correctRate,
      difficulty,
      flag,
      options,
    };
  });
  const hardQuestions = questionRows
    .filter((q: any) => q.question_type === 'multiple_choice' && sessionCount > 0)
    .sort((a: any, b: any) => a.correct_rate - b.correct_rate)
    .slice(0, 5);
  const suspiciousQuestions = questionRows.filter((q: any) => q.flag).slice(0, 6);
  const avgDuration = (() => {
    const durations = filteredSessions
      .map((s: any) => {
        if (!s.started_at || !s.finished_at) return 0;
        const diff = parseServerTime(s.finished_at) - parseServerTime(s.started_at);
        return diff > 0 ? Math.round(diff / 60000) : 0;
      })
      .filter(Boolean);
    return durations.length ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;
  })();

  const statStyle = (accent: string = C.greenLight) => ({ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px', boxShadow: `inset 0 4px 0 ${accent}` });
  const statText = { color: C.text, fontSize: '24px', fontWeight: 900, lineHeight: 1 };
  const statLabel = { color: C.textMuted, fontSize: '11px', marginTop: '6px', fontWeight: 700 };
  const analyticsTabs: { key: typeof analyticsTab; label: string }[] = [
    { key: 'ringkasan', label: 'Ringkasan' },
    { key: 'nilai', label: 'Nilai' },
    { key: 'pelanggaran', label: 'Pelanggaran' },
    { key: 'soal', label: 'Soal' },
    { key: 'sesi', label: 'Sesi/Ruangan' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Analitik Ujian</span>
          <p style={{ color: C.textFaint, fontSize: '11px', marginTop: '2px' }}>Ringkasan progres, nilai, pelanggaran, dan performa sesi/ruangan.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {sessionOptions.length > 1 && (
            <select value={filterSession} onChange={e => setFilterSession(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer', maxWidth: '240px' }}>
              <option value="all">Semua Sesi</option>
              {sessionOptions.map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
          {rooms.length > 1 && (
            <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}>
              <option value="all">Semua Ruangan</option>
              {rooms.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          {questionRows.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => exportExamAnalytics(questionRows, `ujian-${examId}`)}>
              <FileDown size={13} /> Export Analitik
            </Button>
          )}
        </div>
      </div>

      <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', padding: '0 10px', display: 'flex', gap: '4px', overflowX: 'auto' }}>
        {analyticsTabs.map(tab => (
          <button key={tab.key} onClick={() => setAnalyticsTab(tab.key)}
            style={{
              padding: '10px 12px 9px',
              fontSize: '11.5px',
              fontWeight: analyticsTab === tab.key ? 900 : 700,
              color: analyticsTab === tab.key ? C.green : C.textMuted,
              background: 'none',
              border: 'none',
              borderBottom: `2.5px solid ${analyticsTab === tab.key ? C.green : 'transparent'}`,
              marginBottom: '-1.5px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))', gap: '10px' }}>
              {[
                ['Peserta', started, C.greenLight],
                ['Selesai', finished, '#eef2ff'],
                ['Belum Selesai', Math.max(0, started - finished), '#f1f1f0'],
                ['Dikunci', locked, '#fffbeb'],
                ['Pelanggaran', totalViolations, '#fef2f2'],
                ['Rata-rata', avgScore, C.greenLight],
                ['Durasi Avg', `${avgDuration}m`, '#e0f0ff'],
              ].map(([label, value, color]) => (
                <div key={String(label)} style={statStyle(String(color))}>
                  <p style={statText}>{value}</p>
                  <p style={statLabel}>{label}</p>
                </div>
              ))}
            </div>

            {analyticsTab === 'nilai' && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Distribusi Nilai</p>
                <div className="space-y-2">
                  {scoreBuckets.map(bucket => (
                    <div key={bucket.label} style={{ display: 'grid', gridTemplateColumns: '52px 1fr 34px', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: C.textMuted, fontSize: '11px', fontWeight: 700 }}>{bucket.label}</span>
                      <div style={{ height: '9px', borderRadius: '999px', background: '#edf0ed', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round((bucket.count / maxBucket) * 100)}%`, height: '100%', background: C.green, borderRadius: '999px' }} />
                      </div>
                      <span style={{ color: C.text, fontSize: '11px', fontWeight: 800, textAlign: 'right' }}>{bucket.count}</span>
                    </div>
                  ))}
                </div>
                <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '12px' }}>Tertinggi {maxScore} - Terendah {minScore} - Rata-rata {avgScore}</p>
              </div>

              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Top Siswa Nilai Tertinggi</p>
                {topScorers.length === 0
                  ? <p style={{ color: C.textFaint, fontSize: '12px' }}>Belum ada nilai pada filter ini.</p>
                  : topScorers.map((r: any, i: number) => (
                    <div key={r.session_id || `${r.user_id}-${i}`} style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: i < topScorers.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                      <span style={{ width: '26px', height: '26px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: i < 3 ? C.green : '#edf0ed', color: i < 3 ? C.white : C.textMuted, fontSize: '11px', fontWeight: 900 }}>{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ color: C.text, fontSize: '12px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.full_name}</p>
                        <p style={{ color: C.textFaint, fontSize: '10.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nisn || 'Tanpa NISN'} - {sessionFilterLabel(r)} - {r.room_name || 'Tanpa ruangan'}</p>
                      </div>
                      <span style={{ color: C.green, fontSize: '18px', fontWeight: 900 }}>{Number(r.score || 0)}</span>
                    </div>
                  ))}
              </div>
            </div>
            )}

            {analyticsTab === 'pelanggaran' && (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
              <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Pelanggaran Terbanyak</p>
              {topViolations.length === 0
                ? <p style={{ color: C.textFaint, fontSize: '12px' }}>Belum ada pelanggaran pada filter ini.</p>
                : topViolations.map((s: any) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${C.borderLight}` }}>
                    <div>
                      <p style={{ color: C.text, fontSize: '12px', fontWeight: 800 }}>{s.full_name}</p>
                      <p style={{ color: C.textFaint, fontSize: '10.5px' }}>{sessionFilterLabel(s)} - {s.room_name}</p>
                    </div>
                    <span style={{ color: '#dc2626', fontSize: '13px', fontWeight: 900 }}>{s.total}</span>
                  </div>
                ))}
            </div>
            )}

            {analyticsTab === 'ringkasan' && (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
              <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Kualitas Jawaban</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '10px' }}>
                {[
                  ['Benar', totalCorrect, C.green],
                  ['Salah', totalWrong, '#dc2626'],
                  ['Kosong', totalUnanswered, C.textMuted],
                ].map(([label, value, color]) => (
                  <div key={String(label)} style={{ background: C.bg, borderRadius: '12px', padding: '12px', textAlign: 'center' }}>
                    <p style={{ color: String(color), fontSize: '22px', fontWeight: 900, lineHeight: 1 }}>{value}</p>
                    <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '4px' }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>
            )}

            {analyticsTab === 'soal' && (
            <>
            <div className="grid gap-3 lg:grid-cols-2">
              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Soal Paling Sulit</p>
                {hardQuestions.length === 0
                  ? <p style={{ color: C.textFaint, fontSize: '12px' }}>Belum ada data soal pilihan ganda.</p>
                  : hardQuestions.map((q: any) => (
                    <div key={q.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.borderLight}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                        <p style={{ color: C.text, fontSize: '12px', fontWeight: 800 }}>No. {q.question_order}</p>
                        <span style={{ color: q.correct_rate <= 20 ? '#dc2626' : '#b45309', fontSize: '11px', fontWeight: 900 }}>{q.correct_rate}% benar</span>
                      </div>
                      <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '3px', lineHeight: 1.4 }}>{String(q.question_text || '').replace(/<[^>]+>/g, '').slice(0, 150)}</p>
                    </div>
                  ))}
              </div>

              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Deteksi Soal Mencurigakan</p>
                {suspiciousQuestions.length === 0
                  ? <p style={{ color: C.textFaint, fontSize: '12px' }}>Tidak ada soal yang perlu perhatian khusus pada filter ini.</p>
                  : suspiciousQuestions.map((q: any) => (
                    <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${C.borderLight}` }}>
                      <div>
                        <p style={{ color: C.text, fontSize: '12px', fontWeight: 800 }}>No. {q.question_order} - {q.difficulty}</p>
                        <p style={{ color: C.textFaint, fontSize: '10.5px' }}>{q.blank_count} kosong, {q.wrong_count} salah, {q.correct_count} benar</p>
                      </div>
                      <span style={{ background: '#fef2f2', color: '#dc2626', borderRadius: '999px', padding: '2px 8px', fontSize: '10px', fontWeight: 800, height: 'fit-content' }}>{q.flag}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', overflow: 'auto' }}>
              <div style={{ padding: '14px 14px 0' }}>
                <p style={{ color: C.text, fontSize: '13px', fontWeight: 800 }}>Analitik Per Soal & Opsi</p>
                <p style={{ color: C.textFaint, fontSize: '11px', marginTop: '2px' }}>Sebaran jawaban membantu melihat pengecoh yang terlalu kuat atau soal yang perlu review.</p>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '980px', marginTop: '10px' }}>
                <TableHead cols={[{ label: 'No' }, { label: 'Ringkasan Soal' }, { label: 'Benar', center: true }, { label: 'Salah', center: true }, { label: 'Kosong', center: true }, { label: '% Benar', center: true }, { label: 'Opsi Dipilih' }, { label: 'Catatan' }]} />
                <tbody>
                  {questionRows.length === 0
                    ? <tr><td colSpan={8} style={{ padding: '18px', textAlign: 'center', color: C.textFaint }}>Belum ada data soal</td></tr>
                    : questionRows.map((q: any, i: number) => (
                      <tr key={q.id} style={{ borderBottom: i < questionRows.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                        <td style={{ padding: '10px 14px', color: C.text, fontWeight: 900 }}>{q.question_order}</td>
                        <td style={{ padding: '10px 14px', color: C.textMuted, maxWidth: '300px' }}>{String(q.question_text || '').replace(/<[^>]+>/g, '').slice(0, 120)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: C.green, fontWeight: 800 }}>{q.correct_count}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: '#dc2626', fontWeight: 800 }}>{q.wrong_count}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: C.textMuted, fontWeight: 800 }}>{q.blank_count}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 900, color: q.correct_rate <= 20 ? '#dc2626' : q.correct_rate <= 40 ? '#b45309' : C.green }}>{q.correct_rate}%</td>
                        <td style={{ padding: '10px 14px', color: C.textMuted, minWidth: '240px' }}>
                          {q.question_type === 'essay'
                            ? <span>Essay</span>
                            : q.options.map((o: any) => (
                              <span key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '8px', marginBottom: '4px', color: o.is_correct ? C.green : C.textMuted, fontWeight: o.is_correct ? 900 : 700 }}>
                                {o.option_label}: {o.count}{o.is_correct ? ' ✓' : ''}
                              </span>
                            ))}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {q.flag
                            ? <span style={{ background: '#fef2f2', color: '#dc2626', borderRadius: '999px', padding: '2px 8px', fontSize: '10px', fontWeight: 800 }}>{q.flag}</span>
                            : <span style={{ color: C.textFaint }}>-</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            </>
            )}

            {analyticsTab === 'sesi' && (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '760px' }}>
                <TableHead cols={[{ label: 'Sesi' }, { label: 'Ruangan' }, { label: 'Peserta', center: true }, { label: 'Selesai', center: true }, { label: 'Belum', center: true }, { label: 'Dikunci', center: true }, { label: 'Langgar', center: true }, { label: 'Rata-rata', center: true }]} />
                <tbody>
                  {roomSessionRows.length === 0
                    ? <tr><td colSpan={8} style={{ padding: '18px', textAlign: 'center', color: C.textFaint }}>Belum ada data analitik</td></tr>
                    : roomSessionRows.map((row: any, i: number) => (
                      <tr key={row.key} style={{ borderBottom: i < roomSessionRows.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                        <td style={{ padding: '10px 14px', color: C.textMuted }}>{row.label}</td>
                        <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{row.room}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>{row.peserta}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: C.green, fontWeight: 800 }}>{row.selesai}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>{row.peserta - row.selesai}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: row.dikunci ? '#b45309' : C.textMuted, fontWeight: 800 }}>{row.dikunci}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: row.pelanggaran ? '#dc2626' : C.textMuted, fontWeight: 800 }}>{row.pelanggaran}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: C.text, fontWeight: 900 }}>{row.rata}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            )}
          </>
        )}
    </div>
  );
}

// ── ASSIGNMENTS VIEW — ROSTER (sinkron dengan menu Kegiatan & Roster) ──
function AssignmentsView({ examId, eventId }: { examId: string; eventId?: string | null }) {
  const { toast } = useToast();
  const [roster, setRoster] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  // Data pendukung
  const [events, setEvents] = useState<CbtEvent[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  // Modal tambah peserta (sumber = kegiatan/event)
  const [showAdd, setShowAdd] = useState(false);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [addRoom, setAddRoom] = useState('');
  const [addTanggal, setAddTanggal] = useState('');
  const [addSesi, setAddSesi] = useState('');
  const [saving, setSaving] = useState(false);

  // Modal edit roster per-peserta
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [editRoom, setEditRoom] = useState('');
  const [editTanggal, setEditTanggal] = useState('');
  const [editSesi, setEditSesi] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const event = events.find(e => e.id === eventId) || null;

  const fetchRoster = useCallback(async () => {
    const r = await GET(`/api/admin/exams/${examId}/roster`);
    if (r.success) setRoster(r.data || []);
    else toast('error', r.error || 'Roster tidak dapat dimuat');
    setLoading(false);
  }, [examId, toast]);
  useEffect(() => { fetchRoster(); }, [fetchRoster]);

  useEffect(() => {
    GET<CbtEvent[]>('/api/admin/events').then(r => { if (r.success) setEvents(r.data || []); });
    GET<Room[]>('/api/admin/rooms').then(r => { if (r.success) setRooms(r.data || []); });
  }, []);

  const visibleRoster = useMemo(() => {
    const query = q.trim().toLowerCase();
    return roster.filter((row: any) => {
      if (filterRoom && row.room_id !== filterRoom && (row.room_name || '') !== filterRoom) return false;
      if (!query) return true;
      return [row.full_name, row.nisn, row.username, row.class_name].some((v: any) =>
        String(v || '').toLowerCase().includes(query));
    });
  }, [roster, q, filterRoom]);

  const roomFilterOptions = Array.from(new Map(roster.map((row: any) => {
    const key = row.room_id || row.room_name || '';
    return [key, { key, label: row.room_name || key || 'Tanpa ruang' }];
  })).values()).sort((a: any, b: any) => a.label.localeCompare(b.label));

  const Chk = ({ size, check }: { size?: number; check: boolean }) => (
    <div style={{ width: size || 18, height: size || 18, borderRadius: '5px', border: `2px solid ${check ? C.green : C.borderMid}`, background: check ? C.green : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {check && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
    </div>
  );

  const SourceBadge = ({ sourceKey }: { sourceKey: string }) => {
    const m: Record<string, { bg: string; color: string; label: string }> = {
      pmb:      { bg: '#e2ebe3', color: '#2d6644', label: 'PMB' },
      mansatas: { bg: '#e0f0ff', color: '#1a5fa8', label: 'Mansatas' },
      cbt_user: { bg: '#fffbeb', color: '#b45309', label: 'Manual' },
    };
    const s = m[sourceKey] || m.cbt_user;
    return <span style={{ background: s.bg, color: s.color, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{s.label}</span>;
  };

  const allVisibleSelected = visibleRoster.length > 0 && visibleRoster.every((row: any) => selectedIds.includes(row.id));
  const toggleAllVisible = () => {
    const ids = visibleRoster.map((row: any) => row.id);
    setSelectedIds(prev => allVisibleSelected ? prev.filter(id => !ids.includes(id)) : Array.from(new Set([...prev, ...ids])));
  };
  const toggleSelect = (id: string) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const deleteRoster = async (row: any) => {
    if (!row.id || !window.confirm(`Hapus ${row.full_name} dari roster?`)) return;
    const r = await DEL(`/api/admin/exams/${examId}/roster/${row.id}`);
    if (r.success) { toast('success', 'Roster dihapus'); fetchRoster(); }
    else toast('error', r.error || 'Roster tidak dapat dihapus');
  };

  const deleteSelected = async () => {
    const ids = visibleRoster.filter((row: any) => selectedIds.includes(row.id)).map((row: any) => row.id);
    if (!ids.length) { toast('error', 'Pilih minimal 1 peserta'); return; }
    setDeleting(true);
    const results = await Promise.all(ids.map(id => DEL(`/api/admin/exams/${examId}/roster/${id}`)));
    setDeleting(false);
    const failed = results.filter(r => !r.success).length;
    if (failed) toast('error', `${results.length - failed} dihapus, ${failed} gagal (mungkin sudah punya sesi)`);
    else toast('success', `${ids.length} peserta dihapus dari roster`);
    setSelectedIds([]);
    fetchRoster();
  };

  // ── Tambah peserta dari sumber kegiatan ──
  const openAdd = async () => {
    if (!eventId) { toast('error', 'Ujian belum terhubung ke kegiatan. Pilih kegiatan di menu Ujian → Edit.'); return; }
    setShowAdd(true); setSearch(''); setSelected(new Set()); setSelectAllMode(false);
    setAddRoom(''); setAddTanggal(''); setAddSesi('');
  };

  useEffect(() => {
    if (!showAdd || !eventId) return;
    let cancelled = false;
    setCandidateLoading(true);
    const params = new URLSearchParams({ page_size: '100' });
    if (search.trim()) params.set('q', search.trim());
    GET<{ items: any[]; pagination: { total: number } }>(`/api/admin/events/${eventId}/participants?${params.toString()}`)
      .then(r => {
        if (cancelled || !r.success) return;
        const used = new Set(roster.map((row: any) => `${row.source_key}:${row.source_id}`));
        setCandidates((r.data?.items || []).filter((c: any) => !used.has(`${c.source_key}:${c.source_id}`)));
        setCandidateTotal(r.data?.pagination?.total || 0);
      })
      .catch(() => { if (!cancelled) toast('error', 'Peserta sumber tidak dapat dimuat'); })
      .finally(() => { if (!cancelled) setCandidateLoading(false); });
    return () => { cancelled = true; };
  }, [showAdd, eventId, search, roster, toast]);

  const candidateKey = (c: any) => `${c.source_key}:${c.source_id}`;
  const toggleCandidate = (key: string) => {
    if (selectAllMode) { setSelectAllMode(false); setSelected(new Set([key])); return; }
    setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const allCandidatesSelected = candidates.length > 0 && candidates.every(c => selected.has(candidateKey(c)));
  const toggleAllCandidates = () => {
    if (selectAllMode) { setSelectAllMode(false); setSelected(new Set()); return; }
    setSelected(prev => {
      const n = new Set(prev);
      candidates.forEach(c => allCandidatesSelected ? n.delete(candidateKey(c)) : n.add(candidateKey(c)));
      return n;
    });
  };

  const saveRoster = async () => {
    if (!eventId) { toast('error', 'Ujian belum terhubung ke kegiatan'); return; }
    if (!selectAllMode && selected.size === 0) { toast('error', 'Pilih minimal 1 peserta'); return; }
    setSaving(true);
    const participantIds = Array.from(selected).map(k => k.split(':').slice(1).join(':'));
    const r = await POST(`/api/admin/exams/${examId}/roster/batch`, {
      event_id: eventId,
      select_all: selectAllMode,
      participant_ids: selectAllMode ? [] : participantIds,
      filters: { q: selectAllMode ? (search.trim() || undefined) : undefined },
      room_id: addRoom || null,
      tanggal_tes: addTanggal,
      sesi_tes: addSesi,
    });
    setSaving(false);
    if (!r.success) { toast('error', r.error || 'Assignment gagal'); return; }
    toast('success', `Matched ${r.data?.matched || 0}, ditambahkan ${r.data?.added || 0}, dilewati ${r.data?.skipped || 0}`);
    setShowAdd(false);
    fetchRoster();
  };

  // ── Edit roster per-peserta ──
  const openEdit = (row: any) => {
    setEditTarget(row);
    setEditRoom(row.room_id || '');
    setEditTanggal(row.tanggal_tes || '');
    setEditSesi(row.sesi_tes || '');
  };
  const saveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    const r = await PUT(`/api/admin/exams/${examId}/roster/${editTarget.id}`, {
      room_id: editRoom || null,
      tanggal_tes: editTanggal,
      sesi_tes: editSesi,
    });
    setSavingEdit(false);
    if (!r.success) { toast('error', r.error || 'Gagal memperbarui roster'); return; }
    toast('success', 'Roster diperbarui');
    setEditTarget(null);
    fetchRoster();
  };

  if (loading) return <div className="py-12 text-center"><Spinner /></div>;

  return (
    <div className="space-y-3">
      {/* Banner info kegiatan */}
      <div style={{ background: '#f0fdf4', border: `1.5px solid ${C.greenBorder}`, borderRadius: '12px', padding: '10px 12px' }}>
        <p style={{ color: C.green, fontSize: '11px', fontWeight: 900 }}>
          Sinkron dengan menu Kegiatan & Roster{event ? ` · ${event.code} · ${event.name}` : ''}
        </p>
        <p style={{ color: C.textMid, fontSize: '11px', lineHeight: 1.5, marginTop: '3px' }}>
          Peserta di tab ini adalah roster yang disimpan dari sumber kegiatan ({event?.participant_source || '-'}).
          Perubahan di sini langsung tersinkron dengan Kegiatan & Roster.
        </p>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Input placeholder="Cari nama, NISN, kelas..." value={q} onChange={e => setQ(e.target.value)} style={{ width: '220px' }} />
          <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)} style={{ padding: '10px 12px', border: `1.5px solid ${C.borderMid}`, borderRadius: '10px', fontSize: '12px', background: C.white, color: C.text }}>
            <option value="">Semua ruangan</option>
            {roomFilterOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ color: C.textMuted, fontSize: '11px' }}>{visibleRoster.length} peserta · {selectedIds.length} dipilih</span>
          {selectedIds.length > 0 && (
            <button onClick={deleteSelected} disabled={deleting} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#dc2626', color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 12px', borderRadius: '10px', border: 'none', cursor: 'pointer', opacity: deleting ? 0.65 : 1 }}>
              {deleting ? <Spinner size={13} /> : <Trash2 size={13} strokeWidth={2.5} />} Hapus {selectedIds.length}
            </button>
          )}
          <button onClick={openAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: C.green, color: '#fff', fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer' }}>
            <Plus size={13} strokeWidth={2.5} /> Tambah Peserta
          </button>
        </div>
      </div>

      {/* Tabel roster */}
      {visibleRoster.length === 0 ? <EmptyState title={roster.length === 0 ? 'Belum ada peserta di roster' : 'Tidak ada hasil filter'} desc={roster.length === 0 ? 'Gunakan tombol Tambah Peserta untuk menyimpan peserta dari Kegiatan & Roster.' : undefined} /> : (
        <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '860px' }}>
            <thead>
              <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                <th style={{ width: '46px', padding: '9px 12px', textAlign: 'center' }}>
                  <button type="button" onClick={toggleAllVisible} style={{ display: 'inline-flex', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}><Chk size={17} check={allVisibleSelected} /></button>
                </th>
                {['Nama', 'NISN', 'Kelas', 'JK', 'Ruangan', 'Tanggal', 'Sesi', 'Sumber', 'Aksi'].map(label => (
                  <th key={label} style={{ textAlign: label === 'JK' || label === 'Aksi' ? 'center' : 'left', padding: '9px 14px', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRoster.map((row: any, i: number) => (
                <tr key={row.id} style={{ borderBottom: i < visibleRoster.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: selectedIds.includes(row.id) ? '#f7fbf8' : C.white }}>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                    <button type="button" onClick={() => toggleSelect(row.id)} style={{ display: 'inline-flex', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}><Chk size={17} check={selectedIds.includes(row.id)} /></button>
                  </td>
                  <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{row.full_name || '—'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{row.nisn || row.username || '—'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted }}>{row.class_name || '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', color: C.textMuted }}>{row.gender || '—'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted }}>{row.room_name || row.room_id || 'Tanpa ruang'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted, whiteSpace: 'nowrap' }}>{row.tanggal_tes || '—'}</td>
                  <td style={{ padding: '10px 14px', color: C.textMuted }}>{row.sesi_tes || '—'}</td>
                  <td style={{ padding: '10px 14px' }}><SourceBadge sourceKey={row.source_key} /></td>
                  <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openEdit(row)} title="Atur ruangan/jadwal" style={{ color: '#1a5fa8', background: 'none', border: 'none', cursor: 'pointer', marginRight: '6px' }}><Pencil size={13} /></button>
                    <button onClick={() => deleteRoster(row)} title="Hapus roster" style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal tambah peserta */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={event ? `Tambah Peserta · ${event.code}` : 'Tambah Peserta'} size="lg">
        <div className="space-y-3">
          <Input placeholder="Cari nama / NISN..." value={search} onChange={e => setSearch(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <p style={{ color: C.textMuted, fontSize: '11px' }}>
              {candidateLoading ? 'Memuat...' : selectAllMode ? `${candidateTotal} peserta cocok dengan filter` : `${candidates.length} tersedia · ${selected.size} dipilih`}
            </p>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={() => { setSelectAllMode(v => { const next = !v; if (next) setSelected(new Set()); return next; }); }}
                style={{ background: selectAllMode ? C.greenLight : '#e0f0ff', color: selectAllMode ? C.green : '#1a5fa8', border: `1.5px solid ${selectAllMode ? C.greenBorder : '#b7d6f5'}`, borderRadius: '9px', padding: '6px 10px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}>
                {selectAllMode ? 'Batal pilih semua' : '✓ Pilih semua hasil'}
              </button>
              <button onClick={toggleAllCandidates} style={{ color: C.green, fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                {!selectAllMode && candidates.length > 0 && allCandidatesSelected ? 'Batal Semua' : 'Pilih Semua'}
              </button>
            </div>
          </div>
          <div style={{ maxHeight: '280px', overflow: 'auto', border: `1.5px solid ${C.borderMid}`, borderRadius: '12px' }}>
            {candidateLoading ? <p style={{ padding: '20px', textAlign: 'center', color: C.textFaint, fontSize: '12px' }}>Memuat peserta...</p>
              : candidates.length === 0 ? <p style={{ padding: '20px', textAlign: 'center', color: C.textFaint, fontSize: '12px' }}>{search ? 'Tidak ada peserta cocok' : 'Semua peserta sumber sudah masuk roster'}</p>
              : candidates.map(c => { const key = candidateKey(c); const chk = selectAllMode || selected.has(key); return (
                <div key={key} onClick={() => toggleCandidate(key)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px', cursor: 'pointer', borderBottom: `1px solid ${C.borderLight}`, background: chk ? C.greenLight : 'transparent' }}>
                  <Chk check={chk} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: C.text, fontSize: '12px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.full_name}</p>
                    <p style={{ color: C.textFaint, fontSize: '10px', fontFamily: 'monospace' }}>{c.nisn || c.username}</p>
                  </div>
                  {c.class_name && <span style={{ color: C.textMuted, fontSize: '10px', flexShrink: 0 }}>{c.class_name}</span>}
                  <SourceBadge sourceKey={c.source_key} />
                </div>
              ); })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '8px' }}>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>RUANGAN<select value={addRoom} onChange={e => setAddRoom(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '9px 8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', background: C.white, fontSize: '12px' }}><option value="">Tanpa ruang</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.room_name}</option>)}</select></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>TANGGAL<input type="date" value={addTanggal} onChange={e => setAddTanggal(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>SESI<input value={addSesi} onChange={e => setAddSesi(e.target.value)} placeholder="Sesi 1 (...)" style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setShowAdd(false)}>Batal</Button>
            <Button size="sm" loading={saving} onClick={saveRoster}>
              Simpan {selectAllMode ? `${candidateTotal} peserta` : `${selected.size} peserta`} ke roster
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal edit roster */}
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={editTarget ? `Atur Roster · ${editTarget.full_name}` : 'Atur Roster'} size="md">
        <div className="space-y-3">
          <p style={{ color: C.textMuted, fontSize: '11px' }}>Ruangan & jadwal ini dipakai untuk validasi token dan tampilan di modul Monitor.</p>
          <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>RUANGAN<select value={editRoom} onChange={e => setEditRoom(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '9px 8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', background: C.white, fontSize: '12px' }}><option value="">Tanpa ruang</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.room_name}</option>)}</select></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>TANGGAL<input type="date" value={editTanggal} onChange={e => setEditTanggal(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>SESI<input value={editSesi} onChange={e => setEditSesi(e.target.value)} placeholder="Sesi 1 (...)" style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setEditTarget(null)}>Batal</Button>
            <Button size="sm" loading={savingEdit} onClick={saveEdit}>Simpan</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}


// ── PESERTA PAGE ──────────────────────────────────────────────
// Hanya menampilkan peserta jalur REGULER MURNI (jalur yang membutuhkan tes)
// ── KEGIATAN & ROSTER ─────────────────────────────────────────
function KegiatanPage({ activeEventId, setActiveEventId }: { activeEventId?: string | null; setActiveEventId?: (id: string | null) => void }) {
  const { toast } = useToast();
  const [events, setEvents] = useState<CbtEvent[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [eventId, setEventId] = useState(() => activeEventId || '');

  useEffect(() => {
    if (activeEventId) setEventId(activeEventId);
  }, [activeEventId]);
  const [examId, setExamId] = useState('');
  const [participants, setParticipants] = useState<RosterParticipant[]>([]);
  const [roster, setRoster] = useState<RosterParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [participantLoading, setParticipantLoading] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [q, setQ] = useState('');
  const [className, setClassName] = useState('');
  const [grade, setGrade] = useState('');
  const [gender, setGender] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [roomId, setRoomId] = useState('');
  const [tanggalTes, setTanggalTes] = useState('');
  const [sesiTes, setSesiTes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [newEvent, setNewEvent] = useState({ code: '', name: '', activity_type: 'other', participant_source: 'mansatas' });

  const selectedEvent = events.find(e => e.id === eventId);
  const eventExams = useMemo(() => exams.filter(exam => exam.event_id === eventId), [exams, eventId]);
  const selectedExam = eventExams.find(exam => exam.id === examId);
  const pageSize = 50;

  const loadBase = useCallback(async () => {
    const [eventResponse, examResponse, roomResponse] = await Promise.all([
      GET<CbtEvent[]>('/api/admin/events'),
      GET<Exam[]>('/api/admin/exams'),
      GET<Room[]>('/api/admin/rooms'),
    ]);
    if (eventResponse.success) {
      const next = eventResponse.data || [];
      setEvents(next);
      if (!eventId && next[0]) setEventId(next[0].id);
    }
    if (examResponse.success) {
      setExams(examResponse.data || []);
    }
    if (roomResponse.success) setRooms(roomResponse.data || []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { loadBase(); }, [loadBase]);

  useEffect(() => {
    if (!eventId) return;
    if (!eventExams.some(exam => exam.id === examId)) setExamId(eventExams[0]?.id || '');
  }, [eventId, eventExams, examId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setParticipantLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (q.trim()) params.set('q', q.trim());
    if (className) params.set('class_name', className);
    if (grade) params.set('grade', grade);
    if (gender) params.set('gender', gender);
    if (activeFilter !== 'all') params.set('is_active', activeFilter);
    GET<{ items: RosterParticipant[]; pagination: { total: number } }>(`/api/admin/events/${eventId}/participants?${params.toString()}`)
      .then(response => {
        if (cancelled) return;
        if (response.success) {
          setParticipants(response.data?.items || []);
          setTotal(response.data?.pagination?.total || 0);
        } else toast('error', response.error || 'Peserta tidak dapat dimuat');
      })
      .finally(() => { if (!cancelled) setParticipantLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, page, q, className, grade, gender, activeFilter, toast]);

  const loadRoster = useCallback(async () => {
    if (!examId) { setRoster([]); return; }
    setRosterLoading(true);
    const response = await GET<RosterParticipant[]>(`/api/admin/exams/${examId}/roster`);
    if (response.success) setRoster(response.data || []);
    else toast('error', response.error || 'Roster tidak dapat dimuat');
    setRosterLoading(false);
  }, [examId, toast]);
  useEffect(() => { loadRoster(); }, [loadRoster]);

  const resetSelection = () => { setSelectedIds([]); setSelectAll(false); };
  const resetFilters = () => {
    setQ(''); setClassName(''); setGrade(''); setGender(''); setActiveFilter('all'); setPage(1); resetSelection();
  };
  const toggleParticipant = (id: string) => {
    setSelectAll(false);
    setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  };
  const togglePage = () => {
    setSelectAll(false);
    const ids = participants.map(p => p.source_id);
    setSelectedIds(current => ids.every(id => current.includes(id)) ? current.filter(id => !ids.includes(id)) : Array.from(new Set([...current, ...ids])));
  };

  const assignRoster = async () => {
    if (!eventId || !examId || !selectedExam) { toast('error', 'Pilih kegiatan dan mapel yang sesuai'); return; }
    if (!selectAll && selectedIds.length === 0) { toast('error', 'Pilih peserta atau semua hasil filter'); return; }
    setSaving(true);
    const response = await POST(`/api/admin/exams/${examId}/roster/batch`, {
      event_id: eventId,
      select_all: selectAll,
      participant_ids: selectAll ? [] : selectedIds,
      filters: { q, class_name: className, grade, gender, is_active: activeFilter === 'all' ? undefined : activeFilter === 'true' },
      room_id: roomId || null,
      tanggal_tes: tanggalTes,
      sesi_tes: sesiTes,
    });
    setSaving(false);
    if (!response.success) { toast('error', response.error || 'Assignment gagal'); return; }
    toast('success', `Matched ${response.data?.matched || 0}, ditambahkan ${response.data?.added || 0}, dilewati ${response.data?.skipped || 0}`);
    resetSelection();
    loadRoster();
  };

  const createEvent = async () => {
    if (!newEvent.code.trim() || !newEvent.name.trim()) { toast('error', 'Kode dan nama kegiatan wajib diisi'); return; }
    const response = await POST('/api/admin/events', newEvent);
    if (!response.success) { toast('error', response.error || 'Kegiatan gagal dibuat'); return; }
    toast('success', 'Kegiatan dibuat');
    setShowCreate(false);
    setNewEvent({ code: '', name: '', activity_type: 'other', participant_source: 'mansatas' });
    await loadBase();
    if (response.data?.id) setEventId(response.data.id);
  };

  const removeRoster = async (row: RosterParticipant & { id?: string }) => {
    if (!row.id || !examId || !window.confirm(`Hapus ${row.full_name} dari roster?`)) return;
    const response = await DEL(`/api/admin/exams/${examId}/roster/${row.id}`);
    if (response.success) { toast('success', 'Roster dihapus'); loadRoster(); }
    else toast('error', response.error || 'Roster tidak dapat dihapus');
  };

  if (loading) return <LoadingScreen />;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allPageSelected = participants.length > 0 && participants.every(p => selectedIds.includes(p.source_id));

  return (
    <div style={{ flex: 1, padding: '20px', overflow: 'auto' }}>
      <div style={{ maxWidth: '1450px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h1 style={{ color: C.text, fontSize: '19px', fontWeight: 900, letterSpacing: '-0.3px' }}>Kegiatan & roster</h1>
            <p style={{ color: C.textMuted, fontSize: '12px', marginTop: '3px' }}>Pilih peserta berdasarkan filter lalu simpan snapshot roster per ujian.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowAttendanceModal(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: C.white, color: C.green, border: `1.5px solid ${C.greenBorder}`, borderRadius: '10px', padding: '9px 13px', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
              <FileDown size={14} /> Cetak Absensi (.docx)
            </button>
            <button onClick={() => setShowCreate(v => !v)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: C.green, color: '#fff', border: 'none', borderRadius: '10px', padding: '9px 13px', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
              <Plus size={14} /> Kegiatan baru
            </button>
          </div>
        </div>

        {showCreate && (
          <div style={{ ...{ background: C.white, border: `1.5px solid ${C.greenBorder}`, borderRadius: '14px', padding: '14px', marginBottom: '14px' } }}>
            <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(180px, 1fr) 150px 160px auto', gap: '8px', alignItems: 'end' }}>
              <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>KODE<input value={newEvent.code} onChange={e => setNewEvent({ ...newEvent, code: e.target.value.toUpperCase() })} placeholder="OSN" style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
              <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>NAMA KEGIATAN<input value={newEvent.name} onChange={e => setNewEvent({ ...newEvent, name: e.target.value })} placeholder="Olimpiade Sains Nasional" style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
              <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>JENIS<input value={newEvent.activity_type} onChange={e => setNewEvent({ ...newEvent, activity_type: e.target.value })} placeholder="olimpiade" style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
              <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>SUMBER<select value={newEvent.participant_source} onChange={e => setNewEvent({ ...newEvent, participant_source: e.target.value })} style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px', background: C.white }}><option value="mansatas">mansatas-db</option><option value="pmb">PMB</option><option value="cbt_user">Manual CBT</option></select></label>
              <button onClick={createEvent} style={{ background: '#1a5fa8', color: '#fff', border: 'none', borderRadius: '9px', padding: '10px 13px', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>Simpan</button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 1.2fr) 110px', gap: '10px', marginBottom: '14px' }}>
          <label style={{ ...{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '10px 12px' }, fontSize: '10px', color: C.textMid, fontWeight: 800 }}>KEGIATAN
            <select value={eventId} onChange={e => { setEventId(e.target.value); setPage(1); resetSelection(); }} style={{ width: '100%', border: 'none', outline: 'none', marginTop: '5px', color: C.text, fontWeight: 700, fontSize: '13px', background: C.white }}>{events.map(e => <option key={e.id} value={e.id}>{e.code} · {e.name}</option>)}</select>
          </label>
          <label style={{ ...{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '10px 12px' }, fontSize: '10px', color: C.textMid, fontWeight: 800 }}>UJIAN / MAPEL
            <select value={examId} onChange={e => setExamId(e.target.value)} style={{ width: '100%', border: 'none', outline: 'none', marginTop: '5px', color: C.text, fontWeight: 700, fontSize: '13px', background: C.white }}>
              {!eventExams.length && <option value="">Belum ada ujian untuk kegiatan ini</option>}
              {eventExams.map(e => <option key={e.id} value={e.id}>{e.subject_name || e.title}{e.subject_name ? ` · ${e.title}` : ''}</option>)}
            </select>
          </label>
          <div style={{ background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '12px', padding: '10px 12px' }}><p style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>SUMBER</p><p style={{ marginTop: '5px', fontSize: '13px', fontWeight: 900, color: C.green }}>{selectedEvent?.participant_source || '-'}</p></div>
        </div>

        <div style={{ background: '#f0fdf4', border: `1.5px solid ${C.greenBorder}`, borderRadius: '12px', padding: '10px 12px', marginBottom: '14px' }}>
          <p style={{ color: C.green, fontSize: '11px', fontWeight: 900 }}>Roster per mapel</p>
          <p style={{ color: C.textMid, fontSize: '11px', lineHeight: 1.5, marginTop: '3px' }}>
            {selectedExam
              ? <>Peserta yang dipilih akan masuk ke <strong>{selectedExam.subject_name || selectedExam.title}</strong> saja. Siswa yang sama boleh dipilih lagi pada mapel lain.</>
              : 'Buat ujian/mapel terlebih dahulu dari menu Ujian, lalu pilih mapel tersebut di sini.'}
          </p>
        </div>

        <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '14px', padding: '14px', marginBottom: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.5fr) repeat(4, minmax(100px, 1fr)) auto', gap: '8px', alignItems: 'end' }}>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>CARI NAMA / NISN<input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Ketik pencarian..." style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>KELAS<input value={className} onChange={e => { setClassName(e.target.value); setPage(1); }} placeholder="Semua" style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>TINGKAT<input value={grade} onChange={e => { setGrade(e.target.value); setPage(1); }} placeholder="Semua" style={{ width: '100%', marginTop: '5px', padding: '9px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px' }} /></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>JENIS KELAMIN<select value={gender} onChange={e => { setGender(e.target.value); setPage(1); }} style={{ width: '100%', marginTop: '5px', padding: '9px 7px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px', background: C.white }}><option value="">Semua</option><option value="L">Laki-laki</option><option value="P">Perempuan</option></select></label>
            <label style={{ fontSize: '10px', color: C.textMid, fontWeight: 800 }}>STATUS<select value={activeFilter} onChange={e => { setActiveFilter(e.target.value); setPage(1); }} style={{ width: '100%', marginTop: '5px', padding: '9px 7px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '12px', background: C.white }}><option value="all">Semua</option><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label>
            <button onClick={resetFilters} style={{ background: C.bg, color: C.textMid, border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', padding: '9px 10px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}>Reset</button>
          </div>
          {selectedEvent?.participant_source === 'pmb' && <p style={{ color: C.textMuted, fontSize: '10.5px', marginTop: '9px' }}>Filter kelas/tingkat belum tersedia pada sumber PMB legacy; jalur, ruang, tanggal, dan sesi tetap dipertahankan pada API lama.</p>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(300px, 0.9fr)', gap: '14px', alignItems: 'start' }}>
          <section style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '14px', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: `1.5px solid ${C.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div><p style={{ color: C.text, fontSize: '13px', fontWeight: 900 }}>Peserta sumber</p><p style={{ color: C.textMuted, fontSize: '10.5px', marginTop: '2px' }}>{total.toLocaleString('id-ID')} hasil · halaman {page}/{totalPages}</p></div>
              <button onClick={() => { setSelectAll(true); setSelectedIds([]); }} disabled={participantLoading || total === 0} style={{ background: selectAll ? C.greenLight : '#e0f0ff', color: selectAll ? C.green : '#1a5fa8', border: `1.5px solid ${selectAll ? C.greenBorder : '#b7d6f5'}`, borderRadius: '9px', padding: '8px 10px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}>✓ Pilih semua hasil filter</button>
            </div>
            {selectAll && <div style={{ padding: '8px 14px', background: '#f0fdf4', color: C.green, fontSize: '11px', fontWeight: 700 }}>Semua {total.toLocaleString('id-ID')} hasil filter akan diproses di server.</div>}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
                <thead><tr style={{ background: C.bg }}>{['', 'Nama', 'NISN / Username', 'Kelas', 'Tingkat', 'JK', 'Status'].map((label, i) => <th key={label || 'check'} style={{ textAlign: i === 0 ? 'center' : 'left', padding: '9px 10px', color: C.textMid, fontSize: '10px', fontWeight: 800 }}>{i === 0 ? <input type="checkbox" checked={allPageSelected} onChange={togglePage} /> : label}</th>)}</tr></thead>
                <tbody>{participantLoading ? <tr><td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: C.textMuted, fontSize: '12px' }}>Memuat peserta...</td></tr> : participants.length === 0 ? <tr><td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: C.textMuted, fontSize: '12px' }}>Tidak ada peserta sesuai filter.</td></tr> : participants.map(p => { const checked = selectAll || selectedIds.includes(p.source_id); return <tr key={p.source_id} style={{ borderTop: `1px solid ${C.borderLight}`, background: checked ? '#f7fbf8' : C.white }}><td style={{ padding: '8px 10px', textAlign: 'center' }}><input type="checkbox" checked={checked} onChange={() => toggleParticipant(p.source_id)} /></td><td style={{ padding: '8px 10px', color: C.text, fontSize: '12px', fontWeight: 700 }}>{p.full_name}</td><td style={{ padding: '8px 10px', color: C.textMid, fontSize: '11px', fontFamily: 'monospace' }}>{p.nisn || p.username}</td><td style={{ padding: '8px 10px', color: C.textMid, fontSize: '11px' }}>{p.class_name || '-'}</td><td style={{ padding: '8px 10px', color: C.textMid, fontSize: '11px' }}>{p.grade || '-'}</td><td style={{ padding: '8px 10px', color: C.textMid, fontSize: '11px' }}>{p.gender || '-'}</td><td style={{ padding: '8px 10px', color: p.is_active ? C.green : '#dc2626', fontSize: '11px', fontWeight: 700 }}>{p.is_active ? 'Aktif' : 'Nonaktif'}</td></tr>; })}</tbody>
              </table>
            </div>
            <div style={{ padding: '10px 14px', borderTop: `1.5px solid ${C.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ color: C.textMuted, fontSize: '11px' }}>{selectAll ? `${total} terpilih` : `${selectedIds.length} terpilih`}</span><div style={{ display: 'flex', gap: '5px' }}><button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: '5px 9px', borderRadius: '7px', border: `1px solid ${C.borderMid}`, background: C.white, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}>‹</button><button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: '5px 9px', borderRadius: '7px', border: `1px solid ${C.borderMid}`, background: C.white, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}>›</button></div></div>
          </section>

          <aside style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '14px', padding: '14px', position: 'sticky', top: '14px' }}>
            <p style={{ color: C.text, fontSize: '13px', fontWeight: 900 }}>Assignment roster</p>
            <p style={{ color: C.textMuted, fontSize: '10.5px', lineHeight: 1.5, margin: '3px 0 12px' }}>Snapshot nama, NISN, kelas, tingkat, dan status disimpan di CBT. Data sumber tidak diubah.</p>
            <label style={{ display: 'block', color: C.textMid, fontSize: '10px', fontWeight: 800 }}>RUANGAN<select value={roomId} onChange={e => setRoomId(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '9px 8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', background: C.white, fontSize: '12px' }}><option value="">Pilih ruangan</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.room_name}</option>)}</select></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '9px' }}><label style={{ color: C.textMid, fontSize: '10px', fontWeight: 800 }}>TANGGAL<input type="date" value={tanggalTes} onChange={e => setTanggalTes(e.target.value)} style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label><label style={{ color: C.textMid, fontSize: '10px', fontWeight: 800 }}>SESI<input value={sesiTes} onChange={e => setSesiTes(e.target.value)} placeholder="Sesi 1 (...)" style={{ width: '100%', marginTop: '5px', padding: '8px', border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', fontSize: '11px' }} /></label></div>
            <button onClick={assignRoster} disabled={saving || !selectedExam || (!selectAll && selectedIds.length === 0)} style={{ width: '100%', marginTop: '12px', background: C.green, color: '#fff', border: 'none', borderRadius: '10px', padding: '11px', fontSize: '12px', fontWeight: 900, cursor: 'pointer', opacity: saving || !selectedExam || (!selectAll && selectedIds.length === 0) ? 0.5 : 1 }}>{saving ? 'Memproses...' : 'Simpan roster'}</button>
            <div style={{ height: '1px', background: C.borderLight, margin: '16px 0 12px' }} />
            <p style={{ color: C.text, fontSize: '12px', fontWeight: 900, marginBottom: '7px' }}>Roster tersimpan {rosterLoading ? '...' : `(${roster.length})`}</p>
            <div style={{ maxHeight: '360px', overflowY: 'auto' }}>{roster.map((r: any) => <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', borderBottom: `1px solid ${C.borderLight}`, padding: '8px 0' }}><div style={{ minWidth: 0 }}><p style={{ color: C.text, fontSize: '11px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.full_name}</p><p style={{ color: C.textMuted, fontSize: '10px', marginTop: '2px' }}>{r.nisn || r.username} · {r.room_name || 'Tanpa ruang'}</p></div><button onClick={() => removeRoster(r)} title="Hapus roster" style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', padding: '2px' }}><Trash2 size={13} /></button></div>)}</div>
          </aside>
        </div>
      </div>

      <DownloadAttendanceModal
        open={showAttendanceModal}
        onClose={() => setShowAttendanceModal(false)}
        initialEventId={eventId}
        initialExamId={examId}
        events={events}
        exams={exams}
        rooms={rooms}
      />
    </div>
  );
}

function PesertaPage({ activeEventId }: { activeEventId?: string | null }) {
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
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [batchRoom, setBatchRoom] = useState('');
  const [savingBatchAssign, setSavingBatchAssign] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterEventId, setFilterEventId] = useState(() => activeEventId || 'ALL');
  const [allEvents, setAllEvents] = useState<CbtEvent[]>([]);
  const [rosterMap, setRosterMap] = useState<{ event_id: string; source_key: string; source_id: string; nisn?: string }[]>([]);

  useEffect(() => {
    setFilterEventId(activeEventId || 'ALL');
  }, [activeEventId]);

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
    if (confirmDelPeserta._sumber !== 'manual') {
      toast('error', 'Peserta PMB tidak bisa dihapus dari aplikasi CBT');
      setConfirmDelPeserta(null);
      return;
    }
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

  const participantKey = useCallback((p: any) => `${p._sumber || 'pmb'}:${p.id}`, []);
  const selectedParticipantRows = data.filter((p: any) => selectedParticipants.has(participantKey(p)));
  const saveBatchAssignRoom = async () => {
    if (selectedParticipantRows.length === 0) { toast('error', 'Pilih minimal 1 peserta'); return; }
    setSavingBatchAssign(true);
    const r = await POST('/api/admin/participants/assign-room', {
      ruang_tes: batchRoom || null,
      participants: selectedParticipantRows.map((p: any) => ({ id: p.id, source: p._sumber === 'manual' ? 'manual' : 'pmb' })),
    });
    setSavingBatchAssign(false);
    if (r.success) {
      toast('success', r.message || 'Peserta berhasil di-assign');
      setSelectedParticipants(new Set());
      setBatchRoom('');
      fetchPeserta();
    } else {
      toast('error', r.error || 'Gagal');
    }
  };

  const fetchPeserta = useCallback(async () => {
    // Ambil dari semua sumber: semua pendaftar PMB + cbt_users (role student) + cbt_exam_roster + jalur list + events + roster map
    const [pmb, manual, rooms, jalur, events, rosterMapResp, fullRosterResp] = await Promise.all([
      GET<Pendaftar[]>('/api/admin/pendaftar'),
      GET<any[]>('/api/admin/users?role=student'),
      GET<Room[]>('/api/admin/rooms'),
      GET<string[]>('/api/admin/pendaftar/jalur'),
      GET<CbtEvent[]>('/api/admin/events'),
      GET<any[]>('/api/admin/events/roster-map'),
      GET<any[]>('/api/admin/roster'),
    ]);
    const pmbData: Pendaftar[] = pmb.success ? (pmb.data || []) : [];
    const roomList = rooms.success ? (rooms.data || []) : [];
    if (rooms.success) setAllRooms(roomList);
    if (jalur.success) setAllJalur(jalur.data || []);
    if (events.success) setAllEvents(events.data || []);
    if (rosterMapResp.success) setRosterMap(rosterMapResp.data || []);

    const fullRosterData: Pendaftar[] = (fullRosterResp.success ? (fullRosterResp.data || []) : []).map((r: any) => ({
      id: r.id, nisn: r.nisn || r.username, nama_lengkap: r.full_name,
      no_pendaftaran: '—', ruang_tes: r.room_name || r.room_id || '',
      jalur: r.class_name ? `Kelas ${r.class_name}` : 'ROSTER', asal_sekolah: '', jenis_kelamin: r.gender || '',
      tanggal_lahir: '', tanggal_tes: r.tanggal_tes || '', sesi_tes: r.sesi_tes || '',
      _sumber: (r.source_key || 'roster') as any,
    }));

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
    const pmbNisns = new Set(taggedPmb.map(p => p.nisn).filter(Boolean));
    const uniqueRoster = fullRosterData.filter(p => !p.nisn || !pmbNisns.has(p.nisn));

    const existingNisns = new Set([...pmbNisns, ...uniqueRoster.map(p => p.nisn).filter(Boolean)]);
    const uniqueManual = manualData.filter(p => !p.nisn || !existingNisns.has(p.nisn));

    setData([...taggedPmb, ...uniqueRoster, ...uniqueManual] as any);
    setLoading(false);
  }, []);
  useEffect(() => { fetchPeserta(); }, [fetchPeserta]);

  const isParticipantInEvent = useCallback((p: any, ev: CbtEvent) => {
    // Check if participant is explicitly in event roster
    const inRoster = rosterMap.some(r => r.event_id === ev.id && (
      (r.source_id && r.source_id === p.id) ||
      (r.nisn && p.nisn && r.nisn === p.nisn)
    ));
    if (inRoster) return true;
    // Fallback: If it's the primary PMB event, include PMB source participants
    if (ev.id === 'event-pmb' || ev.code === 'PMB') {
      return p._sumber === 'pmb';
    }
    return false;
  }, [rosterMap]);

  // derive filter options from data
  const roomOpts = Array.from(new Set(data.map((p: any) => p.ruang_tes).filter(Boolean))).sort() as string[];
  const sesiOpts = Array.from(new Set(data.map((p: any) => p.sesi_tes).filter(Boolean))).sort() as string[];
  const tglOpts = Array.from(new Set(data.map((p: any) => p.tanggal_tes).filter(Boolean))).sort() as string[];
  const [filterSesi, setFilterSesi] = useState('');
  const [filterSumber, setFilterSumber] = useState('');
  const [filterTgl, setFilterTgl] = useState('');
  const [filterJk, setFilterJk] = useState('');
  const [filterJalur, setFilterJalur] = useState('');
  const [pageSize, setPageSize] = useState<'20' | '50' | '100' | 'all'>('20');
  const [page, setPage] = useState(1);
  const jalurOpts = Array.from(new Set(data.map((p: any) => p.jalur).filter(Boolean))).sort() as string[];

  const filtered = data.filter((p: any) => {
    // Search query filter (nama, NISN, no pendaftaran, asal sekolah)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = (p.nama_lengkap || '').toLowerCase().includes(q);
      const matchNisn = (p.nisn || '').toLowerCase().includes(q);
      const matchNo = (p.no_pendaftaran || '').toLowerCase().includes(q);
      const matchAsal = (p.asal_sekolah || '').toLowerCase().includes(q);
      if (!matchName && !matchNisn && !matchNo && !matchAsal) return false;
    }
    // Event filter
    if (filterEventId !== 'ALL') {
      const ev = allEvents.find(e => e.id === filterEventId);
      if (ev && !isParticipantInEvent(p, ev)) return false;
    }
    // Room filter (supports '__NONE__' for participants without room)
    if (filterRoom === '__NONE__') {
      if (p.ruang_tes) return false;
    } else if (filterRoom && p.ruang_tes !== filterRoom) {
      return false;
    }
    if (filterSesi && p.sesi_tes !== filterSesi) return false;
    if (filterSumber && p._sumber !== filterSumber) return false;
    if (filterTgl && p.tanggal_tes !== filterTgl) return false;
    if (filterJk && normalizeJenisKelamin(p.jenis_kelamin) !== filterJk) return false;
    if (filterJalur && (p.jalur || '').toUpperCase() !== filterJalur.toUpperCase()) return false;
    return true;
  });
  const perPage = pageSize === 'all' ? filtered.length || 1 : Number(pageSize);
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(filtered.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const pageStart = pageSize === 'all' ? 0 : (currentPage - 1) * perPage;
  const pagedParticipants = pageSize === 'all' ? filtered : filtered.slice(pageStart, pageStart + perPage);
  const pageEnd = pageSize === 'all' ? filtered.length : Math.min(filtered.length, pageStart + pagedParticipants.length);
  const pageParticipantKeys = pagedParticipants.map((p: any) => participantKey(p));
  const allPageSelected = pageParticipantKeys.length > 0 && pageParticipantKeys.every(k => selectedParticipants.has(k));
  const toggleParticipant = (p: any) => {
    const key = participantKey(p);
    setSelectedParticipants(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const togglePageParticipants = () => {
    setSelectedParticipants(prev => {
      const next = new Set(prev);
      if (allPageSelected) pageParticipantKeys.forEach(k => next.delete(k));
      else pageParticipantKeys.forEach(k => next.add(k));
      return next;
    });
  };

  useEffect(() => {
    setPage(1);
  }, [filterRoom, filterSesi, filterTgl, filterSumber, filterJk, filterJalur, searchQuery, filterEventId, pageSize]);
  useEffect(() => {
    const valid = new Set(data.map((p: any) => participantKey(p)));
    setSelectedParticipants(prev => new Set(Array.from(prev).filter(k => valid.has(k))));
  }, [data, participantKey]);

  const resetAllFilters = () => {
    setFilterRoom('');
    setFilterSesi('');
    setFilterTgl('');
    setFilterSumber('');
    setFilterJk('');
    setFilterJalur('');
    setSearchQuery('');
    setFilterEventId('ALL');
  };

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

      {/* ── FILTER JENIS KEGIATAN ── */}
      <div style={{ background: '#f8faf8', borderBottom: `1.5px solid ${C.border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: C.green, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', marginRight: '4px' }}>
          Kegiatan:
        </span>
        <button type="button" onClick={() => setFilterEventId('ALL')}
          style={{
            padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1.5px solid ${filterEventId === 'ALL' ? C.green : C.borderMid}`,
            background: filterEventId === 'ALL' ? C.greenLight : C.white,
            color: filterEventId === 'ALL' ? C.green : C.textMuted,
            transition: 'all 0.12s',
          }}>
          Semua Kegiatan ({data.length})
        </button>
        {allEvents.map(ev => {
          const isSelected = filterEventId === ev.id;
          const count = data.filter((p: any) => isParticipantInEvent(p, ev)).length;
          return (
            <button key={ev.id} type="button" onClick={() => setFilterEventId(ev.id)}
              style={{
                padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
                border: `1.5px solid ${isSelected ? C.green : C.borderMid}`,
                background: isSelected ? C.greenLight : C.white,
                color: isSelected ? C.green : C.textMuted,
                transition: 'all 0.12s',
              }}>
              {ev.code} · {ev.name} ({count})
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, padding: '16px 20px' }} className="space-y-3">
        {/* FILTER BAR & SEARCH */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search Field */}
          <div style={{ position: 'relative', minWidth: '220px', flex: '1 1 200px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: C.textMuted, pointerEvents: 'none' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari Nama, NISN, No. Daftar..."
              style={{
                width: '100%', padding: '7px 11px 7px 30px', fontSize: '12px', fontWeight: 600,
                background: C.white, border: `1.5px solid ${searchQuery ? C.green : C.borderMid}`,
                borderRadius: '10px', outline: 'none', color: C.text, fontFamily: 'inherit',
              }}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 0 }}>
                <X size={13} />
              </button>
            )}
          </div>

          <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)} style={selStyle(filterRoom)}>
            <option value="">Semua Ruangan</option>
            <option value="__NONE__">⚠️ Belum Ada Ruangan</option>
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
          <select value={pageSize} onChange={e => setPageSize(e.target.value as '20' | '50' | '100' | 'all')} style={selStyle(pageSize)}>
            <option value="20">20 / halaman</option>
            <option value="50">50 / halaman</option>
            <option value="100">100 / halaman</option>
            <option value="all">Semua</option>
          </select>
          {(filterRoom || filterSesi || filterTgl || filterSumber || filterJk || filterJalur || searchQuery || filterEventId !== 'ALL') && (
            <button onClick={resetAllFilters}
              style={{ fontSize: '11.5px', fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '10px', padding: '7px 12px', cursor: 'pointer' }}>
              Reset
            </button>
          )}
        </div>

        {!loading && filtered.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', background: C.white, border: `1.5px solid ${selectedParticipants.size ? C.greenBorder : C.borderMid}`, borderRadius: '12px', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={togglePageParticipants}
                style={{ fontSize: '11.5px', fontWeight: 700, color: allPageSelected ? '#dc2626' : C.green, background: allPageSelected ? '#fef2f2' : C.greenLight, border: `1.5px solid ${allPageSelected ? '#fecaca' : C.greenBorder}`, borderRadius: '9px', padding: '7px 11px', cursor: 'pointer' }}>
                {allPageSelected ? 'Batal pilih halaman' : 'Pilih halaman ini'}
              </button>
              <span style={{ color: selectedParticipants.size ? C.text : C.textMuted, fontSize: '11.5px', fontWeight: 700 }}>
                {selectedParticipants.size} peserta dipilih
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <select value={batchRoom} onChange={e => setBatchRoom(e.target.value)} style={selStyle(batchRoom)}>
                <option value="">Tanpa Ruangan</option>
                {allRooms.map(r => <option key={r.id} value={r.room_name}>{r.room_name}</option>)}
              </select>
              <Button size="sm" loading={savingBatchAssign} disabled={selectedParticipants.size === 0} onClick={saveBatchAssignRoom}>
                Assign Terpilih
              </Button>
            </div>
          </div>
        )}

        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : filtered.length === 0 ? <EmptyState title="Belum ada peserta" desc="Hanya peserta jalur Reguler Murni yang ditampilkan" />
            : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                  <p style={{ color: C.textMuted, fontSize: '11.5px', fontWeight: 600 }}>
                    Menampilkan {pageStart + 1}-{pageEnd} dari {filtered.length} peserta
                  </p>
                  {pageSize !== 'all' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                        style={{ padding: '6px 10px', fontSize: '11.5px', fontWeight: 700, color: currentPage <= 1 ? C.textFaint : C.textMid, background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', cursor: currentPage <= 1 ? 'not-allowed' : 'pointer' }}>
                        Sebelumnya
                      </button>
                      <span style={{ color: C.textMuted, fontSize: '11.5px', fontWeight: 700 }}>
                        {currentPage} / {totalPages}
                      </span>
                      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                        style={{ padding: '6px 10px', fontSize: '11.5px', fontWeight: 700, color: currentPage >= totalPages ? C.textFaint : C.textMid, background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '9px', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}>
                        Berikutnya
                      </button>
                    </div>
                  )}
                </div>
                {/* DESKTOP: table */}
                <div className="hidden md:block" style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <TableHead cols={[{ label: 'Pilih', center: true }, { label: '#' }, { label: 'Nama' }, { label: 'NISN' }, { label: 'JK', center: true }, { label: 'Jalur' }, { label: 'Ruang' }, { label: 'Sesi' }, { label: 'Tgl Tes' }, { label: 'Sumber' }, { label: 'Aksi', center: true }, { label: '', center: true }]} />
                    <tbody>
                      {pagedParticipants.map((p, i) => (
                        <tr key={p.id} style={{ borderBottom: i < pagedParticipants.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <input type="checkbox" checked={selectedParticipants.has(participantKey(p))} onChange={() => toggleParticipant(p)} />
                          </td>
                          <td style={{ padding: '10px 14px', color: C.textMuted }}>{pageStart + i + 1}</td>
                          <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{p.nama_lengkap}</td>
                          <td style={{ padding: '10px 14px', color: C.textMuted, fontFamily: 'monospace' }}>{p.nisn}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', color: C.textMuted, fontWeight: 600 }}>{normalizeJenisKelamin(p.jenis_kelamin) || '—'}</td>
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
                            {(p as any)._sumber === 'manual' && (
                              <button onClick={() => setConfirmDelPeserta(p)}
                                style={{ width: '28px', height: '28px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; (e.currentTarget as HTMLElement).style.color = '#dc2626'; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}>
                                <Trash2 size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* MOBILE: cards — compact & consistent */}
                <div className="md:hidden flex flex-col gap-2">
                  {(pagedParticipants as any[]).map((p: any) => (
                    <div key={p.id} style={{ background: C.white, border: `1.5px solid ${p.ruang_tes ? C.borderMid : C.borderMid}`, borderRadius: '14px', padding: '12px 14px' }}>
                      {/* Row 1: nama + ruangan badge */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                        <input type="checkbox" checked={selectedParticipants.has(participantKey(p))} onChange={() => toggleParticipant(p)} style={{ flexShrink: 0 }} />
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
                        {p.jenis_kelamin && <span style={{ color: C.textMuted, fontSize: '11px' }}>{normalizeJenisKelamin(p.jenis_kelamin)}</span>}
                      </div>
                      {/* Row 3: actions — full width, consistent */}
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => { setAssignTarget(p); setAssignRoom(p.ruang_tes || ''); setAssignJalur((p as any).jalur || ''); }}
                          style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px', color: C.green, background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '9px', padding: '7px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                          <UserPlus size={13} /> {p.ruang_tes ? 'Pindah Ruangan' : 'Assign Ruangan'}
                        </button>
                        {p._sumber === 'manual' && (
                          <button onClick={() => setConfirmDelPeserta(p)}
                            style={{ width: '36px', height: '36px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '9px', background: '#fef2f2', border: '1.5px solid #fecaca', cursor: 'pointer', color: '#dc2626', flexShrink: 0 }}>
                            <Trash2 size={14} />
                          </button>
                        )}
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
                : 'Peserta PMB tidak bisa dihapus dari CBT. Untuk mengeluarkan dari ruang/ujian, kosongkan ruang atau hapus assignment ujian.'}
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
function RoomsPage({ activeEventId }: { activeEventId?: string | null }) {
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
  const [studentAssignRoom, setStudentAssignRoom] = useState<Room | null>(null);
  const [studentCandidates, setStudentCandidates] = useState<any[]>([]);
  const [selectedRoomParticipants, setSelectedRoomParticipants] = useState<Set<string>>(new Set());
  const [studentCandidateSearch, setStudentCandidateSearch] = useState('');
  const [loadingStudentCandidates, setLoadingStudentCandidates] = useState(false);
  const [savingRoomStudentAssign, setSavingRoomStudentAssign] = useState(false);
  const [roomEvents, setRoomEvents] = useState<CbtEvent[]>([]);
  const [filterRoomEventId, setFilterRoomEventId] = useState<string>(() => activeEventId || 'ALL');

  useEffect(() => {
    setFilterRoomEventId(activeEventId || 'ALL');
  }, [activeEventId]);
  const [filterRoomDate, setFilterRoomDate] = useState('');
  const [filterRoomSession, setFilterRoomSession] = useState('');
  const [roomDateOptions, setRoomDateOptions] = useState<string[]>([]);
  const [roomSessionOptions, setRoomSessionOptions] = useState<string[]>([]);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [roomForm, setRoomForm] = useState({ room_name: '', capacity: 40, event_id: '' });
  const [savingRoom, setSavingRoom] = useState(false);
  const [confirmDelRoom, setConfirmDelRoom] = useState<Room | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const roomQs = new URLSearchParams();
    if (filterRoomDate) roomQs.set('tanggal_tes', filterRoomDate);
    if (filterRoomSession) roomQs.set('sesi_tes', filterRoomSession);
    if (filterRoomEventId !== 'ALL') roomQs.set('event_id', filterRoomEventId);
    const roomUrl = roomQs.toString() ? `/api/admin/rooms?${roomQs.toString()}` : '/api/admin/rooms';
    const [r, p, pmb, evs] = await Promise.all([
      GET<Room[]>(roomUrl),
      GET<Proctor[]>('/api/admin/proctors'),
      GET<Pendaftar[]>('/api/admin/pendaftar'),
      GET<CbtEvent[]>('/api/admin/events'),
    ]);
    if (r.success) setRooms(r.data || []);
    if (p.success) setProctors(p.data || []);
    if (evs.success) setRoomEvents(evs.data || []);
    if (pmb.success) {
      const pmbData = pmb.data || [];
      setRoomDateOptions(Array.from(new Set(pmbData.map((x: any) => x.tanggal_tes).filter(Boolean))).sort() as string[]);
      const sessionSource = filterRoomDate ? pmbData.filter((x: any) => x.tanggal_tes === filterRoomDate) : pmbData;
      const sessionOptions = Array.from(new Set(sessionSource.map((x: any) => x.sesi_tes).filter(Boolean))).sort() as string[];
      setRoomSessionOptions(sessionOptions);
      if (filterRoomSession && !sessionOptions.includes(filterRoomSession)) setFilterRoomSession('');
    }
    setLoading(false);
  }, [filterRoomDate, filterRoomSession, filterRoomEventId]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const changeRoomDate = (value: string) => {
    setFilterRoomDate(value);
    setFilterRoomSession('');
  };
  const syncRooms = async () => { setSyncing(true); const r = await POST('/api/admin/rooms/sync', {}); toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal'); setSyncing(false); fetchData(); };
  const openRoomForm = () => {
    const defaultEv = filterRoomEventId !== 'ALL' ? filterRoomEventId : '';
    setRoomForm({ room_name: '', capacity: 40, event_id: defaultEv });
    setShowRoomForm(true);
  };
  const saveRoom = async () => {
    const roomName = roomForm.room_name.trim();
    if (!roomName) { toast('error', 'Nama ruangan wajib diisi'); return; }
    setSavingRoom(true);
    const r = await POST('/api/admin/rooms', {
      room_name: roomName,
      capacity: roomForm.capacity,
      event_id: roomForm.event_id || null,
    });
    setSavingRoom(false);
    if (r.success) {
      toast('success', r.message || 'Ruangan ditambahkan');
      setShowRoomForm(false);
      fetchData();
    } else {
      toast('error', r.error || 'Gagal menambah ruangan');
    }
  };
  const deleteRoom = async () => {
    if (!confirmDelRoom) return;
    const r = await DEL(`/api/admin/rooms/${confirmDelRoom.id}`);
    if (r.success) {
      toast('success', r.message || 'Ruangan dihapus');
      setConfirmDelRoom(null);
      if (roomDetail?.id === confirmDelRoom.id) setRoomDetail(null);
      fetchData();
    } else {
      toast('error', r.error || 'Gagal menghapus ruangan');
    }
  };
  const assignProctor = async () => {
    if (!assignModal || !selectedProctor) return;
    const r = await PUT(`/api/admin/proctors/${selectedProctor}/assign`, { room_id: assignModal.id });
    if (r.success) {
      toast('success', 'Berhasil');
      setAssignModal(null);
      setSelectedProctor('');
      fetchData();
    } else {
      toast('error', r.error || 'Gagal assign proktor');
    }
  };
  const unassignProctor = async (pid: string) => {
    const r = await PUT(`/api/admin/proctors/${pid}/assign`, { room_id: null });
    toast(r.success ? 'success' : 'error', r.success ? 'Proktor dihapus' : r.error || 'Gagal melepas proktor');
    if (r.success) fetchData();
  };
  const unassigned = proctors.filter(p => !p.room_id);
  const roomParticipantKey = useCallback((p: any) => `${p.source}:${p.id}`, []);

  const openRoomDetail = async (room: Room) => {
    setRoomDetail(room);
    setLoadingStudents(true);
    setRoomStudents([]);
    const pmbQs = new URLSearchParams({ ruang_tes: room.room_name });
    if (filterRoomDate) pmbQs.set('tanggal_tes', filterRoomDate);
    if (filterRoomSession) pmbQs.set('sesi_tes', filterRoomSession);

    // Ambil dari tiga sumber: pendaftar PMB + cbt_users manual + cbt_exam_roster
    const [pmb, manual, roster] = await Promise.all([
      GET<any[]>(`/api/admin/pendaftar?${pmbQs.toString()}`),
      GET<any[]>(`/api/admin/users?role=student&room_id=${encodeURIComponent(room.id)}`),
      GET<any[]>(`/api/admin/roster?room_id=${encodeURIComponent(room.id)}`),
    ]);
    const pmbList = (pmb.success ? pmb.data || [] : []).map((p: any) => ({
      nama: p.nama_lengkap,
      nisn: p.nisn,
      ruang_tes: p.ruang_tes || room.room_name,
      sesi: p.sesi_tes,
      tanggal_tes: p.tanggal_tes,
      sumber: 'PMB',
    }));
    const pmbNisn = new Set(pmbList.map((p: any) => p.nisn).filter(Boolean));

    const rosterList = (roster.success ? roster.data || [] : []).map((r: any) => ({
      nama: r.full_name,
      nisn: r.nisn || r.username,
      ruang_tes: r.room_name || room.room_name,
      sesi: r.sesi_tes || '',
      tanggal_tes: r.tanggal_tes || '',
      sumber: (r.source_key || 'Roster').toUpperCase(),
    })).filter((r: any) => !r.nisn || !pmbNisn.has(r.nisn));

    const existingNisn = new Set([...pmbList, ...rosterList].map((x: any) => x.nisn).filter(Boolean));

    const manualList = (manual.success ? manual.data || [] : []).map((u: any) => ({
      nama: u.full_name,
      nisn: u.nisn || u.username,
      ruang_tes: room.room_name,
      sesi: '',
      tanggal_tes: '',
      sumber: 'Manual',
    })).filter((u: any) => !u.nisn || !existingNisn.has(u.nisn));

    setRoomStudents([...pmbList, ...rosterList, ...manualList]);
    setLoadingStudents(false);
  };

  const openStudentAssign = async (room: Room) => {
    setStudentAssignRoom(room);
    setSelectedRoomParticipants(new Set());
    setStudentCandidateSearch('');
    setLoadingStudentCandidates(true);
    const pmbQs = new URLSearchParams();
    if (filterRoomDate) pmbQs.set('tanggal_tes', filterRoomDate);
    if (filterRoomSession) pmbQs.set('sesi_tes', filterRoomSession);
    const [pmb, manual, roomListResp] = await Promise.all([
      GET<any[]>(pmbQs.toString() ? `/api/admin/pendaftar?${pmbQs.toString()}` : '/api/admin/pendaftar'),
      GET<any[]>('/api/admin/users?role=student'),
      GET<Room[]>('/api/admin/rooms'),
    ]);
    const roomList = roomListResp.success ? roomListResp.data || [] : rooms;
    const pmbList = (pmb.success ? pmb.data || [] : [])
      .filter((p: any) => p.ruang_tes !== room.room_name)
      .map((p: any) => ({
        id: p.id,
        source: 'pmb',
        nama: p.nama_lengkap,
        nisn: p.nisn,
        ruang_tes: p.ruang_tes || '',
        jalur: p.jalur || '',
        sesi_tes: p.sesi_tes || '',
        tanggal_tes: p.tanggal_tes || '',
      }));
    const pmbNisn = new Set((pmb.success ? pmb.data || [] : []).map((p: any) => p.nisn).filter(Boolean));
    const manualList = (manual.success ? manual.data || [] : [])
      .filter((u: any) => u.room_id !== room.id)
      .filter((u: any) => !u.nisn || !pmbNisn.has(u.nisn))
      .map((u: any) => ({
        id: u.id,
        source: 'manual',
        nama: u.full_name,
        nisn: u.nisn || u.username,
        ruang_tes: roomList.find((r: Room) => r.id === u.room_id)?.room_name || '',
        jalur: 'REGULER',
        sesi_tes: '',
        tanggal_tes: '',
      }));
    setStudentCandidates([...pmbList, ...manualList]);
    setLoadingStudentCandidates(false);
  };

  const filteredStudentCandidates = studentCandidates.filter((p: any) => {
    const q = studentCandidateSearch.trim().toLowerCase();
    if (!q) return true;
    return `${p.nama} ${p.nisn} ${p.ruang_tes} ${p.jalur} ${p.sesi_tes || ''} ${p.tanggal_tes || ''}`.toLowerCase().includes(q);
  });
  const visibleRoomCandidateKeys = filteredStudentCandidates.map(roomParticipantKey);
  const allRoomCandidatesSelected = visibleRoomCandidateKeys.length > 0 && visibleRoomCandidateKeys.every(k => selectedRoomParticipants.has(k));
  const toggleRoomCandidate = (p: any) => {
    const key = roomParticipantKey(p);
    setSelectedRoomParticipants(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleVisibleRoomCandidates = () => {
    setSelectedRoomParticipants(prev => {
      const next = new Set(prev);
      if (allRoomCandidatesSelected) visibleRoomCandidateKeys.forEach(k => next.delete(k));
      else visibleRoomCandidateKeys.forEach(k => next.add(k));
      return next;
    });
  };
  const saveRoomStudentAssign = async () => {
    if (!studentAssignRoom) return;
    const selectedRows = studentCandidates.filter((p: any) => selectedRoomParticipants.has(roomParticipantKey(p)));
    if (selectedRows.length === 0) { toast('error', 'Pilih minimal 1 peserta'); return; }
    setSavingRoomStudentAssign(true);
    const r = await POST('/api/admin/participants/assign-room', {
      ruang_tes: studentAssignRoom.room_name,
      participants: selectedRows.map((p: any) => ({ id: p.id, source: p.source })),
    });
    setSavingRoomStudentAssign(false);
    if (r.success) {
      toast('success', r.message || 'Peserta berhasil di-assign');
      setStudentAssignRoom(null);
      setStudentCandidates([]);
      setSelectedRoomParticipants(new Set());
      fetchData();
      if (roomDetail?.id === studentAssignRoom.id) openRoomDetail(studentAssignRoom);
    } else {
      toast('error', r.error || 'Gagal');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: C.text, fontSize: '15px', fontWeight: 800 }}>Ruangan & Proktor</p>
          <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '1px' }}>Assign proktor ke ruangan ujian</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={openRoomForm}><Plus size={13} /> Tambah Ruangan</Button>
          <Button size="sm" loading={syncing} onClick={syncRooms}><RefreshCw size={13} /> Sinkronkan</Button>
        </div>
      </div>
      {/* ── FILTER JENIS KEGIATAN ── */}
      <div style={{ background: '#f8faf8', borderBottom: `1.5px solid ${C.border}`, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, color: C.green, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', marginRight: '4px' }}>
          Kegiatan:
        </span>
        <button type="button" onClick={() => setFilterRoomEventId('ALL')}
          style={{
            padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1.5px solid ${filterRoomEventId === 'ALL' ? C.green : C.borderMid}`,
            background: filterRoomEventId === 'ALL' ? C.greenLight : C.white,
            color: filterRoomEventId === 'ALL' ? C.green : C.textMuted,
            transition: 'all 0.12s',
          }}>
          Semua Kegiatan ({rooms.length})
        </button>
        {roomEvents.map(ev => {
          const isSelected = filterRoomEventId === ev.id;
          const count = rooms.filter((r: any) => !r.event_id || r.event_id === ev.id).length;
          return (
            <button key={ev.id} type="button" onClick={() => setFilterRoomEventId(ev.id)}
              style={{
                padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', whiteSpace: 'nowrap',
                border: `1.5px solid ${isSelected ? C.green : C.borderMid}`,
                background: isSelected ? C.greenLight : C.white,
                color: isSelected ? C.green : C.textMuted,
                transition: 'all 0.12s',
              }}>
              {ev.code} · {ev.name} ({count})
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, padding: '16px 20px' }} className="space-y-3">
        <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', padding: '10px 12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            value={filterRoomDate}
            onChange={e => changeRoomDate(e.target.value)}
            options={[{ value: '', label: 'Semua Tanggal' }, ...roomDateOptions.map(t => ({ value: t, label: t }))]}
          />
          <Select
            value={filterRoomSession}
            onChange={e => setFilterRoomSession(e.target.value)}
            options={[{ value: '', label: 'Semua Sesi' }, ...roomSessionOptions.map(s => ({ value: s, label: s }))]}
          />
          {(filterRoomSession || filterRoomDate || filterRoomEventId !== 'ALL') && (
            <Button variant="secondary" size="sm" onClick={() => { setFilterRoomSession(''); setFilterRoomDate(''); setFilterRoomEventId('ALL'); }}>
              Reset Filter
            </Button>
          )}
        </div>
        {loading ? <div className="py-12 text-center"><Spinner /></div>
          : rooms.length === 0 ? <EmptyState title="Belum ada ruangan" desc="Tambah ruangan manual atau klik Sinkronkan dari PMB" />
            : (
              <>
                {/* DESKTOP: table */}
                <div className="hidden md:block" style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <TableHead cols={[{ label: '#' }, { label: 'Ruangan' }, { label: 'Kegiatan' }, { label: 'Peserta', center: true }, { label: 'Proktor' }, { label: 'Aksi', center: true }]} />
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
                            <td style={{ padding: '10px 14px' }}>
                              {r.event_code ? (
                                <span style={{ background: '#f0fdf4', color: C.green, border: `1px solid ${C.greenBorder}`, fontSize: '10px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>
                                  {r.event_code}
                                </span>
                              ) : (
                                <span style={{ color: C.textFaint, fontSize: '11px', fontStyle: 'italic' }}>Universal</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}><span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>{r.jumlah_peserta || 0}</span></td>
                            <td style={{ padding: '10px 14px' }}>
                              {rp.length === 0 ? <span style={{ color: C.borderMid }}>Belum ada</span>
                                : <div className="space-y-1">{rp.map(p => <div key={p.id} className="flex items-center gap-1.5 text-xs" style={{ color: C.textMid }}><span>{p.full_name}</span><button onClick={() => unassignProctor(p.id)} style={{ color: C.borderMid, background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}><X size={11} /></button></div>)}</div>}
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                <button onClick={() => openStudentAssign(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#1a5fa8', fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                                  <Users size={12} /> Peserta
                                </button>
                                <button onClick={() => { setAssignModal(r); setSelectedProctor(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: C.green, fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                                  <UserPlus size={12} /> Proktor
                                </button>
                                <button onClick={() => setConfirmDelRoom(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                                  <Trash2 size={12} /> Hapus
                                </button>
                              </div>
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {r.event_code && (
                              <span style={{ background: '#f0fdf4', color: C.green, border: `1px solid ${C.greenBorder}`, fontSize: '9.5px', fontWeight: 800, padding: '2px 7px', borderRadius: '999px' }}>
                                {r.event_code}
                              </span>
                            )}
                            <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px' }}>{r.jumlah_peserta || 0} peserta</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            {rp.length === 0
                              ? <p style={{ color: C.textFaint, fontSize: '11.5px' }}>Belum ada proktor</p>
                              : rp.map(p => <p key={p.id} style={{ color: C.textMid, fontSize: '11.5px', fontWeight: 600 }}>{p.full_name}</p>)}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <button onClick={() => openStudentAssign(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#1a5fa8', fontSize: '11.5px', fontWeight: 700, background: '#e0f0ff', border: '1.5px solid #b8ddff', borderRadius: '8px', padding: '5px 9px', cursor: 'pointer' }}>
                              <Users size={12} /> Peserta
                            </button>
                            <button onClick={() => { setAssignModal(r); setSelectedProctor(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: C.green, fontSize: '11.5px', fontWeight: 700, background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '8px', padding: '5px 9px', cursor: 'pointer' }}>
                              <UserPlus size={12} /> Proktor
                            </button>
                            <button onClick={() => setConfirmDelRoom(r)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#dc2626', fontSize: '11.5px', fontWeight: 700, background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '8px', padding: '5px 9px', cursor: 'pointer' }}>
                              <Trash2 size={12} /> Hapus
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
      </div>

      <Modal open={showRoomForm} onClose={() => setShowRoomForm(false)} title="Tambah Ruangan" size="sm">
        <div className="space-y-3">
          <Input
            label="Nama Ruangan"
            placeholder="Contoh: Ruang 1"
            value={roomForm.room_name}
            onChange={e => setRoomForm(prev => ({ ...prev, room_name: e.target.value }))}
          />
          <Input
            label="Kapasitas"
            type="number"
            min={1}
            value={roomForm.capacity}
            onChange={e => setRoomForm(prev => ({ ...prev, capacity: Number(e.target.value) || 1 }))}
          />
          <Select
            label="Kegiatan / Event (Opsional)"
            value={roomForm.event_id}
            onChange={e => setRoomForm(prev => ({ ...prev, event_id: e.target.value }))}
            options={[
              { value: '', label: '— Universal / Semua Kegiatan —' },
              ...roomEvents.map(ev => ({ value: ev.id, label: `${ev.code} · ${ev.name}` })),
            ]}
          />
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setShowRoomForm(false)}>Batal</Button>
            <Button size="sm" loading={savingRoom} onClick={saveRoom}>Simpan</Button>
          </div>
        </div>
      </Modal>

      <Confirm
        open={!!confirmDelRoom}
        onClose={() => setConfirmDelRoom(null)}
        onConfirm={deleteRoom}
        title="Hapus Ruangan?"
        confirmText="Ya, Hapus"
        message={`Hapus ${confirmDelRoom?.room_name || 'ruangan ini'}? Proktor dan peserta yang masih terhubung ke ruangan ini akan dilepas. Ruangan yang sudah memiliki sesi ujian tidak bisa dihapus.`}
      />

      {/* Modal detail siswa per ruangan */}
      <Modal open={!!roomDetail} onClose={() => setRoomDetail(null)} title={`Siswa — ${roomDetail?.room_name}`} size="md">
        {roomDetail && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
            <Button size="sm" onClick={() => openStudentAssign(roomDetail)}><Users size={13} /> Tambah Peserta</Button>
          </div>
        )}
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
                        <th style={{ padding: '8px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tgl Tes</th>
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
                          <td style={{ padding: '9px 14px', color: C.textMuted, whiteSpace: 'nowrap' }}>{s.tanggal_tes || '—'}</td>
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

      <Modal open={!!studentAssignRoom} onClose={() => setStudentAssignRoom(null)} title={`Tambah Peserta — ${studentAssignRoom?.room_name}`} size="lg">
        <div className="space-y-3">
          <Input
            placeholder="Cari nama, NISN, ruangan, jalur, sesi, tanggal..."
            value={studentCandidateSearch}
            onChange={e => setStudentCandidateSearch(e.target.value)}
          />
          {loadingStudentCandidates
            ? <div className="py-8 text-center"><Spinner /></div>
            : studentCandidates.length === 0
              ? <EmptyState title="Tidak ada kandidat peserta" desc="Semua peserta sudah berada di ruangan ini" />
              : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={toggleVisibleRoomCandidates}
                      style={{ fontSize: '11.5px', fontWeight: 700, color: allRoomCandidatesSelected ? '#dc2626' : C.green, background: allRoomCandidatesSelected ? '#fef2f2' : C.greenLight, border: `1.5px solid ${allRoomCandidatesSelected ? '#fecaca' : C.greenBorder}`, borderRadius: '9px', padding: '7px 11px', cursor: 'pointer' }}>
                      {allRoomCandidatesSelected ? 'Batal pilih hasil' : 'Pilih semua hasil'}
                    </button>
                    <span style={{ color: C.textMuted, fontSize: '11.5px', fontWeight: 700 }}>
                      {selectedRoomParticipants.size} dipilih · {filteredStudentCandidates.length} kandidat
                    </span>
                  </div>
                  <div style={{ maxHeight: '360px', overflowY: 'auto', border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', background: C.bg }}>
                    {filteredStudentCandidates.length === 0
                      ? <p style={{ padding: '20px', textAlign: 'center', color: C.textFaint, fontSize: '12px' }}>Tidak ada hasil</p>
                      : filteredStudentCandidates.map((p: any, i: number) => (
                        <label key={roomParticipantKey(p)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderBottom: i < filteredStudentCandidates.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: C.white, cursor: 'pointer' }}>
                          <input type="checkbox" checked={selectedRoomParticipants.has(roomParticipantKey(p))} onChange={() => toggleRoomCandidate(p)} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ color: C.text, fontSize: '12.5px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nama}</p>
                            <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '2px' }}>
                              {[
                                p.nisn || 'Tanpa NISN',
                                p.ruang_tes || 'Belum ada ruangan',
                                p.sesi_tes || null,
                                p.tanggal_tes || null,
                              ].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <span style={{ background: p.source === 'manual' ? '#fffbeb' : '#e2ebe3', color: p.source === 'manual' ? '#b45309' : '#2d6644', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', flexShrink: 0 }}>
                            {p.source === 'manual' ? 'Manual' : 'PMB'}
                          </span>
                        </label>
                      ))}
                  </div>
                </>
              )}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setStudentAssignRoom(null)}>Batal</Button>
            <Button size="sm" loading={savingRoomStudentAssign} disabled={selectedRoomParticipants.size === 0} onClick={saveRoomStudentAssign}>
              Assign {selectedRoomParticipants.size} Peserta
            </Button>
          </div>
        </div>
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

  // ── GTK IMPORT STATE ──
  const [showGtkModal, setShowGtkModal] = useState(false);
  const [gtkUsers, setGtkUsers] = useState<any[]>([]);
  const [loadingGtk, setLoadingGtk] = useState(false);
  const [gtkSearch, setGtkSearch] = useState('');
  const [selectedGtkEmails, setSelectedGtkEmails] = useState<Set<string>>(new Set());
  const [importingGtk, setImportingGtk] = useState(false);

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

  const openGtkModal = async () => {
    setShowGtkModal(true);
    setLoadingGtk(true);
    setSelectedGtkEmails(new Set());
    setGtkSearch('');
    const r = await GET<any[]>('/api/admin/gtk-users');
    if (r.success) {
      setGtkUsers(r.data || []);
    } else {
      toast('error', r.error || 'Gagal mengambil data GTK');
    }
    setLoadingGtk(false);
  };

  const toggleGtkEmail = (email: string) => {
    setSelectedGtkEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const filteredGtk = gtkUsers.filter((u: any) => {
    const q = gtkSearch.trim().toLowerCase();
    if (!q) return true;
    return `${u.nama_lengkap} ${u.email}`.toLowerCase().includes(q);
  });

  const importGtkUsers = async () => {
    const selectedRows = gtkUsers.filter((u: any) => selectedGtkEmails.has(u.email));
    if (selectedRows.length === 0) { toast('error', 'Pilih minimal 1 GTK'); return; }
    setImportingGtk(true);
    const r = await POST('/api/admin/gtk-users/import', {
      users: selectedRows.map((u: any) => ({
        email: u.email,
        name: u.nama_lengkap,
        role: tab === 'admin' ? 'admin' : 'proctor',
        password: u.password || 'mansatas2026',
      })),
    });
    setImportingGtk(false);
    if (r.success) {
      toast('success', r.message || 'Berhasil di-import');
      setShowGtkModal(false);
      fetchData();
    } else {
      toast('error', r.error || 'Gagal import GTK');
    }
  };

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

  const setupDummy = async () => {
    const inputName = prompt('Masukkan nama tampilan akun percobaan:', 'EL PERCOBAAN');
    if (inputName === null) return;
    const name = inputName.trim() || 'EL PERCOBAAN';
    const r = await POST('/api/admin/dummy-user/setup', { username: 'percobaan', password: 'percobaan1234', full_name: name });
    if (r.success) toast('success', r.message || `Akun percobaan "${name}" berhasil disiapkan (Username: percobaan / Password: percobaan1234)`);
    else toast('error', r.error || 'Gagal menyiapkan akun percobaan');
  };

  const resetDummyAll = async () => {
    if (!confirm('Bersihkan seluruh hasil pengerjaan akun percobaan?')) return;
    const r = await POST('/api/admin/dummy-user/reset-all', {});
    if (r.success) toast('success', r.message || 'Data percobaan berhasil dibersihkan');
    else toast('error', r.error || 'Gagal membersihkan data percobaan');
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={setupDummy}>Setup Akun Percobaan</Button>
          <Button variant="secondary" size="sm" onClick={resetDummyAll}>Reset Hasil Percobaan</Button>
          <Button variant="secondary" size="sm" onClick={openGtkModal}><Download size={13} /> Import dari MANSATAS App (GTK)</Button>
          <Button size="sm" onClick={() => setEditUser({ role: tab, is_active: 1 })}><Plus size={13} /> Tambah {tab === 'proktor' ? 'Proktor' : 'Admin'}</Button>
        </div>
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

      <Modal open={showGtkModal} onClose={() => setShowGtkModal(false)} title={`Import GTK dari MANSATAS App (${tab === 'admin' ? 'Admin' : 'Proktor'})`} size="lg">
        <div className="space-y-3">
          <p style={{ color: C.textMuted, fontSize: '11.5px' }}>Pilih akun GTK/User MANSATAS App yang ingin di-import sebagai {tab === 'admin' ? 'Admin' : 'Proktor'}. Username menggunakan email, password default adalah <code className="bg-emerald-50 px-1 py-0.5 rounded text-emerald-800 font-mono">mansatas2026</code> (atau sesuai password MANSATAS App).</p>
          <Input
            placeholder="Cari nama GTK atau email..."
            value={gtkSearch}
            onChange={e => setGtkSearch(e.target.value)}
          />
          {loadingGtk ? <div className="py-8 text-center"><Spinner /></div>
            : filteredGtk.length === 0
              ? <EmptyState title="Tidak ada GTK ditemukan" desc="Semua GTK mungkin sudah di-import atau data belum tersedia" />
              : (
                <div style={{ maxHeight: '340px', overflowY: 'auto', border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', background: C.bg }}>
                  {filteredGtk.map((u: any, i: number) => {
                    const isSelected = selectedGtkEmails.has(u.email);
                    return (
                      <label key={u.email} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderBottom: i < filteredGtk.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: isSelected ? C.greenLight : C.white, cursor: u.already_imported ? 'not-allowed' : 'pointer', opacity: u.already_imported ? 0.6 : 1 }}>
                        <input
                          type="checkbox"
                          disabled={u.already_imported}
                          checked={isSelected || u.already_imported}
                          onChange={() => toggleGtkEmail(u.email)}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ color: C.text, fontSize: '12.5px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.nama_lengkap}</p>
                          <p style={{ color: C.textMuted, fontSize: '11px', fontFamily: 'monospace' }}>{u.email}</p>
                        </div>
                        {u.already_imported && (
                          <span style={{ background: C.greenLight, color: C.green, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>Sudah Terdaftar</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="secondary" size="sm" onClick={() => setShowGtkModal(false)}>Batal</Button>
            <Button size="sm" loading={importingGtk} disabled={selectedGtkEmails.size === 0} onClick={importGtkUsers}>
              Import {selectedGtkEmails.size} GTK ({tab === 'admin' ? 'Admin' : 'Proktor'})
            </Button>
          </div>
        </div>
      </Modal>
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
                <p style={{ color: '#7a9e86', fontSize: '9.5px', fontWeight: 600, fontStyle: 'italic' }}>Bangkit · Jaya · Juara</p>
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
