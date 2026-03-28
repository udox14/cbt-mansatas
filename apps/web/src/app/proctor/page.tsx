'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST } from '@/lib/api';
import { LoadingScreen, EmptyState, ToastProvider, useToast, Confirm, Spinner } from '@/components/ui';
import { LogOut, Wifi, WifiOff, CheckCircle2, RefreshCw } from 'lucide-react';

const C = {
  bg: '#f4f6f4', white: '#fff', border: '#e0e5e0', borderLight: '#edf0ed', borderMid: '#d4dbd4',
  text: '#1e2e22', textMid: '#4a6655', textMuted: '#8a9e8d', textFaint: '#a8b9aa',
  green: '#2d7a4f', greenLight: '#e2ebe3', greenBorder: '#b5d9c4',
};

const KemenagLogo = () => (
  <img src="/kemenag.png" alt="Kemenag" width={36} height={36} style={{ objectFit: 'contain', flexShrink: 0 }} />
);

function ProctorContent() {
  const { user, loading: authLoading, logout } = useAuth('proctor');
  const { toast } = useToast();
  const [tokens, setTokens] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState<any>(null);

  const fetchData = useCallback(async () => {
    const [t, s] = await Promise.all([GET('/api/proctor/token'), GET('/api/proctor/sessions')]);
    if (t.success) setTokens(t.data || []);
    if (s.success) setSessions(s.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchData();
    const iv = setInterval(fetchData, 10000);
    return () => clearInterval(iv);
  }, [user, fetchData]);

  const handleReset = async () => {
    if (!resetTarget) return;
    await POST(`/api/proctor/sessions/${resetTarget.id}/reset`);
    toast('success', 'Sesi berhasil direset');
    setResetTarget(null);
    fetchData();
  };

  const handleUnlock = async (session: any) => {
    await POST(`/api/proctor/sessions/${session.id}/unlock`);
    toast('success', `Sesi ${session.full_name} berhasil dibuka`);
    fetchData();
  };

  if (authLoading || loading) return <LoadingScreen />;
  if (!user) return null;

  const online   = sessions.filter((s: any) => s.live_status === 'online').length;
  const finished = sessions.filter((s: any) => s.live_status === 'selesai').length;
  const offline  = sessions.length - online - finished;

  const locked  = sessions.filter((s: any) => s.live_status === 'dikunci').length;

  const stats = [
    { n: online,   label: 'Online',  icon: Wifi,         color: C.green,    bg: C.greenLight  },
    { n: offline,  label: 'Offline', icon: WifiOff,      color: '#dc2626',  bg: '#fef2f2'     },
    { n: locked,   label: 'Dikunci', icon: CheckCircle2, color: '#b45309',  bg: '#fffbeb'     },
    { n: finished, label: 'Selesai', icon: CheckCircle2, color: '#6b7c6e',  bg: '#f1f1f0'     },
  ];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>

      {/* dot texture */}
      <div className="pointer-events-none fixed inset-0" style={{ backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.35, zIndex: 0 }} />

      {/* HEADER */}
      <header style={{ position: 'relative', zIndex: 2, background: C.white, borderBottom: `1.5px solid ${C.border}` }}>
        <div style={{ maxWidth: '720px', margin: '0 auto', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <KemenagLogo />
            <div>
              <p style={{ color: C.text, fontSize: '11px', fontWeight: 800, letterSpacing: '0.01em', lineHeight: 1.2 }}>MAN 1 TASIKMALAYA</p>
              <p style={{ color: '#7a9e86', fontSize: '9.5px', fontWeight: 600, fontStyle: 'italic', letterSpacing: '0.05em', marginTop: '1px' }}>Bangkit · Maju · Juara</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ color: C.text, fontSize: '13px', fontWeight: 700, lineHeight: 1.2 }}>{user.full_name}</p>
              <p style={{ color: C.textMuted, fontSize: '11px' }}>Pengawas Ruangan</p>
            </div>
            <button onClick={logout} style={{ width: '34px', height: '34px', borderRadius: '10px', background: '#fef2f2', border: '1.5px solid #fecaca', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              <LogOut size={15} color="#dc2626" strokeWidth={2} />
            </button>
          </div>
        </div>
      </header>

      <main style={{ position: 'relative', zIndex: 1, maxWidth: '720px', margin: '0 auto', padding: '20px' }} className="space-y-5">

        {/* TOKEN */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <p style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Token Aktif</p>
            <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px' }}>Auto-refresh 10s</span>
          </div>
          {tokens.length === 0
            ? <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '20px', textAlign: 'center', color: C.textFaint, fontSize: '13px' }}>Belum ada ujian aktif</div>
            : (
              <div className="space-y-2">
                {tokens.map((t: any) => (
                  <div key={t.id} style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div>
                      <p style={{ color: C.text, fontSize: '13px', fontWeight: 700 }}>{t.exam_title}</p>
                      <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '2px' }}>{t.room_name}</p>
                    </div>
                    <span style={{ color: C.green, fontSize: '28px', fontWeight: 900, letterSpacing: '0.22em', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>{t.token_code}</span>
                  </div>
                ))}
              </div>
            )}
        </section>

        {/* STATS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px' }}>
          {stats.map(s => (
            <div key={s.label} style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                <s.icon size={15} color={s.color} strokeWidth={2} />
              </div>
              <p style={{ color: C.text, fontSize: '22px', fontWeight: 900, lineHeight: 1 }}>{s.n}</p>
              <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '3px' }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* SESSIONS TABLE */}
        <section>
          <p style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '10px' }}>Monitoring Peserta</p>
          {sessions.length === 0
            ? <EmptyState title="Belum ada peserta" />
            : (
              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                      {['Peserta', 'Status', 'Progres', 'Pelanggaran', 'Aksi'].map((h, i) => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: i === 0 ? 'left' : 'center', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s: any, i: number) => {
                      const isOnline  = s.live_status === 'online';
                      const isDone    = s.live_status === 'selesai';
                      const isOffline = !isOnline && !isDone;
                      return (
                        <tr key={s.id} style={{ borderBottom: i < sessions.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                          <td style={{ padding: '10px 14px' }}>
                            <p style={{ color: C.text, fontWeight: 700 }}>{s.full_name}</p>
                            <p style={{ color: C.textFaint, fontSize: '10px', marginTop: '1px', fontFamily: 'monospace' }}>{s.nisn}</p>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <span style={{
                              background: isDone ? '#f1f1f0' : isOnline ? C.greenLight : '#fef2f2',
                              color: isDone ? '#6b7c6e' : isOnline ? '#2d6644' : '#dc2626',
                              fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px',
                            }}>
                              {isDone ? 'Selesai' : isOnline ? 'Online' : 'Offline'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', color: C.textMuted, fontFamily: 'monospace', fontWeight: 600 }}>{s.answered_count}/{s.total_questions}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: s.cheat_warnings > 0 ? 700 : 400, color: s.cheat_warnings > 0 ? '#dc2626' : C.textFaint }}>{s.cheat_warnings}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            {!isDone && (
                              <button onClick={() => setResetTarget(s)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: C.green, fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                                <RefreshCw size={11} strokeWidth={2.5} /> Reset
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </section>
      </main>

      <footer style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: '16px', color: '#a8b3a8', fontSize: '11px', fontWeight: 500 }}>
        © 2026 MAN 1 Tasikmalaya — DRUDOX
      </footer>

      <Confirm open={!!resetTarget} onClose={() => setResetTarget(null)} onConfirm={handleReset}
        title="Reset Sesi?" danger={false} confirmText="Reset"
        message={`Reset device lock untuk ${resetTarget?.full_name}?`} />
    </div>
  );
}

export default function ProctorPage() { return <ToastProvider><ProctorContent /></ToastProvider>; }
