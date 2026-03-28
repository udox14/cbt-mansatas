'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST } from '@/lib/api';
import { getDeviceId } from '@/lib/device';
import { Button, Modal, LoadingScreen, Badge, EmptyState, ToastProvider, useToast } from '@/components/ui';
import ExamRoom from '@/components/exam/ExamRoom';

interface Exam {
  id: number; title: string; description: string | null; duration_minutes: number;
  rules_text: string | null; session_id: number | null; session_status: string | null;
}

function StudentContent() {
  const { user, loading: authLoading, logout } = useAuth('student');
  const { toast } = useToast();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  // Flow states
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [tokenLoading, setTokenLoading] = useState(false);
  // Exam session
  const [activeSession, setActiveSession] = useState<{
    sessionId: number; startedAt: string; durationMinutes: number;
  } | null>(null);
  // Post exam
  const [postExam, setPostExam] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    GET<Exam[]>('/api/student/exams').then(r => {
      if (r.success) setExams(r.data || []);
      setLoading(false);
    });
  }, [user]);

  if (authLoading || loading) return <LoadingScreen />;
  if (!user) return null;

  // ── If in exam room ──────────────────────────────────────
  if (activeSession) {
    return (
      <ExamRoom
        sessionId={activeSession.sessionId}
        startedAt={activeSession.startedAt}
        durationMinutes={activeSession.durationMinutes}
        onFinish={(result) => {
          setActiveSession(null);
          setPostExam(result);
        }}
      />
    );
  }

  // ── Post-Exam Screen ─────────────────────────────────────
  if (postExam) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-surface-100 max-w-sm w-full p-6 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-brand-50 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <h2 className="text-lg font-bold text-surface-900 mb-2">Ujian Selesai!</h2>
          <p className="text-sm text-surface-500 mb-4">{postExam.completion_message || 'Terima kasih telah menyelesaikan ujian.'}</p>

          {postExam.score_visible && (
            <div className="bg-surface-50 rounded-xl p-4 mb-4 space-y-2">
              <div className="text-3xl font-extrabold text-brand-700">{postExam.score ?? 0}</div>
              <p className="text-xs text-surface-500">Nilai Anda</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="font-bold text-brand-600">{postExam.total_correct ?? 0}</span> Benar</div>
                <div><span className="font-bold text-red-600">{postExam.total_wrong ?? 0}</span> Salah</div>
                <div><span className="font-bold text-surface-500">{postExam.total_unanswered ?? 0}</span> Kosong</div>
              </div>
            </div>
          )}

          <Button variant="secondary" onClick={() => { setPostExam(null); window.location.reload(); }}>
            Kembali
          </Button>
        </div>
      </div>
    );
  }

  // ── Start Exam Flow ───────────────────────────────────────
  const startExamFlow = (exam: Exam) => {
    // If already has active session, resume directly
    if (exam.session_id && exam.session_status === 'active') {
      setSelectedExam(exam);
      setShowToken(true);
      return;
    }
    setSelectedExam(exam);
    setShowRules(true);
  };

  const proceedToToken = () => {
    setShowRules(false);
    setShowToken(true);
    setTokenInput('');
    setTokenError('');
  };

  const validateToken = async () => {
    if (!selectedExam) return;
    if (tokenInput.length < 4) { setTokenError('Token minimal 4 digit'); return; }
    setTokenLoading(true);
    setTokenError('');
    const r = await POST(`/api/student/exams/${selectedExam.id}/validate-token`, {
      token_code: tokenInput, device_id: getDeviceId(),
    });
    setTokenLoading(false);
    if (!r.success) { setTokenError(r.error || 'Token tidak valid'); return; }
    setShowToken(false);
    setActiveSession({
      sessionId: r.data.session_id,
      startedAt: r.data.started_at,
      durationMinutes: r.data.duration_minutes,
    });
  };

  // ── Dashboard View ────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface-50">
      {/* Header */}
      <header className="bg-white border-b border-surface-100 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-surface-900">{user.full_name}</h1>
            <p className="text-xs text-surface-400">Peserta Ujian</p>
          </div>
          <button onClick={logout} className="text-xs text-surface-400 hover:text-red-500 font-medium transition-colors">Keluar</button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider">Ujian Tersedia</h2>

        {exams.length === 0 ? (
          <EmptyState title="Belum ada ujian" desc="Ujian yang tersedia akan muncul di sini" />
        ) : (
          exams.map(exam => {
            const done = exam.session_status === 'submitted' || exam.session_status === 'force_submitted';
            const active = exam.session_status === 'active';
            return (
              <div key={exam.id} className="bg-white rounded-xl border border-surface-100 shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm text-surface-900 truncate">{exam.title}</h3>
                    {exam.description && <p className="text-xs text-surface-400 mt-0.5 line-clamp-2">{exam.description}</p>}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-surface-500">{exam.duration_minutes} menit</span>
                      {done && <Badge color="green">Selesai</Badge>}
                      {active && <Badge color="blue">Berlangsung</Badge>}
                    </div>
                  </div>
                  {!done && (
                    <Button size="sm" onClick={() => startExamFlow(exam)}>
                      {active ? 'Lanjut' : 'Mulai'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </main>

      {/* Rules Modal */}
      <Modal open={showRules} onClose={() => setShowRules(false)} title="Tata Tertib Ujian">
        {selectedExam?.rules_text ? (
          <div className="prose prose-sm max-w-none text-surface-700 text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: selectedExam.rules_text }} />
        ) : (
          <div className="text-sm text-surface-600 space-y-2">
            <p>1. Kerjakan ujian dengan jujur dan mandiri.</p>
            <p>2. Dilarang membuka tab/aplikasi lain selama ujian.</p>
            <p>3. Pelanggaran 3 kali akan otomatis mengumpulkan ujian.</p>
            <p>4. Pastikan koneksi internet stabil.</p>
            <p>5. Jawaban tersimpan otomatis secara berkala.</p>
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-surface-100">
          <Button className="w-full" onClick={proceedToToken}>Saya Mengerti, Lanjutkan</Button>
        </div>
      </Modal>

      {/* Token Input Modal */}
      <Modal open={showToken} onClose={() => setShowToken(false)} title="Masukkan Token Ujian" size="sm">
        <p className="text-xs text-surface-500 mb-3">Minta token kepada pengawas ruangan Anda.</p>
        <input type="text" value={tokenInput} onChange={e => setTokenInput(e.target.value.replace(/\D/g, ''))}
          maxLength={6} placeholder="000000" autoFocus
          className="w-full text-center text-2xl font-mono font-bold tracking-[0.3em] px-4 py-3 bg-surface-50 border border-surface-200
            rounded-xl outline-none focus:border-brand-500 transition-colors"
          onKeyDown={e => { if (e.key === 'Enter') validateToken(); }} />
        {tokenError && <p className="text-xs text-red-500 mt-2 text-center">{tokenError}</p>}
        <Button className="w-full mt-3" loading={tokenLoading} onClick={validateToken}>Mulai Ujian</Button>
      </Modal>
    </div>
  );
}

export default function StudentPage() {
  return <ToastProvider><StudentContent /></ToastProvider>;
}
