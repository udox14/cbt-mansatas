'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST } from '@/lib/api';
import { getDeviceId } from '@/lib/device';
import { Button, Modal, LoadingScreen, EmptyState, ToastProvider } from '@/components/ui';
import ExamRoom from '@/components/exam/ExamRoom';
import { Clock, ArrowRight, Check, KeyRound, CalendarClock, Lock } from 'lucide-react';
import DOMPurify from 'dompurify';

interface Exam {
  id: string; title: string; description: string | null;
  duration_minutes: number; rules_text: string | null;
  session_id: string | null; session_status: string | null;
  jadwal_status?: 'aktif' | 'belum' | 'selesai' | 'no_schedule';
  jadwal_info?: string | null;
  is_time_locked?: number;
}

const KemenagLogo = () => (
  <img src="/kemenag.png" alt="Kemenag" width={36} height={36} style={{ objectFit: 'contain', flexShrink: 0 }} />
);

const BadgeStatus = ({ status }: { status: string | null }) => {
  if (status === 'submitted' || status === 'force_submitted')
    return <span style={{ background: '#e2ebe3', color: '#2d6644', fontSize: '10px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px', whiteSpace: 'nowrap' }}>Selesai</span>;
  if (status === 'active')
    return <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px', whiteSpace: 'nowrap' }}>Berlangsung</span>;
  return <span style={{ background: '#f1f1f0', color: '#6b7c6e', fontSize: '10px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px', whiteSpace: 'nowrap' }}>Belum Mulai</span>;
};

const ActionBtn = ({ label, variant, onClick, disabled }: { label: string; variant: 'primary' | 'resume'; onClick: () => void; disabled?: boolean }) => (
  <button onClick={onClick} disabled={disabled}
    style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
      width: '88px', height: '34px', fontSize: '12px', fontWeight: 700,
      borderRadius: '10px', border: variant === 'resume' ? '1.5px solid #b5d9c4' : 'none', cursor: disabled ? 'not-allowed' : 'pointer',
      background: disabled ? '#e8ebe8' : variant === 'primary' ? '#2d7a4f' : '#e2ebe3',
      color: disabled ? '#a8b9aa' : variant === 'primary' ? '#fff' : '#2d7a4f',
      flexShrink: 0, opacity: disabled ? 0.7 : 1,
    }}>
    {disabled ? <Lock size={12} strokeWidth={2.5} /> : null}
    {label}
    {!disabled && variant === 'primary' && <ArrowRight size={12} strokeWidth={2.5} />}
  </button>
);

const JadwalInfo = ({ exam }: { exam: Exam }) => {
  if (!exam.jadwal_info) return null;
  const js = exam.jadwal_status;
  const color = js === 'aktif' ? '#2d7a4f' : js === 'belum' ? '#b45309' : '#dc2626';
  const bg = js === 'aktif' ? '#e2ebe3' : js === 'belum' ? '#fffbeb' : '#fef2f2';
  const statusLabel = js === 'aktif' ? 'Sedang berlangsung' : js === 'belum' ? 'Belum dimulai' : 'Waktu habis';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: bg, color, fontSize: '10.5px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px' }}>
        <CalendarClock size={11} strokeWidth={2.5} /> {statusLabel}
      </div>
      <span style={{ color: '#8a9e8d', fontSize: '10.5px' }}>{exam.jadwal_info}</span>
    </div>
  );
};

function StudentContent() {
  const { user, loading: authLoading, logout } = useAuth('student');
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Exam | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [tokenLoading, setTokenLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<{ sessionId: string; startedAt: string; durationMinutes: number } | null>(null);
  const [postExam, setPostExam] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    GET<Exam[]>('/api/student/exams').then(r => { if (r.success) setExams(r.data || []); setLoading(false); });
  }, [user]);

  if (authLoading || loading) return <LoadingScreen />;
  if (!user) return null;

  if (activeSession) return (
    <ExamRoom sessionId={activeSession.sessionId} startedAt={activeSession.startedAt}
      durationMinutes={activeSession.durationMinutes}
      onFinish={r => { setActiveSession(null); setPostExam(r); }} />
  );

  if (postExam) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#f4f6f4' }}>
      <div className="w-full max-w-sm text-center" style={{ background: '#fff', border: '1.5px solid #d4dbd4', borderRadius: '20px', padding: '36px 24px' }}>
        <div className="mx-auto mb-5 flex items-center justify-center rounded-full"
          style={{ width: '56px', height: '56px', background: '#e2ebe3' }}>
          <Check size={24} color="#2d7a4f" strokeWidth={2.5} />
        </div>
        <h2 className="font-black mb-2" style={{ color: '#1e2e22', fontSize: '20px' }}>Ujian Selesai!</h2>
        <p className="mb-5" style={{ color: '#8a9e8d', fontSize: '13px' }}>{postExam.completion_message || 'Terima kasih.'}</p>
        {postExam.score_visible && (
          <div className="rounded-xl p-5 mb-5" style={{ background: '#f4f6f4' }}>
            <div className="font-black" style={{ color: '#2d7a4f', fontSize: '36px' }}>{postExam.score ?? 0}</div>
            <p style={{ color: '#8a9e8d', fontSize: '11px', marginTop: '4px' }}>Nilai Anda</p>
            <div className="grid grid-cols-3 gap-3 mt-3" style={{ fontSize: '12px' }}>
              <div><span className="font-bold" style={{ color: '#2d7a4f' }}>{postExam.total_correct ?? 0}</span><br /><span style={{ color: '#8a9e8d' }}>Benar</span></div>
              <div><span className="font-bold" style={{ color: '#dc2626' }}>{postExam.total_wrong ?? 0}</span><br /><span style={{ color: '#8a9e8d' }}>Salah</span></div>
              <div><span className="font-bold" style={{ color: '#a8b9aa' }}>{postExam.total_unanswered ?? 0}</span><br /><span style={{ color: '#8a9e8d' }}>Kosong</span></div>
            </div>
          </div>
        )}
        <button onClick={() => { setPostExam(null); window.location.reload(); }}
          style={{ background: '#f4f6f4', border: '1.5px solid #d4dbd4', borderRadius: '12px', padding: '10px 24px', fontSize: '13px', fontWeight: 700, color: '#4a6655', cursor: 'pointer' }}>
          Kembali
        </button>
      </div>
    </div>
  );

  const start = (exam: Exam) => {
    if (exam.jadwal_status !== 'aktif' && exam.jadwal_status !== 'no_schedule') return;
    setSelected(exam);
    if (exam.session_id && exam.session_status === 'active') { setShowToken(true); }
    else { setShowRules(true); }
  };
  const toToken = () => { setShowRules(false); setShowToken(true); setTokenInput(''); setTokenError(''); };
  const validate = async () => {
    if (!selected) return;
    if (tokenInput.length < 4) { setTokenError('Token minimal 4 digit'); return; }
    setTokenLoading(true); setTokenError('');
    const r = await POST(`/api/student/exams/${selected.id}/validate-token`, { token_code: tokenInput, device_id: getDeviceId() });
    setTokenLoading(false);
    if (!r.success) { setTokenError(r.error || 'Token tidak valid'); return; }
    setShowToken(false);
    setActiveSession({ sessionId: r.data.session_id, startedAt: r.data.started_at, durationMinutes: r.data.duration_minutes });
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#f4f6f4' }}>

      {/* dot texture */}
      <div className="pointer-events-none fixed inset-0"
        style={{ backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.35, zIndex: 0 }} />

      {/* HEADER */}
      <header className="relative z-10" style={{ background: '#fff', borderBottom: '1.5px solid #e0e5e0' }}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 mx-auto" style={{ maxWidth: '900px' }}>
          <div className="flex items-center gap-2.5">
            <KemenagLogo />
            <div>
              <p className="font-extrabold leading-tight" style={{ color: '#1e2e22', fontSize: '11px', letterSpacing: '0.01em' }}>MAN 1 TASIKMALAYA</p>
              <p className="font-semibold italic mt-0.5" style={{ color: '#7a9e86', fontSize: '10px', letterSpacing: '0.05em' }}>Bangkit · Jaya · Juara</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="font-bold leading-tight" style={{ color: '#1e2e22', fontSize: '13px' }}>{user.full_name}</p>
              <p style={{ color: '#8a9e8d', fontSize: '11px' }}>Peserta Ujian</p>
            </div>
            <button onClick={logout}
              className="flex items-center justify-center shrink-0"
              style={{ width: '34px', height: '34px', borderRadius: '10px', background: '#fef2f2', border: '1.5px solid #fecaca', cursor: 'pointer' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            </button>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="relative z-10 flex-1 px-5 py-5 mx-auto w-full" style={{ maxWidth: '900px' }}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-bold uppercase" style={{ color: '#4a6655', fontSize: '11px', letterSpacing: '0.1em' }}>Daftar Ujian</p>
          <p style={{ color: '#8a9e8d', fontSize: '11px' }}>{exams.length} ujian tersedia</p>
        </div>

        {exams.length === 0 ? <EmptyState title="Belum ada ujian" desc="Hubungi panitia jika ada kendala" /> : (
          <>
            {/* ── MOBILE: CARDS ── */}
            <div className="flex flex-col gap-2.5 md:hidden">
              {exams.map(exam => {
                const done = exam.session_status === 'submitted' || exam.session_status === 'force_submitted';
                const active = exam.session_status === 'active';
                const canStart = !done && (exam.jadwal_status === 'aktif' || exam.jadwal_status === 'no_schedule');
                return (
                  <div key={exam.id} style={{
                    background: done ? '#fafbfa' : '#fff',
                    border: `1.5px solid ${active ? '#b5d9c4' : done ? '#e8ebe8' : '#d4dbd4'}`,
                    borderRadius: '18px', padding: '16px 18px',
                    opacity: done ? 0.75 : 1,
                  }}>
                    <div className="flex items-start justify-between gap-2.5 mb-2">
                      <div className="flex-1">
                        <p className="font-extrabold leading-tight mb-1" style={{ color: done ? '#6b7c6e' : '#1e2e22', fontSize: '14px' }}>{exam.title}</p>
                        {exam.description && <p className="leading-relaxed" style={{ color: '#8a9e8d', fontSize: '11.5px' }}>{exam.description}</p>}
                      </div>
                      <BadgeStatus status={exam.session_status} />
                    </div>
                    {exam.jadwal_info && <div className="mb-3"><JadwalInfo exam={exam} /></div>}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-semibold" style={{ color: done ? '#a8b9aa' : '#6b7c6e', fontSize: '11.5px' }}>
                        <Clock size={13} strokeWidth={2} />
                        {exam.duration_minutes} menit
                      </div>
                      {!done && <ActionBtn label={active ? 'Lanjut' : 'Mulai'} variant={active ? 'resume' : 'primary'} onClick={() => start(exam)} disabled={!canStart} />}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── DESKTOP: TABLE ── */}
            <div className="hidden md:block" style={{ background: '#fff', border: '1.5px solid #d4dbd4', borderRadius: '18px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f4f6f4', borderBottom: '1.5px solid #d4dbd4' }}>
                    {['#', 'Nama Ujian', 'Jadwal', 'Durasi', 'Status', 'Aksi'].map((h, i) => (
                      <th key={h} style={{
                        padding: '12px 20px', color: '#4a6655', fontSize: '11px', fontWeight: 700,
                        letterSpacing: '0.07em', textTransform: 'uppercase',
                        textAlign: i === 0 || i >= 3 ? 'center' : 'left',
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exams.map((exam, i) => {
                    const done = exam.session_status === 'submitted' || exam.session_status === 'force_submitted';
                    const active = exam.session_status === 'active';
                    const canStart = !done && (exam.jadwal_status === 'aktif' || exam.jadwal_status === 'no_schedule');
                    const dimmed = { color: '#a8b9aa' };
                    return (
                      <tr key={exam.id} style={{ borderBottom: i < exams.length - 1 ? '1px solid #edf0ed' : 'none', background: i % 2 !== 0 ? '#fafbfa' : '#fff' }}>
                        <td style={{ padding: '14px 20px', textAlign: 'center', fontSize: '12px', fontWeight: 600, ...(done ? dimmed : { color: '#8a9e8d' }) }}>{i + 1}</td>
                        <td style={{ padding: '14px 20px', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap', ...(done ? dimmed : { color: '#1e2e22' }) }}>{exam.title}</td>
                        <td style={{ padding: '14px 20px', fontSize: '12px', maxWidth: '280px' }}>
                          {exam.jadwal_info ? <JadwalInfo exam={exam} /> : <span style={{ color: '#a8b9aa' }}>—</span>}
                        </td>
                        <td style={{ padding: '14px 20px', textAlign: 'center', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap', ...(done ? dimmed : { color: '#6b7c6e' }) }}>{exam.duration_minutes} menit</td>
                        <td style={{ padding: '14px 20px', textAlign: 'center' }}><BadgeStatus status={exam.session_status} /></td>
                        <td style={{ padding: '14px 20px', textAlign: 'center' }}>
                          {!done
                            ? <ActionBtn label={active ? 'Lanjut' : 'Mulai'} variant={active ? 'resume' : 'primary'} onClick={() => start(exam)} disabled={!canStart} />
                            : <span style={{ color: '#c4cec4', fontSize: '14px', fontWeight: 700 }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {/* FOOTER */}
      <footer className="relative z-10 text-center pb-8 pt-2">
        <p style={{ color: '#a8b3a8', fontSize: '11px', fontWeight: 500 }}>© 2026 MAN 1 Tasikmalaya — DRUDOX</p>
      </footer>

      {/* MODAL: Tata Tertib */}
      <Modal open={showRules} onClose={() => setShowRules(false)} title="Tata Tertib Ujian">
        {selected?.rules_text
          ? <div className="prose prose-sm max-w-none text-sm" style={{ color: '#4a6655' }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selected.rules_text) }} />
          : <div className="space-y-2 text-sm" style={{ color: '#4a6655' }}>
            <p>1. Kerjakan ujian dengan jujur dan mandiri.</p>
            <p>2. Dilarang membuka tab atau aplikasi lain selama ujian.</p>
            <p>3. Pelanggaran 3 kali akan otomatis mengumpulkan ujian.</p>
            <p>4. Pastikan koneksi internet stabil.</p>
          </div>}
        <div className="mt-5">
          <button onClick={toToken} className="w-full flex items-center justify-between active:scale-[0.98] transition-transform"
            style={{ background: '#2d7a4f', padding: '14px 18px', borderRadius: '14px', border: 'none', cursor: 'pointer' }}>
            <span className="font-extrabold" style={{ color: '#fff', fontSize: '14px' }}>Saya Mengerti, Lanjutkan</span>
            <span className="flex items-center justify-center" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.15)', borderRadius: '9px' }}>
              <ArrowRight size={15} color="#fff" strokeWidth={2.5} />
            </span>
          </button>
        </div>
      </Modal>

      {/* MODAL: Token */}
      <Modal open={showToken} onClose={() => setShowToken(false)} title="Masukkan Token" size="sm">
        <p className="mb-3" style={{ color: '#8a9e8d', fontSize: '12px' }}>Minta token kepada pengawas ruangan.</p>
        <div className="relative">
          <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2" color="#9ab5a2" />
          <input type="text" value={tokenInput}
            onChange={e => setTokenInput(e.target.value.replace(/\D/g, ''))}
            maxLength={6} placeholder="000000" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') validate(); }}
            className="w-full text-center font-mono font-bold tracking-[0.3em]"
            style={{ paddingLeft: '36px', paddingRight: '12px', paddingTop: '12px', paddingBottom: '12px', fontSize: '20px', border: '1.5px solid #d4dbd4', borderRadius: '12px', outline: 'none', color: '#1e2e22' }}
            onFocus={e => { e.target.style.borderColor = '#2d7a4f'; e.target.style.boxShadow = '0 0 0 3px rgba(45,122,79,0.1)'; }}
            onBlur={e => { e.target.style.borderColor = '#d4dbd4'; e.target.style.boxShadow = 'none'; }} />
        </div>
        {tokenError && <p className="text-center mt-2" style={{ color: '#dc2626', fontSize: '12px', fontWeight: 600 }}>{tokenError}</p>}
        <button onClick={validate} disabled={tokenLoading}
          className="w-full flex items-center justify-between mt-3 active:scale-[0.98] transition-all disabled:opacity-50"
          style={{ background: '#2d7a4f', padding: '14px 18px', borderRadius: '14px', border: 'none', cursor: 'pointer' }}>
          <span className="font-extrabold" style={{ color: '#fff', fontSize: '14px' }}>{tokenLoading ? 'Memproses...' : 'Mulai Ujian'}</span>
          <span className="flex items-center justify-center" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.15)', borderRadius: '9px' }}>
            {tokenLoading
              ? <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
              : <ArrowRight size={15} color="#fff" strokeWidth={2.5} />}
          </span>
        </button>
      </Modal>
    </div>
  );
}

export default function StudentPage() { return <ToastProvider><StudentContent /></ToastProvider>; }
