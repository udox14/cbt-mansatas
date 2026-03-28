'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST, PUT, DEL } from '@/lib/api';
import { Button, Input, Textarea, Select, Modal, Badge, LoadingScreen, EmptyState,
  ToastProvider, useToast, Confirm, Spinner } from '@/components/ui';
import RichEditor from '@/components/admin/RichEditor';
import BulkImport from '@/components/admin/BulkImport';
import { exportExamResults } from '@/lib/export';
import { ClipboardList, Users, School, Shield, LogOut, Menu, ChevronLeft, Plus, FileDown,
  RefreshCw, Pencil, Trash2, Upload, Image, Volume2, X, MoreHorizontal, Eye, UserPlus } from 'lucide-react';

interface Room { id: string; room_name: string; capacity: number; jumlah_peserta?: number }
interface Proctor { id: string; username: string; full_name: string; room_id: string | null; room_name?: string }
interface Pendaftar { id: string; nisn: string; nama_lengkap: string; no_pendaftaran: string; ruang_tes: string; jalur: string; asal_sekolah: string; jenis_kelamin: string; tanggal_lahir: string; tanggal_tes: string; sesi_tes: string }
interface Exam { id: string; title: string; description: string | null; duration_minutes: number; active_status: string; question_count: number; is_score_visible: number; randomize_questions: number; randomize_options: number; rules_text: string | null; completion_message: string; passing_score: number }
interface Question { id: string; question_text: string; question_type: string; question_order: number; image_url: string | null; audio_url: string | null; options: QOption[] }
interface QOption { id?: string; option_label: string; option_text: string; image_url: string | null; is_correct: number }

type Page = 'exams' | 'peserta' | 'rooms' | 'pelaksana';

function AdminContent() {
  const { user, loading: authLoading, logout } = useAuth('admin');
  const [page, setPage] = useState<Page>('exams');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  if (authLoading) return <LoadingScreen />;
  if (!user) return null;

  const menu: { key: Page; label: string; Icon: any }[] = [
    { key: 'exams', label: 'Ujian', Icon: ClipboardList },
    { key: 'peserta', label: 'Peserta Tes', Icon: Users },
    { key: 'rooms', label: 'Ruangan & Proktor', Icon: School },
    { key: 'pelaksana', label: 'Pelaksana Tes', Icon: Shield },
  ];
  const nav = (p: Page) => { setPage(p); setSidebarOpen(false); };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {sidebarOpen && <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-56 bg-white border-r border-gray-100 flex flex-col
        transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-gray-100">
          <p className="text-sm font-bold text-gray-900">CBT Admin</p>
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">{user.full_name}</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {menu.map(m => (
            <button key={m.key} onClick={() => nav(m.key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium flex items-center gap-2.5 transition-colors
                ${page === m.key ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}>
              <m.Icon size={16} strokeWidth={page === m.key ? 2 : 1.5} /> {m.label}
            </button>
          ))}
        </nav>
        <div className="p-2 border-t border-gray-100">
          <button onClick={logout} className="w-full text-left px-3 py-2 rounded-lg text-[13px] text-gray-400 hover:text-red-500 hover:bg-red-50 font-medium flex items-center gap-2.5">
            <LogOut size={15} /> Keluar
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 lg:hidden">
          <button onClick={() => setSidebarOpen(true)}><Menu size={20} className="text-gray-600" /></button>
          <h1 className="text-sm font-semibold text-gray-800">{menu.find(m => m.key === page)?.label}</h1>
        </header>
        <main className="p-4 lg:p-6 max-w-5xl mx-auto">
          {page === 'exams' && <ExamsPage />}
          {page === 'peserta' && <PesertaPage />}
          {page === 'rooms' && <RoomsPage />}
          {page === 'pelaksana' && <PelaksanaPage />}
        </main>
      </div>
    </div>
  );
}

// ── PESERTA TES ──────────────────────────────────────────────
function PesertaPage() {
  const [data, setData] = useState<Pendaftar[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  useEffect(() => { GET<Pendaftar[]>('/api/admin/pendaftar').then(r => { if (r.success) setData(r.data || []); setLoading(false); }); }, []);
  const filtered = filter ? data.filter(p => p.ruang_tes === filter) : data;
  const rooms = Array.from(new Set(data.map(p => p.ruang_tes).filter(Boolean))).sort();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-800">Peserta Tes <span className="text-gray-400 font-normal">({data.length})</span></h2>
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setFilter('')} className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${!filter ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>Semua</button>
          {rooms.map(r => <button key={r} onClick={() => setFilter(r)} className={`text-xs px-2.5 py-1 rounded-full font-medium transition ${filter === r ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{r}</button>)}
        </div>
      </div>
      <p className="text-xs text-gray-400">Data otomatis dari pendaftaran PMB. Login: NISN + tanggal lahir (DDMMYYYY).</p>
      {loading ? <div className="py-12 text-center"><Spinner /></div> : filtered.length === 0 ? <EmptyState title="Belum ada peserta" desc="Data muncul setelah pendaftaran PMB dibuka" /> : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="bg-gray-50 text-gray-500 border-b border-gray-100">
              <th className="text-left px-4 py-2.5 font-medium w-10">#</th><th className="text-left px-4 py-2.5 font-medium">Nama</th><th className="text-left px-4 py-2.5 font-medium">NISN</th><th className="text-left px-4 py-2.5 font-medium">No. Daftar</th><th className="text-left px-4 py-2.5 font-medium">Ruang</th><th className="text-left px-4 py-2.5 font-medium">Jalur</th><th className="text-left px-4 py-2.5 font-medium">Sesi</th><th className="text-left px-4 py-2.5 font-medium">Tgl Tes</th>
            </tr></thead>
            <tbody>{filtered.map((p, i) => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-2.5 text-gray-400">{i + 1}</td><td className="px-4 py-2.5 font-medium text-gray-800">{p.nama_lengkap}</td>
                <td className="px-4 py-2.5 font-mono text-gray-500">{p.nisn}</td><td className="px-4 py-2.5 text-gray-500">{p.no_pendaftaran || '-'}</td>
                <td className="px-4 py-2.5">{p.ruang_tes ? <Badge color="blue">{p.ruang_tes}</Badge> : <span className="text-gray-300">—</span>}</td>
                <td className="px-4 py-2.5 text-gray-500">{p.jalur}</td><td className="px-4 py-2.5 text-gray-500">{p.sesi_tes || '-'}</td><td className="px-4 py-2.5 text-gray-500">{p.tanggal_tes || '-'}</td>
              </tr>))}</tbody>
          </table></div></div>
      )}
    </div>
  );
}

// ── RUANGAN & PROKTOR ────────────────────────────────────────
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
  const assignProctor = async () => { if (!assignModal || !selectedProctor) return; await PUT(`/api/admin/proctors/${selectedProctor}/assign`, { room_id: assignModal.id }); toast('success', 'Proktor berhasil di-assign'); setAssignModal(null); setSelectedProctor(''); fetchData(); };
  const unassignProctor = async (pid: string) => { await PUT(`/api/admin/proctors/${pid}/assign`, { room_id: null }); toast('success', 'Proktor dihapus dari ruangan'); fetchData(); };
  const unassigned = proctors.filter(p => !p.room_id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800">Ruangan & Proktor</h2>
        <Button size="sm" loading={syncing} onClick={syncRooms}><RefreshCw size={13} /> Sinkronkan dari PMB</Button>
      </div>
      <p className="text-xs text-gray-400">Ruangan otomatis dari <code className="bg-gray-100 px-1 py-0.5 rounded text-[10px]">ruang_tes</code> pendaftar. Assign proktor di kolom aksi.</p>
      {loading ? <div className="py-12 text-center"><Spinner /></div> : rooms.length === 0 ? <EmptyState title="Belum ada ruangan" desc="Klik Sinkronkan dari PMB" /> : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-xs"><thead><tr className="bg-gray-50 text-gray-500 border-b border-gray-100">
            <th className="text-left px-4 py-2.5 font-medium w-10">#</th><th className="text-left px-4 py-2.5 font-medium">Ruangan</th><th className="text-center px-4 py-2.5 font-medium">Peserta</th><th className="text-left px-4 py-2.5 font-medium">Proktor</th><th className="text-center px-4 py-2.5 font-medium w-24">Aksi</th>
          </tr></thead>
          <tbody>{rooms.map((r, i) => { const rp = proctors.filter(p => p.room_id === r.id); return (
            <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
              <td className="px-4 py-2.5 font-medium text-gray-800">{r.room_name}</td>
              <td className="text-center px-4 py-2.5"><Badge color="blue">{r.jumlah_peserta || 0}</Badge></td>
              <td className="px-4 py-3">{rp.length === 0 ? <span className="text-gray-300">Belum ada</span> : (
                <div className="space-y-1">{rp.map(p => <div key={p.id} className="flex items-center gap-1.5 text-gray-600"><span>{p.full_name}</span>
                  <button onClick={() => unassignProctor(p.id)} className="text-gray-300 hover:text-red-500"><X size={12} /></button></div>)}</div>
              )}</td>
              <td className="text-center px-4 py-2.5"><button onClick={() => { setAssignModal(r); setSelectedProctor(''); }} className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1 mx-auto"><UserPlus size={12} /> Assign</button></td>
            </tr>);})}</tbody></table></div>
      )}
      <Modal open={!!assignModal} onClose={() => setAssignModal(null)} title={`Assign Proktor — ${assignModal?.room_name}`} size="sm">
        {unassigned.length === 0 ? <p className="text-sm text-gray-500">Semua proktor sudah di-assign. Buat akun baru di menu Pelaksana Tes.</p> : (
          <div className="space-y-3"><Select label="Pilih Proktor" value={selectedProctor} onChange={e => setSelectedProctor(e.target.value)}
            options={[{ value: '', label: '— Pilih —' }, ...unassigned.map(p => ({ value: p.id, label: `${p.full_name} (${p.username})` }))]} />
            <div className="flex gap-2 justify-end"><Button variant="secondary" size="sm" onClick={() => setAssignModal(null)}>Batal</Button><Button size="sm" disabled={!selectedProctor} onClick={assignProctor}>Assign</Button></div></div>
        )}
      </Modal>
    </div>
  );
}

// ── PELAKSANA TES ────────────────────────────────────────────
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">Pelaksana Tes <span className="text-gray-400 font-normal">({proctors.length})</span></h2>
        <Button size="sm" onClick={() => setEditUser({ role: 'proctor', is_active: 1 })}><Plus size={14} /> Tambah Proktor</Button>
      </div>
      <p className="text-xs text-gray-400">Buat akun proktor, lalu assign ke ruangan di menu Ruangan & Proktor.</p>
      {loading ? <div className="py-12 text-center"><Spinner /></div> : proctors.length === 0 ? <EmptyState title="Belum ada proktor" /> : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden"><table className="w-full text-xs">
          <thead><tr className="bg-gray-50 text-gray-500 border-b border-gray-100"><th className="text-left px-4 py-2.5 font-medium w-10">#</th><th className="text-left px-4 py-2.5 font-medium">Nama</th><th className="text-left px-4 py-2.5 font-medium">Username</th><th className="text-left px-4 py-2.5 font-medium">Ruangan</th><th className="text-center px-4 py-2.5 font-medium w-20">Aksi</th></tr></thead>
          <tbody>{proctors.map((p, i) => (
            <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="px-4 py-2.5 text-gray-400">{i + 1}</td><td className="px-4 py-2.5 font-medium text-gray-800">{p.full_name}</td>
              <td className="px-4 py-2.5 font-mono text-gray-500">{p.username}</td>
              <td className="px-4 py-2.5">{p.room_name ? <Badge color="blue">{p.room_name}</Badge> : <span className="text-gray-300">—</span>}</td>
              <td className="text-center px-4 py-2.5"><div className="flex items-center justify-center gap-2">
                <button onClick={() => setEditUser({ id: p.id, username: p.username, full_name: p.full_name })} className="text-gray-400 hover:text-primary-600"><Pencil size={13} /></button>
                <button onClick={() => del(p.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
              </div></td>
            </tr>))}</tbody>
        </table></div>
      )}
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

// ── EXAMS PAGE ───────────────────────────────────────────────
function ExamsPage() {
  const { toast } = useToast();
  const [exams, setExams] = useState<Exam[]>([]); const [loading, setLoading] = useState(true);
  const [editExam, setEditExam] = useState<Partial<Exam> | null>(null); const [saving, setSaving] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null); const [viewMode, setViewMode] = useState<string | null>(null);
  const fetch = useCallback(async () => { const r = await GET<Exam[]>('/api/admin/exams'); if (r.success) setExams(r.data || []); setLoading(false); }, []);
  useEffect(() => { fetch(); }, [fetch]);
  const saveExam = async () => { if (!editExam?.title) { toast('error', 'Judul wajib'); return; } setSaving(true);
    const r = editExam.id ? await PUT(`/api/admin/exams/${editExam.id}`, editExam) : await POST('/api/admin/exams', editExam);
    setSaving(false); if (r.success) { toast('success', 'Berhasil'); setEditExam(null); fetch(); } else toast('error', r.error || 'Gagal'); };
  const st: Record<string, { l: string; c: string }> = { draft: { l: 'Draft', c: 'gray' }, active: { l: 'Aktif', c: 'green' }, finished: { l: 'Selesai', c: 'blue' } };

  if (viewId && viewMode === 'questions') return <QuestionsView examId={viewId} onBack={() => { setViewId(null); setViewMode(null); }} />;
  if (viewId && viewMode === 'tokens') return <TokensView examId={viewId} onBack={() => { setViewId(null); setViewMode(null); }} />;
  if (viewId && viewMode === 'results') return <ResultsView examId={viewId} onBack={() => { setViewId(null); setViewMode(null); }} />;
  if (viewId && viewMode === 'monitor') return <MonitorView examId={viewId} onBack={() => { setViewId(null); setViewMode(null); }} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-gray-800">Daftar Ujian</h2>
        <Button size="sm" onClick={() => setEditExam({ duration_minutes: 60, active_status: 'draft' })}><Plus size={14} /> Buat Ujian</Button></div>
      {loading ? <div className="py-12 text-center"><Spinner /></div> : exams.length === 0 ? <EmptyState title="Belum ada ujian" /> : (
        <div className="space-y-2">{exams.map(e => (
          <div key={e.id} className="bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div><div className="flex items-center gap-2"><h3 className="font-medium text-sm text-gray-900">{e.title}</h3><Badge color={st[e.active_status]?.c}>{st[e.active_status]?.l}</Badge></div>
                <p className="text-xs text-gray-400 mt-1">{e.duration_minutes} menit · {e.question_count} soal</p></div>
              <button onClick={() => setEditExam(e)} className="text-gray-400 hover:text-gray-600"><Pencil size={14} /></button>
            </div>
            <div className="flex gap-1.5 mt-3">{(['questions','tokens','monitor','results'] as const).map(v => (
              <button key={v} onClick={() => { setViewId(e.id); setViewMode(v); }}
                className="text-[11px] px-2.5 py-1 bg-gray-50 hover:bg-gray-100 rounded-md text-gray-600 font-medium transition">
                {{ questions: 'Soal', tokens: 'Token', monitor: 'Monitor', results: 'Hasil' }[v]}</button>))}</div>
          </div>))}</div>
      )}
      <Modal open={!!editExam} onClose={() => setEditExam(null)} title={editExam?.id ? 'Edit Ujian' : 'Buat Ujian'} size="lg">
        {editExam && <div className="space-y-3">
          <Input label="Judul" value={editExam.title || ''} onChange={e => setEditExam({ ...editExam, title: e.target.value })} />
          <Textarea label="Deskripsi" value={editExam.description || ''} rows={2} onChange={e => setEditExam({ ...editExam, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-3"><Input label="Durasi (menit)" type="number" value={editExam.duration_minutes || 60} onChange={e => setEditExam({ ...editExam, duration_minutes: parseInt(e.target.value) })} />
            <Select label="Status" value={editExam.active_status || 'draft'} onChange={e => setEditExam({ ...editExam, active_status: e.target.value })} options={[{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Aktif' }, { value: 'finished', label: 'Selesai' }]} /></div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Tata Tertib</label><RichEditor value={editExam.rules_text || ''} onChange={v => setEditExam({ ...editExam, rules_text: v })} minHeight={80} /></div>
          <Input label="Pesan Selesai" value={editExam.completion_message || ''} onChange={e => setEditExam({ ...editExam, completion_message: e.target.value })} />
          <div className="flex flex-wrap gap-4 text-xs text-gray-600">{[{ k: 'randomize_questions', l: 'Acak Soal' },{ k: 'randomize_options', l: 'Acak Opsi' },{ k: 'is_score_visible', l: 'Tampilkan Skor' }].map(c => (
            <label key={c.k} className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!(editExam as any)[c.k]} onChange={e => setEditExam({ ...editExam, [c.k]: e.target.checked ? 1 : 0 })} className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />{c.l}</label>))}</div>
          <div className="flex gap-2 justify-end pt-2"><Button variant="secondary" size="sm" onClick={() => setEditExam(null)}>Batal</Button><Button size="sm" loading={saving} onClick={saveExam}>Simpan</Button></div>
        </div>}
      </Modal>
    </div>
  );
}

// ── QUESTIONS ────────────────────────────────────────────────
function QuestionsView({ examId, onBack }: { examId: string; onBack: () => void }) {
  const { toast } = useToast();
  const [questions, setQuestions] = useState<Question[]>([]); const [loading, setLoading] = useState(true);
  const [editQ, setEditQ] = useState<Partial<Question & { options: QOption[] }> | null>(null); const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState<string | null>(null); const [showImport, setShowImport] = useState(false); const [uploading, setUploading] = useState('');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
  const fetch = useCallback(async () => { const r = await GET<Question[]>(`/api/admin/exams/${examId}/questions`); if (r.success) setQuestions(r.data || []); setLoading(false); }, [examId]);
  useEffect(() => { fetch(); }, [fetch]);
  const saveQ = async () => { if (!editQ?.question_text) { toast('error', 'Teks soal wajib'); return; } setSaving(true);
    const r = editQ.id ? await PUT(`/api/admin/questions/${editQ.id}`, editQ) : await POST(`/api/admin/exams/${examId}/questions`, { ...editQ, question_order: questions.length + 1 });
    setSaving(false); if (r.success) { toast('success', 'Berhasil'); setEditQ(null); fetch(); } else toast('error', r.error || 'Gagal'); };
  const delQ = async () => { if (!delTarget) return; await DEL(`/api/admin/questions/${delTarget}`); setDelTarget(null); fetch(); };
  const newQ = () => setEditQ({ question_text: '', question_type: 'multiple_choice', image_url: null, audio_url: null,
    options: 'ABCD'.split('').map((l, i) => ({ option_label: l, option_text: '', image_url: null, is_correct: i === 0 ? 1 : 0 })) });
  const updOpt = (idx: number, f: string, v: any) => { if (!editQ?.options) return; const o = [...editQ.options];
    if (f === 'is_correct') o.forEach((x, i) => { x.is_correct = i === idx ? 1 : 0; }); else (o[idx] as any)[f] = v; setEditQ({ ...editQ, options: o }); };
  const upload = async (type: 'image' | 'audio', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; setUploading(type); const fd = new FormData(); fd.append('file', file);
    const r = await POST<{ url: string }>('/api/admin/upload', fd); setUploading('');
    if (r.success && r.data) { setEditQ(prev => prev ? { ...prev, [type === 'image' ? 'image_url' : 'audio_url']: r.data!.url } : null); toast('success', 'Upload berhasil'); }
    else toast('error', r.error || 'Gagal'); e.target.value = ''; };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600 font-medium flex items-center gap-1"><ChevronLeft size={14} /> Kembali</button>
        <h2 className="text-sm font-semibold text-gray-800 flex-1">Soal <span className="text-gray-400 font-normal">({questions.length})</span></h2>
        <Button size="sm" variant="secondary" onClick={() => setShowImport(true)}><Upload size={13} /> Import</Button>
        <Button size="sm" onClick={newQ}><Plus size={14} /> Tambah</Button>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div> : questions.length === 0 ? <EmptyState title="Belum ada soal" /> : (
        <div className="space-y-2">{questions.map((q, i) => (
          <div key={q.id} className="bg-white rounded-lg border border-gray-200 p-3 flex items-start gap-3">
            <span className="text-xs font-medium text-gray-400 pt-0.5 w-6 shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-700 line-clamp-2" dangerouslySetInnerHTML={{ __html: q.question_text }} />
              <div className="flex items-center gap-1.5 mt-1.5">{q.options?.map(o =>
                <span key={o.option_label} className={`text-[10px] px-1.5 py-0.5 rounded-full ${o.is_correct ? 'bg-primary-100 text-primary-700 font-semibold' : 'bg-gray-50 text-gray-400'}`}>{o.option_label}</span>)}
                {q.image_url && <Image size={12} className="text-sky-500 ml-1" />}{q.audio_url && <Volume2 size={12} className="text-violet-500 ml-1" />}</div>
            </div>
            <div className="flex gap-1"><button onClick={() => setEditQ(q)} className="text-gray-400 hover:text-primary-600 p-1"><Pencil size={13} /></button>
              <button onClick={() => setDelTarget(q.id)} className="text-gray-400 hover:text-red-500 p-1"><Trash2 size={13} /></button></div>
          </div>))}</div>
      )}
      <Modal open={!!editQ} onClose={() => setEditQ(null)} title={editQ?.id ? 'Edit Soal' : 'Tambah Soal'} size="lg">
        {editQ && <div className="space-y-3">
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Teks Soal</label>
            <RichEditor value={editQ.question_text || ''} onChange={v => setEditQ({ ...editQ, question_text: v })} minHeight={100} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Gambar</label>
              {editQ.image_url ? <div className="relative"><img src={`${API_URL}${editQ.image_url}`} alt="" className="w-full rounded-lg border max-h-28 object-cover" /><button onClick={() => setEditQ({ ...editQ, image_url: null })} className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"><X size={10} /></button></div>
              : <label className="flex items-center justify-center gap-1.5 px-3 py-3 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-400 text-xs text-gray-400">{uploading === 'image' ? <Spinner size={14} /> : <><Image size={14} /> Upload Gambar</>}<input type="file" accept="image/*" className="hidden" onChange={e => upload('image', e)} /></label>}</div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Audio</label>
              {editQ.audio_url ? <div className="relative"><audio controls className="w-full"><source src={`${API_URL}${editQ.audio_url}`} /></audio><button onClick={() => setEditQ({ ...editQ, audio_url: null })} className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"><X size={10} /></button></div>
              : <label className="flex items-center justify-center gap-1.5 px-3 py-3 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-400 text-xs text-gray-400">{uploading === 'audio' ? <Spinner size={14} /> : <><Volume2 size={14} /> Upload Audio</>}<input type="file" accept="audio/*" className="hidden" onChange={e => upload('audio', e)} /></label>}</div>
          </div>
          {editQ.question_type === 'multiple_choice' && editQ.options && <div className="space-y-2"><label className="block text-xs font-medium text-gray-500">Opsi Jawaban</label>
            {editQ.options.map((o, i) => <div key={i} className="flex items-center gap-2">
              <input type="radio" name="correct" checked={!!o.is_correct} onChange={() => updOpt(i, 'is_correct', true)} className="text-primary-600 focus:ring-primary-500" />
              <span className="text-xs font-semibold text-gray-400 w-4">{o.option_label}</span>
              <input value={o.option_text} onChange={e => updOpt(i, 'option_text', e.target.value)} placeholder={`Opsi ${o.option_label}`}
                className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" /></div>)}
            {editQ.options.length < 5 && <button onClick={() => setEditQ({ ...editQ, options: [...editQ.options!, { option_label: 'ABCDE'[editQ.options!.length], option_text: '', image_url: null, is_correct: 0 }] })} className="text-xs text-primary-600 font-medium hover:underline">+ Tambah Opsi</button>}
          </div>}
          <div className="flex gap-2 justify-end pt-2"><Button variant="secondary" size="sm" onClick={() => setEditQ(null)}>Batal</Button><Button size="sm" loading={saving} onClick={saveQ}>Simpan</Button></div>
        </div>}
      </Modal>
      <Confirm open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={delQ} title="Hapus Soal?" message="Soal yang dihapus tidak dapat dikembalikan." />
      <BulkImport type="questions" examId={examId} open={showImport} onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); fetch(); }} />
    </div>
  );
}

// ── TOKENS ───────────────────────────────────────────────────
function TokensView({ examId, onBack }: { examId: string; onBack: () => void }) {
  const { toast } = useToast(); const [tokens, setTokens] = useState<any[]>([]); const [loading, setLoading] = useState(true); const [gen, setGen] = useState(false);
  const fetch = useCallback(async () => { const r = await GET(`/api/admin/exams/${examId}/tokens`); if (r.success) setTokens(r.data || []); setLoading(false); }, [examId]);
  useEffect(() => { fetch(); }, [fetch]);
  const generate = async () => { setGen(true); const r = await POST(`/api/admin/exams/${examId}/tokens/generate`, {}); setGen(false); toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal'); fetch(); };
  return (<div className="space-y-4">
    <div className="flex items-center gap-2"><button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600 font-medium flex items-center gap-1"><ChevronLeft size={14} /> Kembali</button><h2 className="text-sm font-semibold text-gray-800 flex-1">Token</h2><Button size="sm" loading={gen} onClick={generate}><RefreshCw size={13} /> Generate</Button></div>
    {loading ? <div className="py-12 text-center"><Spinner /></div> : tokens.length === 0 ? <EmptyState title="Belum ada token" /> : (
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{tokens.map((t: any) => (
        <div key={t.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">{t.room_name}</p>
          <span className="text-xl font-mono font-bold text-primary-700 tracking-widest">{t.token_code}</span></div>))}</div>)}
  </div>);
}

// ── RESULTS ──────────────────────────────────────────────────
function ResultsView({ examId, onBack }: { examId: string; onBack: () => void }) {
  const [results, setResults] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { GET(`/api/admin/exams/${examId}/results`).then(r => { if (r.success) setResults(r.data || []); setLoading(false); }); }, [examId]);
  return (<div className="space-y-4">
    <div className="flex items-center gap-2"><button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600 font-medium flex items-center gap-1"><ChevronLeft size={14} /> Kembali</button><h2 className="text-sm font-semibold text-gray-800 flex-1">Hasil <span className="text-gray-400 font-normal">({results.length})</span></h2>
      {results.length > 0 && <Button size="sm" variant="secondary" onClick={() => exportExamResults(results, `ujian-${examId}`)}><FileDown size={13} /> Export</Button>}</div>
    {loading ? <div className="py-12 text-center"><Spinner /></div> : results.length === 0 ? <EmptyState title="Belum ada hasil" /> : (
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="bg-gray-50 text-gray-500 border-b border-gray-100"><th className="text-left px-4 py-2.5 font-medium">#</th><th className="text-left px-4 py-2.5 font-medium">Nama</th><th className="text-left px-4 py-2.5 font-medium">NISN</th><th className="text-left px-4 py-2.5 font-medium">Ruangan</th><th className="text-center px-3 py-2.5 font-medium">Benar</th><th className="text-center px-3 py-2.5 font-medium">Salah</th><th className="text-center px-3 py-2.5 font-medium">Nilai</th></tr></thead>
        <tbody>{results.map((r: any, i: number) => <tr key={i} className="border-b border-gray-50"><td className="px-4 py-2.5 text-gray-400">{i+1}</td><td className="px-4 py-2.5 font-medium text-gray-800">{r.full_name}</td><td className="px-4 py-2.5 font-mono text-gray-500">{r.nisn||'-'}</td><td className="px-4 py-2.5 text-gray-500">{r.room_name}</td><td className="text-center px-3 py-2.5 text-primary-700 font-semibold">{r.total_correct}</td><td className="text-center px-3 py-2.5 text-red-500">{r.total_wrong}</td><td className="text-center px-3 py-2.5 font-bold text-gray-900">{r.score}</td></tr>)}</tbody>
      </table></div>)}
  </div>);
}

// ── MONITOR ──────────────────────────────────────────────────
function MonitorView({ examId, onBack }: { examId: string; onBack: () => void }) {
  const [sessions, setSessions] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const fetch = useCallback(async () => { const r = await GET(`/api/admin/exams/${examId}/sessions`); if (r.success) setSessions(r.data || []); setLoading(false); }, [examId]);
  useEffect(() => { fetch(); const iv = setInterval(fetch, 10000); return () => clearInterval(iv); }, [fetch]);
  return (<div className="space-y-4">
    <div className="flex items-center gap-2"><button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600 font-medium flex items-center gap-1"><ChevronLeft size={14} /> Kembali</button><h2 className="text-sm font-semibold text-gray-800 flex-1">Monitor <span className="text-gray-400 font-normal">({sessions.length})</span></h2></div>
    {loading ? <div className="py-12 text-center"><Spinner /></div> : sessions.length === 0 ? <EmptyState title="Belum ada sesi" /> : (
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden overflow-x-auto"><table className="w-full text-xs">
        <thead><tr className="bg-gray-50 text-gray-500 border-b border-gray-100"><th className="text-left px-4 py-2.5 font-medium">Peserta</th><th className="text-left px-4 py-2.5 font-medium">Ruangan</th><th className="text-center px-3 py-2.5 font-medium">Status</th><th className="text-center px-3 py-2.5 font-medium">Pelanggaran</th></tr></thead>
        <tbody>{sessions.map((s: any) => { const on = s.status==='active'&&(Date.now()-new Date(s.last_heartbeat).getTime())<30000; const done = s.status==='submitted'||s.status==='force_submitted';
          return <tr key={s.id} className="border-b border-gray-50"><td className="px-4 py-2.5 font-medium text-gray-800">{s.full_name}</td><td className="px-4 py-2.5 text-gray-500">{s.room_name}</td>
            <td className="text-center px-3 py-2.5"><Badge color={done?'gray':on?'green':'red'}>{done?'Selesai':on?'Online':'Offline'}</Badge></td>
            <td className="text-center px-3 py-2.5">{s.cheat_warnings>0?<span className="text-red-600 font-semibold">{s.cheat_warnings}</span>:<span className="text-gray-300">0</span>}</td></tr>;})}</tbody>
      </table></div>)}
  </div>);
}

export default function AdminPage() { return <ToastProvider><AdminContent /></ToastProvider>; }
