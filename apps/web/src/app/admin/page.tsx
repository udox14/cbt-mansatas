'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET } from '@/lib/api';
import { Modal, Button, LoadingScreen, ToastProvider } from '@/components/ui';
import {
  ClipboardList, Users, School, Shield, LogOut, Menu, Layers, Settings,
} from 'lucide-react';
import { Page, CbtEvent } from '@/features/exam-engine/types';
import { C } from '@/features/exam-engine/components/theme';
import { KemenagLogo } from '@/features/exam-engine/components/KemenagLogo';
import { TanggalHari } from '@/features/exam-engine/components/TanggalHari';

// Feature Views
import { ExamsPage } from '@/features/exam-engine/exams/ExamsPage';
import { KegiatanPage } from '@/features/platform/events/EventManagementPage';
import { PesertaPage } from '@/features/platform/participants/PesertaPage';
import { RoomsPage } from '@/features/exam-engine/rooms/RoomsPage';
import { PelaksanaPage } from '@/features/platform/staff/PelaksanaPage';
import { SettingsPage } from '@/features/platform/settings/SettingsPage';

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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={C.textMuted} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
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

export default function AdminPage() {
  return (
    <ToastProvider>
      <AdminContent />
    </ToastProvider>
  );
}
