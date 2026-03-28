'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST } from '@/lib/api';
import { getDeviceId } from '@/lib/device';
import { Button, Modal, LoadingScreen, Badge, EmptyState, ToastProvider, Spinner } from '@/components/ui';
import ExamRoom from '@/components/exam/ExamRoom';
import { LogOut, Clock, ArrowRight, Check, KeyRound } from 'lucide-react';

interface Exam { id: string; title: string; description: string | null; duration_minutes: number; rules_text: string | null; session_id: string | null; session_status: string | null }

function StudentContent() {
  const { user, loading: authLoading, logout } = useAuth('student');
  const [exams, setExams] = useState<Exam[]>([]); const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Exam | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState(''); const [tokenError, setTokenError] = useState(''); const [tokenLoading, setTokenLoading] = useState(false);
  const [activeSession, setActiveSession] = useState<{ sessionId: string; startedAt: string; durationMinutes: number } | null>(null);
  const [postExam, setPostExam] = useState<any>(null);

  useEffect(() => { if (!user) return; GET<Exam[]>('/api/student/exams').then(r => { if (r.success) setExams(r.data || []); setLoading(false); }); }, [user]);

  if (authLoading || loading) return <LoadingScreen />;
  if (!user) return null;

  if (activeSession) return <ExamRoom sessionId={activeSession.sessionId} startedAt={activeSession.startedAt} durationMinutes={activeSession.durationMinutes} onFinish={r => { setActiveSession(null); setPostExam(r); }} />;

  if (postExam) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white rounded-xl border border-gray-200 max-w-sm w-full p-8 text-center shadow-sm">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-primary-50 flex items-center justify-center"><Check size={24} className="text-primary-600" /></div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">Ujian Selesai!</h2>
        <p className="text-sm text-gray-500 mb-5">{postExam.completion_message || 'Terima kasih.'}</p>
        {postExam.score_visible && <div className="bg-gray-50 rounded-xl p-5 mb-5">
          <div className="text-3xl font-extrabold text-primary-700">{postExam.score ?? 0}</div>
          <p className="text-xs text-gray-400 mt-1">Nilai Anda</p>
          <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
            <div><span className="font-bold text-primary-600">{postExam.total_correct ?? 0}</span><br/>Benar</div>
            <div><span className="font-bold text-red-500">{postExam.total_wrong ?? 0}</span><br/>Salah</div>
            <div><span className="font-bold text-gray-400">{postExam.total_unanswered ?? 0}</span><br/>Kosong</div></div></div>}
        <Button variant="secondary" onClick={() => { setPostExam(null); window.location.reload(); }}>Kembali</Button>
      </div>
    </div>
  );

  const start = (exam: Exam) => { setSelected(exam); if (exam.session_id && exam.session_status === 'active') { setShowToken(true); } else { setShowRules(true); } };
  const toToken = () => { setShowRules(false); setShowToken(true); setTokenInput(''); setTokenError(''); };
  const validate = async () => {
    if (!selected) return; if (tokenInput.length < 4) { setTokenError('Token minimal 4 digit'); return; }
    setTokenLoading(true); setTokenError('');
    const r = await POST(`/api/student/exams/${selected.id}/validate-token`, { token_code: tokenInput, device_id: getDeviceId() });
    setTokenLoading(false); if (!r.success) { setTokenError(r.error || 'Token tidak valid'); return; }
    setShowToken(false); setActiveSession({ sessionId: r.data.session_id, startedAt: r.data.started_at, durationMinutes: r.data.duration_minutes });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div><h1 className="text-sm font-semibold text-gray-900">{user.full_name}</h1><p className="text-[11px] text-gray-400">Peserta Ujian</p></div>
          <button onClick={logout} className="text-gray-400 hover:text-red-500 transition"><LogOut size={16} /></button>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ujian Tersedia</h2>
        {exams.length === 0 ? <EmptyState title="Belum ada ujian" /> : exams.map(exam => {
          const done = exam.session_status === 'submitted' || exam.session_status === 'force_submitted';
          const active = exam.session_status === 'active';
          return (
            <div key={exam.id} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1"><h3 className="font-medium text-sm text-gray-900">{exam.title}</h3>
                  {exam.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{exam.description}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-500"><Clock size={12} /> {exam.duration_minutes} menit
                    {done && <Badge color="green">Selesai</Badge>}{active && <Badge color="blue">Berlangsung</Badge>}</div></div>
                {!done && <Button size="sm" onClick={() => start(exam)}>{active ? 'Lanjut' : 'Mulai'} <ArrowRight size={14} /></Button>}
              </div>
            </div>);
        })}
      </main>
      <Modal open={showRules} onClose={() => setShowRules(false)} title="Tata Tertib Ujian">
        {selected?.rules_text ? <div className="prose prose-sm max-w-none text-gray-600 text-sm" dangerouslySetInnerHTML={{ __html: selected.rules_text }} />
         : <div className="text-sm text-gray-600 space-y-1.5"><p>1. Kerjakan ujian dengan jujur dan mandiri.</p><p>2. Dilarang membuka tab/aplikasi lain selama ujian.</p><p>3. Pelanggaran 3 kali akan otomatis mengumpulkan ujian.</p><p>4. Pastikan koneksi internet stabil.</p></div>}
        <div className="mt-5"><Button className="w-full" onClick={toToken}>Saya Mengerti, Lanjutkan <ArrowRight size={15} /></Button></div>
      </Modal>
      <Modal open={showToken} onClose={() => setShowToken(false)} title="Masukkan Token" size="sm">
        <p className="text-xs text-gray-400 mb-3">Minta token kepada pengawas ruangan.</p>
        <div className="relative"><KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input type="text" value={tokenInput} onChange={e => setTokenInput(e.target.value.replace(/\D/g, ''))} maxLength={6} placeholder="000000" autoFocus
            className="w-full text-center text-xl font-mono font-bold tracking-[0.3em] pl-9 pr-3 py-3 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            onKeyDown={e => { if (e.key === 'Enter') validate(); }} /></div>
        {tokenError && <p className="text-xs text-red-500 mt-2 text-center">{tokenError}</p>}
        <Button className="w-full mt-3" loading={tokenLoading} onClick={validate}>Mulai Ujian</Button>
      </Modal>
    </div>
  );
}

export default function StudentPage() { return <ToastProvider><StudentContent /></ToastProvider>; }
