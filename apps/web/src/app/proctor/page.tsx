'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST } from '@/lib/api';
import { LoadingScreen, EmptyState, ToastProvider, useToast, Confirm, Spinner, Modal } from '@/components/ui';
import { LogOut, Wifi, WifiOff, CheckCircle2, RefreshCw, ClipboardList, Lock, Send, Clock } from 'lucide-react';

const C = {
  bg: '#f4f6f4', white: '#fff', border: '#e0e5e0', borderLight: '#edf0ed', borderMid: '#d4dbd4',
  text: '#1e2e22', textMid: '#4a6655', textMuted: '#8a9e8d', textFaint: '#a8b9aa',
  green: '#2d7a4f', greenLight: '#e2ebe3', greenBorder: '#b5d9c4',
};

const KemenagLogo = () => (
  <img src="/kemenag.png" alt="Kemenag" width={36} height={36} style={{ objectFit: 'contain', flexShrink: 0 }} />
);

// ── Jam real-time ─────────────────────────────────────────────
function LiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Jakarta' }));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '10px', padding: '6px 14px' }}>
      <Clock size={13} color={C.green} strokeWidth={2.5} />
      <span style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 900, color: C.text, letterSpacing: '0.05em' }}>{time}</span>
    </div>
  );
}

// ── Hitung sisa waktu ─────────────────────────────────────────
function getRemainingTime(startedAt: string, durationMinutes: number): { text: string; urgent: boolean; expired: boolean } {
  const endMs = new Date(startedAt).getTime() + durationMinutes * 60 * 1000;
  const leftMs = endMs - Date.now();
  if (leftMs <= 0) return { text: 'Habis', urgent: true, expired: true };
  const m = Math.floor(leftMs / 60000);
  const s = Math.floor((leftMs % 60000) / 1000);
  return { text: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, urgent: m < 5, expired: false };
}

function ProctorContent() {
  const { user, loading: authLoading, logout } = useAuth('proctor');
  const { toast } = useToast();
  const [tokens, setTokens] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterExam, setFilterExam] = useState('all');
  const [resetTarget, setResetTarget] = useState<any>(null);
  const [unlockTarget, setUnlockTarget] = useState<any>(null);
  const [forceTarget, setForceTarget] = useState<any>(null);
  const [logTarget, setLogTarget] = useState<any>(null);
  const [cheatLogs, setCheatLogs] = useState<any[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [tick, setTick] = useState(0); // for remaining-time re-render
  const prevLockedCount = useRef(0);
  const [newLockAlert, setNewLockAlert] = useState(false);

  const fetchData = useCallback(async () => {
    const [t, s] = await Promise.all([GET('/api/proctor/token'), GET('/api/proctor/sessions')]);
    if (t.success) setTokens(t.data || []);
    if (s.success) {
      const data: any[] = s.data || [];
      setSessions(data);
      // #12: alert saat ada peserta baru dikunci
      const lockedNow = data.filter((x: any) => x.live_status === 'dikunci').length;
      if (lockedNow > prevLockedCount.current && prevLockedCount.current >= 0) setNewLockAlert(true);
      prevLockedCount.current = lockedNow;
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchData();
    const iv = setInterval(fetchData, 10000);
    return () => clearInterval(iv);
  }, [user, fetchData]);

  // tick setiap detik untuk update sisa waktu di UI
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const handleReset = async () => {
    if (!resetTarget) return;
    await POST(`/api/proctor/sessions/${resetTarget.id}/reset`);
    toast('success', `Perangkat ${resetTarget.full_name} berhasil direset`);
    setResetTarget(null); fetchData();
  };

  const handleUnlock = async () => {
    if (!unlockTarget) return;
    await POST(`/api/proctor/sessions/${unlockTarget.id}/unlock`);
    toast('success', `Sesi ${unlockTarget.full_name} berhasil dibuka`);
    setUnlockTarget(null); fetchData();
  };

  const handleForce = async () => {
    if (!forceTarget) return;
    const r = await POST(`/api/proctor/sessions/${forceTarget.id}/force-submit`);
    toast(r.success ? 'success' : 'error', r.success ? `Ujian ${forceTarget.full_name} berhasil dikumpulkan` : r.error || 'Gagal');
    setForceTarget(null); fetchData();
  };

  const openLog = async (session: any) => {
    setLogTarget(session); setCheatLogs([]); setLoadingLog(true);
    const r = await GET(`/api/proctor/sessions/${session.id}/cheat-logs`);
    if (r.success) setCheatLogs(r.data || []);
    setLoadingLog(false);
  };

  if (authLoading || loading) return <LoadingScreen />;
  if (!user) return null;

  // Filter by exam
  const filtered = filterExam === 'all' ? sessions : sessions.filter((s: any) => s.exam_id === filterExam);

  const online   = filtered.filter((s: any) => s.live_status === 'online').length;
  const finished = filtered.filter((s: any) => s.live_status === 'selesai').length;
  const locked   = filtered.filter((s: any) => s.live_status === 'dikunci').length;
  const offline  = filtered.length - online - finished - locked;

  // Unique exams from sessions
  const examOptions = Array.from(new Map(sessions.map((s: any) => [s.exam_id, s.exam_title])).entries());

  const stats = [
    { n: online,   label: 'Online',  icon: Wifi,         color: C.green,    bg: C.greenLight  },
    { n: offline,  label: 'Offline', icon: WifiOff,      color: '#dc2626',  bg: '#fef2f2'     },
    { n: locked,   label: 'Dikunci', icon: Lock,         color: '#b45309',  bg: '#fffbeb',    pulse: locked > 0 && newLockAlert },
    { n: finished, label: 'Selesai', icon: CheckCircle2, color: '#6b7c6e',  bg: '#f1f1f0'     },
  ];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="pointer-events-none fixed inset-0" style={{ backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.35, zIndex: 0 }} />

      {/* HEADER */}
      <header style={{ position: 'relative', zIndex: 2, background: C.white, borderBottom: `1.5px solid ${C.border}` }}>
        <div style={{ maxWidth: '820px', margin: '0 auto', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <KemenagLogo />
            <div>
              <p style={{ color: C.text, fontSize: '11px', fontWeight: 800, letterSpacing: '0.01em', lineHeight: 1.2 }}>MAN 1 TASIKMALAYA</p>
              <p style={{ color: '#7a9e86', fontSize: '9.5px', fontWeight: 600, fontStyle: 'italic', letterSpacing: '0.05em', marginTop: '1px' }}>Bangkit · Jaya · Juara</p>
            </div>
          </div>
          {/* #5: Jam real-time */}
          <LiveClock />
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

      <main style={{ position: 'relative', zIndex: 1, maxWidth: '820px', margin: '0 auto', padding: '20px' }} className="space-y-5">

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

        {/* #12: Alert baru dikunci */}
        {newLockAlert && locked > 0 && (
          <div style={{ background: '#7f1d1d', borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <span style={{ color: '#fff', fontSize: '13px', fontWeight: 700 }}>🔒 {locked} peserta dikunci karena pelanggaran! Periksa tabel di bawah.</span>
            <button onClick={() => setNewLockAlert(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '8px', color: '#fca5a5', fontSize: '11px', fontWeight: 700, padding: '4px 10px', cursor: 'pointer', flexShrink: 0 }}>Oke</button>
          </div>
        )}

        {/* STATS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px' }}>
          {stats.map(s => (
            <div key={s.label} style={{ background: C.white, border: `1.5px solid ${(s as any).pulse ? '#dc2626' : C.borderMid}`, borderRadius: '14px', padding: '14px', textAlign: 'center', transition: 'border-color 0.3s' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                <s.icon size={15} color={s.color} strokeWidth={2} />
              </div>
              <p style={{ color: (s as any).pulse ? '#dc2626' : C.text, fontSize: '22px', fontWeight: 900, lineHeight: 1 }}>{s.n}</p>
              <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '3px' }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* #1: Filter ujian */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', gap: '10px', flexWrap: 'wrap' }}>
            <p style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Monitoring Peserta ({filtered.length})</p>
            {examOptions.length > 1 && (
              <select value={filterExam} onChange={e => setFilterExam(e.target.value)}
                style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 12px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}>
                <option value="all">Semua Ujian</option>
                {examOptions.map(([id, title]) => <option key={id} value={id}>{title as string}</option>)}
              </select>
            )}
          </div>

          {filtered.length === 0
            ? <EmptyState title="Belum ada peserta" />
            : (
              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '640px' }}>
                  <thead>
                    <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                      {['Peserta', 'Status', 'Progres', '⚠ Langgar', 'Sisa Waktu', 'Aksi'].map((h, i) => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: i === 0 ? 'left' : 'center', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s: any, i: number) => {
                      const isOnline  = s.live_status === 'online';
                      const isDone    = s.live_status === 'selesai';
                      const isLocked  = s.live_status === 'dikunci';
                      // #4: Sisa waktu
                      const rem = (!isDone && s.started_at && s.duration_minutes)
                        ? getRemainingTime(s.started_at, s.duration_minutes)
                        : null;
                      return (
                        <tr key={s.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: isLocked ? '#fffbeb' : 'transparent' }}>
                          <td style={{ padding: '10px 14px' }}>
                            <p style={{ color: C.text, fontWeight: 700 }}>{s.full_name}</p>
                            <p style={{ color: C.textFaint, fontSize: '10px', marginTop: '1px', fontFamily: 'monospace' }}>{s.nisn}</p>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <span style={{
                              background: isDone ? '#f1f1f0' : isLocked ? '#fffbeb' : isOnline ? C.greenLight : '#fef2f2',
                              color: isDone ? '#6b7c6e' : isLocked ? '#b45309' : isOnline ? '#2d6644' : '#dc2626',
                              fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px',
                            }}>
                              {isDone ? 'Selesai' : isLocked ? '🔒 Dikunci' : isOnline ? 'Online' : 'Offline'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', color: C.textMuted, fontFamily: 'monospace', fontWeight: 600 }}>{s.answered_count}/{s.total_questions}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: s.cheat_warnings > 0 ? 700 : 400, color: s.cheat_warnings > 0 ? '#dc2626' : C.textFaint }}>{s.cheat_warnings}</td>
                          {/* #4: Sisa waktu */}
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontFamily: 'monospace', fontSize: '11.5px', fontWeight: 700, color: isDone ? C.textFaint : rem?.urgent ? '#dc2626' : C.textMid }}>
                            {isDone ? '—' : rem ? rem.text : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexWrap: 'wrap' }}>
                              {/* Log pelanggaran */}
                              <button onClick={() => openLog(s)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#1a5fa8', fontSize: '11px', fontWeight: 700, background: '#e0f0ff', border: '1.5px solid #bfdbfe', borderRadius: '8px', padding: '4px 8px', cursor: 'pointer' }}
                                title="Lihat log pelanggaran">
                                <ClipboardList size={11} strokeWidth={2.5} />
                                {s.cheat_warnings > 0 ? s.cheat_warnings : ''}
                              </button>
                              {/* #7: Konfirmasi unlock */}
                              {isLocked && (
                                <button onClick={() => setUnlockTarget(s)} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#b45309', fontSize: '11px', fontWeight: 700, background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '8px', padding: '4px 10px', cursor: 'pointer' }}>
                                  Buka Kunci
                                </button>
                              )}
                              {/* #10: Force submit */}
                              {!isDone && (
                                <button onClick={() => setForceTarget(s)} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#dc2626', fontSize: '11px', fontWeight: 700, background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '8px', padding: '4px 8px', cursor: 'pointer' }}
                                  title="Paksa kumpulkan ujian">
                                  <Send size={10} strokeWidth={2.5} />
                                </button>
                              )}
                              {/* #2: Rename Reset → Ganti Perangkat */}
                              {!isDone && !isLocked && (
                                <button onClick={() => setResetTarget(s)} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: C.green, fontSize: '11px', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}
                                  title="Reset jika peserta ganti perangkat">
                                  <RefreshCw size={11} strokeWidth={2.5} />
                                </button>
                              )}
                            </div>
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

      {/* #2: Confirm Ganti Perangkat */}
      <Confirm open={!!resetTarget} onClose={() => setResetTarget(null)} onConfirm={handleReset}
        title="Ganti Perangkat?" danger={false} confirmText="Ya, Reset"
        message={`Reset device lock untuk ${resetTarget?.full_name}? Lakukan ini hanya jika peserta berganti perangkat.`} />

      {/* #7: Confirm Buka Kunci */}
      <Confirm open={!!unlockTarget} onClose={() => setUnlockTarget(null)} onConfirm={handleUnlock}
        title="Buka Kunci Sesi?" danger={false} confirmText="Ya, Buka"
        message={`Buka kunci sesi ${unlockTarget?.full_name}? (${unlockTarget?.cheat_warnings || 0}x pelanggaran) — Pelanggaran direset ke 0.`} />

      {/* #10: Confirm Force Submit */}
      <Confirm open={!!forceTarget} onClose={() => setForceTarget(null)} onConfirm={handleForce}
        title="Paksa Kumpulkan Ujian?" danger confirmText="Ya, Kumpulkan"
        message={`Paksa kumpulkan ujian ${forceTarget?.full_name}? Jawaban yang sudah diisi akan disimpan. Tindakan ini tidak dapat dibatalkan.`} />

      {/* Modal log pelanggaran */}
      <Modal open={!!logTarget} onClose={() => setLogTarget(null)} title={`Log Pelanggaran — ${logTarget?.full_name || ''}`}>
        {loadingLog ? (
          <div style={{ padding: '24px', textAlign: 'center' }}><Spinner size={20} /></div>
        ) : cheatLogs.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: C.textFaint, fontSize: '13px' }}>
            ✅ Tidak ada pelanggaran tercatat untuk peserta ini.
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px' }}>
                {cheatLogs.length}x pelanggaran
              </span>
            </div>
            <div style={{ border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                    {['No', 'Jenis Pelanggaran', 'Waktu (WIB)'].map((h, i) => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: i === 0 ? 'center' : 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cheatLogs.map((log: any, i: number) => {
                    const dt = new Date(log.happened_at);
                    const timeStr = isNaN(dt.getTime()) ? log.happened_at
                      : dt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    return (
                      <tr key={i} style={{ borderBottom: i < cheatLogs.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                        <td style={{ padding: '9px 12px', textAlign: 'center', color: '#dc2626', fontWeight: 800, fontSize: '13px' }}>{log.no}</td>
                        <td style={{ padding: '9px 12px', color: C.text, fontWeight: 600 }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                            background: log.violation_type === 'fullscreen_exit' ? '#fffbeb' : '#fef2f2',
                            color: log.violation_type === 'fullscreen_exit' ? '#b45309' : '#dc2626',
                            fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px'
                          }}>
                            {log.violation_type === 'fullscreen_exit' ? '🖥' : '🔀'} {log.violation_label}
                          </span>
                        </td>
                        <td style={{ padding: '9px 12px', color: C.textMuted, fontFamily: 'monospace', fontSize: '11.5px' }}>{timeStr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function ProctorPage() { return <ToastProvider><ProctorContent /></ToastProvider>; }
