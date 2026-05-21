'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST } from '@/lib/api';
import { LoadingScreen, EmptyState, ToastProvider, useToast, Confirm, Spinner, Modal } from '@/components/ui';
import { LogOut, Wifi, WifiOff, CheckCircle2, RefreshCw, ClipboardList, Lock, Send, Clock, Search } from 'lucide-react';

const C = {
  bg: '#f4f6f4', white: '#fff', border: '#e0e5e0', borderLight: '#edf0ed', borderMid: '#d4dbd4',
  text: '#1e2e22', textMid: '#4a6655', textMuted: '#8a9e8d', textFaint: '#a8b9aa',
  green: '#2d7a4f', greenLight: '#e2ebe3', greenBorder: '#b5d9c4',
};

const KemenagLogo = () => (
  <img src="/kemenag.png" alt="Kemenag" width={36} height={36} style={{ objectFit: 'contain', flexShrink: 0 }} />
);

const SIMULATION_SESSION_KEY = '__simulasi__';

const parseServerTime = (value: string) => {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : Date.now();
};

const formatDateShort = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
};

const getSessionKey = (row: any) => {
  const tanggal = String(row?.tanggal_tes || '').trim();
  const sesi = String(row?.sesi_tes || '').trim();
  return tanggal || sesi ? `${tanggal}||${sesi}` : SIMULATION_SESSION_KEY;
};

const getSessionLabel = (row: any) => {
  const tanggal = String(row?.tanggal_tes || '').trim();
  const sesi = String(row?.sesi_tes || '').trim();
  if (!tanggal && !sesi) return 'Tanpa Sesi / Simulasi';
  const prefix = tanggal ? `${formatDateShort(tanggal)} - ` : '';
  return `${prefix}${sesi || 'Tanpa Sesi'}`;
};

const buildSessionOptions = (sessions: any[], tokens: any[]) => {
  const map = new Map<string, { key: string; label: string; active: boolean; simulation: boolean }>();
  const add = (row: any) => {
    const key = getSessionKey(row);
    const existing = map.get(key);
    const option = {
      key,
      label: getSessionLabel(row),
      active: row?.jadwal_status === 'aktif',
      simulation: key === SIMULATION_SESSION_KEY,
    };
    map.set(key, existing ? { ...existing, active: existing.active || option.active } : option);
  };
  tokens.forEach(add);
  sessions.forEach(add);
  return Array.from(map.values()).sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.simulation !== b.simulation) return a.simulation ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
};

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
  const endMs = parseServerTime(startedAt) + durationMinutes * 60 * 1000;
  const leftMs = endMs - Date.now();
  if (leftMs <= 0) return { text: 'Habis', urgent: true, expired: true };
  const m = Math.floor(leftMs / 60000);
  const s = Math.floor((leftMs % 60000) / 1000);
  return { text: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`, urgent: m < 5, expired: false };
}

function describeDevice(userAgent?: string | null, deviceId?: string | null) {
  if (!userAgent) {
    return deviceId ? { label: 'Perangkat dikenal', detail: deviceId } : { label: 'Belum login', detail: '' };
  }
  const ua = userAgent;
  const lower = ua.toLowerCase();
  const os = /iphone|ipad|ipod/.test(lower)
    ? 'iOS'
    : /android/.test(lower)
      ? 'Android'
      : /windows/.test(lower)
        ? 'Windows'
        : /mac os x|macintosh/.test(lower)
          ? 'macOS'
          : /linux/.test(lower)
            ? 'Linux'
            : 'OS tidak dikenal';

  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /opr\//i.test(ua)
      ? 'Opera'
      : /firefox\//i.test(ua)
        ? 'Firefox'
        : /crios\//i.test(ua)
          ? 'Chrome iOS'
          : /chrome\//i.test(ua)
            ? 'Chrome'
            : /safari\//i.test(ua)
              ? 'Safari'
              : 'Browser tidak dikenal';

  const brand = /iphone/i.test(ua)
    ? 'iPhone'
    : /ipad/i.test(ua)
      ? 'iPad'
      : /samsung|sm-/i.test(ua)
        ? 'Samsung'
        : /redmi|xiaomi|mi\s|poco/i.test(ua)
          ? 'Xiaomi'
          : /oppo/i.test(ua)
            ? 'OPPO'
            : /vivo/i.test(ua)
              ? 'vivo'
              : /huawei/i.test(ua)
                ? 'Huawei'
                : /android/i.test(ua)
                  ? 'Android'
                  : /windows/i.test(ua)
                    ? 'PC'
                    : /macintosh|mac os x/i.test(ua)
                      ? 'Mac'
                      : 'Perangkat';

  return { label: `${brand} / ${browser}`, detail: os };
}

function ProctorContent() {
  const { user, loading: authLoading, logout } = useAuth('proctor');
  const { toast } = useToast();
  const [tokens, setTokens] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterExam, setFilterExam] = useState('all');
  const [filterSession, setFilterSession] = useState('');
  const [filterStart, setFilterStart] = useState<'all' | 'started' | 'not_started'>('all');
  const [filterFinished, setFilterFinished] = useState<'all' | 'hide_finished' | 'finished_only'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [resetTarget, setResetTarget] = useState<any>(null);
  const [unlockTarget, setUnlockTarget] = useState<any>(null);
  const [forceTarget, setForceTarget] = useState<any>(null);
  const [logTarget, setLogTarget] = useState<any>(null);
  const [cheatLogs, setCheatLogs] = useState<any[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);
  const [tick, setTick] = useState(0); // for remaining-time re-render
  const prevLockedCount = useRef(0);
  const sessionFilterTouchedRef = useRef(false);
  const [newLockAlert, setNewLockAlert] = useState(false);

  const fetchData = useCallback(async () => {
    const [t, s] = await Promise.all([GET('/api/proctor/token'), GET('/api/proctor/sessions')]);
    const activeTokens = t.success ? (t.data || []) : null;
    if (t.success) setTokens(activeTokens || []);
    if (s.success) {
      const activeExamIds = activeTokens ? new Set(activeTokens.map((token: any) => token.exam_id)) : null;
      const data: any[] = (s.data || []).filter((row: any) => !activeExamIds || activeExamIds.has(row.exam_id));
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

  const sessionsForExam = useMemo(
    () => filterExam === 'all' ? sessions : sessions.filter((s: any) => s.exam_id === filterExam),
    [sessions, filterExam]
  );

  const tokensForExam = useMemo(
    () => filterExam === 'all' ? tokens : tokens.filter((t: any) => t.exam_id === filterExam),
    [tokens, filterExam]
  );

  const sessionOptions = useMemo(
    () => buildSessionOptions(sessionsForExam, tokensForExam),
    [sessionsForExam, tokensForExam]
  );

  const effectiveFilterSession = filterSession
    || sessionOptions.find(option => option.active)?.key
    || sessionOptions[0]?.key
    || '';

  useEffect(() => {
    if (!sessionOptions.length) {
      if (filterSession) setFilterSession('');
      return;
    }

    const selectedExists = sessionOptions.some(option => option.key === filterSession);
    if (sessionFilterTouchedRef.current && selectedExists) return;

    const nextSession = sessionOptions.find(option => option.active)?.key || sessionOptions[0].key;
    if (filterSession !== nextSession) setFilterSession(nextSession);
  }, [sessionOptions, filterSession]);

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

  const visibleTokens = effectiveFilterSession
    ? tokensForExam.filter((t: any) => getSessionKey(t) === effectiveFilterSession)
    : [];

  // Filter pipeline: ujian aktif -> sesi tes -> status mulai -> selesai -> search.
  const filteredBySession = effectiveFilterSession
    ? sessionsForExam.filter((s: any) => getSessionKey(s) === effectiveFilterSession)
    : [];
  const filtered = filteredBySession.filter((s: any) => {
    if (filterStart === 'started' && !s.has_started) return false;
    if (filterStart === 'not_started' && s.has_started) return false;
    if (filterFinished === 'hide_finished' && s.live_status === 'selesai') return false;
    if (filterFinished === 'finished_only' && s.live_status !== 'selesai') return false;
    const q = searchTerm.trim().toLowerCase();
    if (q) {
      const haystack = [
        s.full_name,
        s.nisn,
        s.username,
        s.exam_title,
        s.live_status,
        s.sesi_tes,
        s.tanggal_tes,
        s.device_id,
        s.user_agent,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const online   = filtered.filter((s: any) => s.live_status === 'online').length;
  const finished = filtered.filter((s: any) => s.live_status === 'selesai').length;
  const locked   = filtered.filter((s: any) => s.live_status === 'dikunci').length;
  const notStarted = filtered.filter((s: any) => s.live_status === 'belum_mulai').length;
  const offline  = filtered.length - online - finished - locked - notStarted;

  // Unique exams from sessions
  const examOptions = Array.from(new Map(sessions.map((s: any) => [s.exam_id, s.exam_title])).entries());

  const stats = [
    { n: online,   label: 'Online',  icon: Wifi,         color: C.green,    bg: C.greenLight  },
    { n: offline,  label: 'Offline', icon: WifiOff,      color: '#dc2626',  bg: '#fef2f2'     },
    { n: notStarted, label: 'Belum Mulai', icon: Clock,  color: C.textMuted, bg: '#f1f1f0'     },
    { n: locked,   label: 'Dikunci', icon: Lock,         color: '#b45309',  bg: '#fffbeb',    pulse: locked > 0 && newLockAlert },
    { n: finished, label: 'Selesai', icon: CheckCircle2, color: '#6b7c6e',  bg: '#f1f1f0'     },
  ];

  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <div className="pointer-events-none fixed inset-0" style={{ backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.35, zIndex: 0 }} />

      {/* HEADER */}
      <header style={{ position: 'relative', zIndex: 2, background: C.white, borderBottom: `1.5px solid ${C.border}` }}>
        <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
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

      <main style={{ position: 'relative', zIndex: 1, maxWidth: '1180px', margin: '0 auto', padding: '22px 24px' }} className="space-y-5">

        {/* TOKEN */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <p style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Token Aktif</p>
            <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px' }}>Auto-refresh 10s</span>
          </div>
          {visibleTokens.length === 0
            ? <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '20px', textAlign: 'center', color: C.textFaint, fontSize: '13px' }}>Belum ada ujian aktif</div>
            : (
              <div className="space-y-2">
                {visibleTokens.map((t: any) => (
                  <div key={t.id} style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div>
                      <p style={{ color: C.text, fontSize: '13px', fontWeight: 700 }}>{t.exam_title}</p>
                      <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '2px' }}>{t.room_name}</p>
                      {(t.tanggal_tes || t.sesi_tes) && (
                        <p style={{ color: C.textFaint, fontSize: '10.5px', marginTop: '2px' }}>
                          {t.tanggal_tes || 'Tanpa tanggal'} · {t.sesi_tes || 'Tanpa sesi'}
                          {t.jadwal_status === 'aktif' ? ' · sedang berjalan' : ''}
                        </p>
                      )}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(112px,1fr))', gap: '10px' }}>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', minWidth: '280px', flex: '1 1 320px', maxWidth: '420px' }}>
                <Search size={13} color={C.textFaint} strokeWidth={2.5} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <input
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Cari nama, NISN, atau device..."
                  style={{ width: '100%', fontSize: '11.5px', fontWeight: 600, padding: '6px 12px 6px 30px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, outline: 'none' }}
                />
              </div>
              <select value={filterStart} onChange={e => setFilterStart(e.target.value as any)}
                style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 12px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}>
                <option value="all">Semua Status</option>
                <option value="started">Sudah Mulai</option>
                <option value="not_started">Belum Mulai</option>
              </select>
              <select value={filterFinished} onChange={e => setFilterFinished(e.target.value as any)}
                style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 12px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}>
                <option value="all">Tampilkan Selesai</option>
                <option value="hide_finished">Sembunyikan Selesai</option>
                <option value="finished_only">Hanya Selesai</option>
              </select>
              {sessionOptions.length > 0 && (
                <select
                  value={effectiveFilterSession}
                  onChange={e => {
                    sessionFilterTouchedRef.current = true;
                    setFilterSession(e.target.value);
                  }}
                  style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 12px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}
                >
                  {sessionOptions.map(option => (
                    <option key={option.key} value={option.key}>
                      {option.active ? `Sesi sedang berjalan - ${option.label}` : option.label}
                    </option>
                  ))}
                </select>
              )}
              {examOptions.length > 1 && (
                <select value={filterExam} onChange={e => {
                  sessionFilterTouchedRef.current = false;
                  setFilterExam(e.target.value);
                }}
                  style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 12px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}>
                  <option value="all">Semua Ujian</option>
                  {examOptions.map(([id, title]) => <option key={id} value={id}>{title as string}</option>)}
                </select>
              )}
            </div>
          </div>

          {filtered.length === 0
            ? <EmptyState title="Belum ada peserta" />
            : (
              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '980px' }}>
                  <thead>
                    <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                      {['Peserta', 'Device', 'Status', 'Progres', 'Langgar', 'Sisa Waktu', 'Aksi'].map((h, i) => (
                        <th key={h} style={{ padding: '9px 14px', textAlign: i === 0 ? 'left' : 'center', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s: any, i: number) => {
                      const hasStarted = !!s.has_started;
                      const isOnline  = s.live_status === 'online';
                      const isDone    = s.live_status === 'selesai';
                      const isLocked  = s.live_status === 'dikunci';
                      const isNotStarted = s.live_status === 'belum_mulai';
                      // #4: Sisa waktu
                      const rem = (!isDone && s.started_at && s.duration_minutes)
                        ? getRemainingTime(s.started_at, s.duration_minutes)
                        : null;
                      const violationTotal = Number(s.cheat_log_count || s.cheat_warnings || 0);
                      const device = describeDevice(s.user_agent, s.device_id);
                      return (
                        <tr key={s.id || `${s.exam_id}-${s.user_type}-${s.user_id}`} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C.borderLight}` : 'none', background: isLocked ? '#fffbeb' : isNotStarted ? '#f7f8f7' : 'transparent' }}>
                          <td style={{ padding: '10px 14px' }}>
                            <p style={{ color: isNotStarted ? C.textMuted : C.text, fontWeight: 700 }}>{s.full_name}</p>
                            <p style={{ color: C.textFaint, fontSize: '10px', marginTop: '1px', fontFamily: 'monospace' }}>{s.nisn}</p>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', maxWidth: '210px' }}>
                            {s.device_id || s.user_agent
                              ? <span title={[device.label, device.detail, s.device_id, s.user_agent].filter(Boolean).join(' | ')} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', maxWidth: '190px', color: '#1a5fa8', background: '#e0f0ff', border: '1.5px solid #bfdbfe', borderRadius: '8px', padding: '4px 8px', fontSize: '10.5px', fontWeight: 800 }}>
                                <span style={{ maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.label}</span>
                                {device.detail && <span style={{ color: '#6b7c6e', fontSize: '9.5px', fontWeight: 700, marginTop: '1px' }}>{device.detail}</span>}
                              </span>
                              : <span style={{ color: C.textFaint, fontSize: '11px', fontWeight: 700 }}>Belum login</span>}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <span style={{
                              background: isNotStarted ? '#f1f1f0' : isDone ? '#f1f1f0' : isLocked ? '#fffbeb' : isOnline ? C.greenLight : '#fef2f2',
                              color: isNotStarted ? C.textMuted : isDone ? '#6b7c6e' : isLocked ? '#b45309' : isOnline ? '#2d6644' : '#dc2626',
                              fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px',
                            }}>
                              {isNotStarted ? 'Belum Mulai' : isDone ? 'Selesai' : isLocked ? '🔒 Dikunci' : isOnline ? 'Online' : 'Offline'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', color: C.textMuted, fontFamily: 'monospace', fontWeight: 600 }}>{s.answered_count}/{s.total_questions}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: violationTotal > 0 ? 700 : 400, color: violationTotal > 0 ? '#dc2626' : C.textFaint }}>{violationTotal}</td>
                          {/* #4: Sisa waktu */}
                          <td style={{ padding: '10px 14px', textAlign: 'center', fontFamily: 'monospace', fontSize: '11.5px', fontWeight: 700, color: isDone ? C.textFaint : rem?.urgent ? '#dc2626' : C.textMid }}>
                            {isDone ? '—' : rem ? rem.text : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexWrap: 'wrap' }}>
                              {/* Log pelanggaran */}
                              <button onClick={() => hasStarted && openLog(s)} disabled={!hasStarted}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: hasStarted ? '#1a5fa8' : C.textFaint, fontSize: '11px', fontWeight: 700, background: hasStarted ? '#e0f0ff' : '#f1f1f0', border: `1.5px solid ${hasStarted ? '#bfdbfe' : C.borderLight}`, borderRadius: '8px', padding: '4px 8px', cursor: hasStarted ? 'pointer' : 'not-allowed' }}
                                title="Lihat log pelanggaran">
                                <ClipboardList size={11} strokeWidth={2.5} />
                                {violationTotal > 0 ? violationTotal : ''}
                              </button>
                              {/* #7: Konfirmasi unlock */}
                              {isLocked && (
                                <button onClick={() => setUnlockTarget(s)} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#b45309', fontSize: '11px', fontWeight: 700, background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '8px', padding: '4px 10px', cursor: 'pointer' }}>
                                  Buka Kunci
                                </button>
                              )}
                              {/* #10: Force submit */}
                              {hasStarted && !isDone && (
                                <button onClick={() => setForceTarget(s)} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: '#dc2626', fontSize: '11px', fontWeight: 700, background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '8px', padding: '4px 8px', cursor: 'pointer' }}
                                  title="Paksa kumpulkan ujian">
                                  <Send size={10} strokeWidth={2.5} />
                                </button>
                              )}
                              {/* #2: Rename Reset → Ganti Perangkat */}
                              {hasStarted && !isDone && !isLocked && (
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
        message={`Buka kunci sesi ${unlockTarget?.full_name}? (${unlockTarget?.cheat_log_count || unlockTarget?.cheat_warnings || 0}x total pelanggaran) — Counter kunci aktif direset ke 0.`} />

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
