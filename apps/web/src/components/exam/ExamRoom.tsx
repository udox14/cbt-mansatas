'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, Modal, Spinner, Badge } from '@/components/ui';

interface Question {
  index: number; id: number; question_text: string; question_type: string;
  image_url: string | null; audio_url: string | null;
  options: { id: number; option_label: string; option_text: string; image_url: string | null }[];
}
interface Answer { question_id: number; selected_option_id?: number; essay_answer?: string; is_doubtful?: boolean }

interface ExamRoomProps {
  sessionId: number; startedAt: string; durationMinutes: number;
  onFinish: (result: any) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

export default function ExamRoom({ sessionId, startedAt, durationMinutes, onFinish }: ExamRoomProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Map<number, Answer>>(new Map());
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [timeLeft, setTimeLeft] = useState(0);
  const [cheatCount, setCheatCount] = useState(0);
  const [cheatMsg, setCheatMsg] = useState('');
  const syncRef = useRef<NodeJS.Timeout | null>(null);
  const heartRef = useRef<NodeJS.Timeout | null>(null);
  const dirtyRef = useRef(new Set<number>());
  const submittedRef = useRef(false);

  // ── Load Questions ────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem(`cbt_font_${sessionId}`);
    if (saved) setFontSize(parseInt(saved));

    GET<{ questions: Question[]; answers: any[] }>(`/api/student/sessions/${sessionId}/questions`).then(r => {
      if (r.success && r.data) {
        setQuestions(r.data.questions);
        const m = new Map<number, Answer>();
        // Restore dari server
        for (const a of r.data.answers || []) {
          m.set(a.question_id, {
            question_id: a.question_id,
            selected_option_id: a.selected_option_id,
            essay_answer: a.essay_answer,
            is_doubtful: !!a.is_doubtful,
          });
        }
        // Restore dari localStorage (lebih baru)
        const local = localStorage.getItem(`cbt_answers_${sessionId}`);
        if (local) {
          try {
            const parsed: Answer[] = JSON.parse(local);
            for (const a of parsed) { m.set(a.question_id, a); }
          } catch {}
        }
        setAnswers(m);
        // Restore posisi soal
        const pos = localStorage.getItem(`cbt_pos_${sessionId}`);
        if (pos) setCurrent(parseInt(pos) || 0);
      }
      setLoading(false);
    });
  }, [sessionId]);

  // ── Timer ─────────────────────────────────────────────────
  useEffect(() => {
    const end = new Date(startedAt).getTime() + durationMinutes * 60 * 1000;
    const tick = () => {
      const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0 && !submittedRef.current) { handleSubmit(true); }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [startedAt, durationMinutes]);

  // ── Background Sync (every 15s) ──────────────────────────
  useEffect(() => {
    syncRef.current = setInterval(() => flushAnswers(), 15000);
    heartRef.current = setInterval(() => POST(`/api/student/sessions/${sessionId}/heartbeat`), 15000);
    return () => {
      if (syncRef.current) clearInterval(syncRef.current);
      if (heartRef.current) clearInterval(heartRef.current);
    };
  }, [sessionId]);

  const flushAnswers = useCallback(async () => {
    if (dirtyRef.current.size === 0) return;
    const batch: Answer[] = [];
    const ansMap = new Map(answers);
    dirtyRef.current.forEach(qId => { const a = ansMap.get(qId); if (a) batch.push(a); });
    if (batch.length === 0) return;
    const ids = new Set(dirtyRef.current);
    dirtyRef.current.clear();
    const r = await POST(`/api/student/sessions/${sessionId}/answers`, { answers: batch });
    if (!r.success) { ids.forEach(id => dirtyRef.current.add(id)); }
  }, [answers, sessionId]);

  // ── Anti-Cheat ────────────────────────────────────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && !submittedRef.current) {
        const newCount = cheatCount + 1;
        setCheatCount(newCount);
        POST(`/api/student/sessions/${sessionId}/cheat`);
        if (newCount >= 3) {
          setCheatMsg('Anda terdeteksi meninggalkan halaman 3 kali. Ujian otomatis dikumpulkan.');
          handleSubmit(true);
        } else {
          setCheatMsg(`Peringatan ${newCount}/3: Jangan meninggalkan halaman ujian!`);
          setTimeout(() => setCheatMsg(''), 4000);
        }
      }
    };
    const blockContext = (e: MouseEvent) => { e.preventDefault(); };
    const blockKeys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['c', 'v', 'a', 'x', 'u', 's', 'p'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('contextmenu', blockContext);
    document.addEventListener('keydown', blockKeys);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      document.removeEventListener('contextmenu', blockContext);
      document.removeEventListener('keydown', blockKeys);
    };
  }, [cheatCount, sessionId]);

  // ── Answer Handler ────────────────────────────────────────
  const setAnswer = useCallback((qId: number, update: Partial<Answer>) => {
    setAnswers(prev => {
      const m = new Map(prev);
      const existing = m.get(qId) || { question_id: qId };
      m.set(qId, { ...existing, ...update });
      // Persist to localStorage
      localStorage.setItem(`cbt_answers_${sessionId}`, JSON.stringify([...m.values()]));
      dirtyRef.current.add(qId);
      return m;
    });
  }, [sessionId]);

  // ── Navigation ────────────────────────────────────────────
  const goTo = useCallback((idx: number) => {
    setCurrent(idx);
    setShowGrid(false);
    localStorage.setItem(`cbt_pos_${sessionId}`, String(idx));
    window.scrollTo(0, 0);
  }, [sessionId]);

  // ── Submit ────────────────────────────────────────────────
  const handleSubmit = useCallback(async (force = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setShowConfirm(false);
    // Flush remaining
    const batch = [...answers.values()];
    if (batch.length > 0) {
      await POST(`/api/student/sessions/${sessionId}/answers`, { answers: batch });
    }
    const r = await POST(`/api/student/sessions/${sessionId}/submit`);
    // Cleanup localStorage
    localStorage.removeItem(`cbt_answers_${sessionId}`);
    localStorage.removeItem(`cbt_pos_${sessionId}`);
    onFinish(r.data || {});
  }, [answers, sessionId, onFinish]);

  // ── Font Size ─────────────────────────────────────────────
  const changeFontSize = (delta: number) => {
    const next = Math.max(12, Math.min(24, fontSize + delta));
    setFontSize(next);
    localStorage.setItem(`cbt_font_${sessionId}`, String(next));
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner size={28} /></div>;

  const q = questions[current];
  if (!q) return null;
  const ans = answers.get(q.id);
  const answeredCount = [...answers.values()].filter(a => a.selected_option_id || a.essay_answer).length;
  const doubtCount = [...answers.values()].filter(a => a.is_doubtful).length;
  const mm = Math.floor(timeLeft / 60);
  const ss = timeLeft % 60;
  const isUrgent = timeLeft < 300; // < 5 menit

  return (
    <div className="min-h-screen bg-surface-50 no-select flex flex-col">
      {/* ── Header Bar ──────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white border-b border-surface-100 px-3 py-2">
        <div className="flex items-center justify-between gap-2 max-w-3xl mx-auto">
          {/* Timer */}
          <div className={`flex items-center gap-1.5 font-mono font-bold text-sm tabular-nums
            ${isUrgent ? 'text-red-600' : 'text-surface-800'}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
            {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
          </div>

          {/* Progress */}
          <span className="text-xs text-surface-500">{answeredCount}/{questions.length} dijawab</span>

          {/* Font Size */}
          <div className="flex items-center gap-0.5">
            <button onClick={() => changeFontSize(-2)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-xs font-bold text-surface-500 hover:bg-surface-100">A-</button>
            <button onClick={() => changeFontSize(2)}
              className="w-7 h-7 flex items-center justify-center rounded-md text-sm font-bold text-surface-500 hover:bg-surface-100">A+</button>
          </div>

          {/* Grid toggle */}
          <button onClick={() => setShowGrid(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-surface-100 rounded-lg text-xs font-semibold text-surface-600 hover:bg-surface-200 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            {current + 1}/{questions.length}
          </button>
        </div>
      </header>

      {/* ── Cheat Warning ───────────────────────────────────── */}
      {cheatMsg && (
        <div className="sticky top-[52px] z-30 bg-red-600 text-white text-xs font-semibold text-center py-2 px-4 toast-enter">
          {cheatMsg}
        </div>
      )}

      {/* ── Question Body ───────────────────────────────────── */}
      <main className="flex-1 px-3 py-3 max-w-3xl mx-auto w-full">
        <div className="bg-white rounded-xl border border-surface-100 shadow-sm overflow-hidden">
          {/* Question number bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-surface-50 bg-surface-50/50">
            <span className="text-xs font-bold text-surface-500">Soal {current + 1}</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={!!ans?.is_doubtful}
                onChange={e => setAnswer(q.id, { is_doubtful: e.target.checked })}
                className="w-3.5 h-3.5 rounded border-surface-300 text-amber-500 focus:ring-amber-500" />
              <span className="text-xs text-amber-600 font-medium">Ragu-ragu</span>
            </label>
          </div>

          {/* Question content */}
          <div className="px-4 py-3 exam-text" style={{ '--exam-font-size': `${fontSize}px` } as any}>
            <div dangerouslySetInnerHTML={{ __html: q.question_text }} />
          </div>

          {/* Image */}
          {q.image_url && (
            <div className="px-4 pb-3">
              <img src={`${API_URL}/r2/${q.image_url}`} alt="Soal" className="max-w-full rounded-lg border border-surface-100" />
            </div>
          )}

          {/* Audio */}
          {q.audio_url && (
            <div className="px-4 pb-3">
              <audio controls controlsList="nodownload" preload="auto" className="w-full">
                <source src={`${API_URL}/r2/${q.audio_url}`} />
              </audio>
            </div>
          )}

          {/* Options */}
          {q.question_type === 'multiple_choice' ? (
            <div className="px-4 pb-4 space-y-2">
              {q.options.map(o => {
                const selected = ans?.selected_option_id === o.id;
                return (
                  <button key={o.id} onClick={() => setAnswer(q.id, { selected_option_id: o.id })}
                    className={`w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all text-sm
                      ${selected
                        ? 'bg-brand-50 border-brand-500 ring-1 ring-brand-500/30'
                        : 'bg-surface-50/50 border-surface-200 hover:border-surface-300 hover:bg-surface-50'
                      }`}>
                    <span className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold border-2 mt-0.5
                      ${selected ? 'bg-brand-600 border-brand-600 text-white' : 'border-surface-300 text-surface-500'}`}>
                      {o.option_label}
                    </span>
                    <span className="flex-1" style={{ fontSize: `${fontSize}px` }}>
                      {o.image_url ? (
                        <img src={`${API_URL}/r2/${o.image_url}`} alt={o.option_label} className="max-w-full rounded-md" />
                      ) : (
                        <span dangerouslySetInnerHTML={{ __html: o.option_text }} />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 pb-4">
              <textarea value={ans?.essay_answer || ''} onChange={e => setAnswer(q.id, { essay_answer: e.target.value })}
                placeholder="Tulis jawaban Anda..." rows={5}
                className="w-full px-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-xl outline-none focus:border-brand-500 resize-none"
                style={{ fontSize: `${fontSize}px` }} />
            </div>
          )}
        </div>
      </main>

      {/* ── Bottom Navigation ───────────────────────────────── */}
      <div className="sticky bottom-0 z-40 bg-white border-t border-surface-100 px-3 py-2">
        <div className="flex items-center justify-between gap-2 max-w-3xl mx-auto">
          <button onClick={() => goTo(Math.max(0, current - 1))} disabled={current === 0}
            className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-surface-600 bg-surface-100 rounded-lg
              hover:bg-surface-200 transition-colors disabled:opacity-30">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            Sebelumnya
          </button>

          {current < questions.length - 1 ? (
            <button onClick={() => goTo(current + 1)}
              className="flex items-center gap-1 px-4 py-2 text-xs font-semibold text-white bg-brand-600 rounded-lg
                hover:bg-brand-700 transition-colors">
              Selanjutnya
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          ) : (
            <button onClick={() => setShowConfirm(true)}
              className="flex items-center gap-1 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg
                hover:bg-blue-700 transition-colors">
              Kumpulkan
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Question Grid Drawer ────────────────────────────── */}
      <Modal open={showGrid} onClose={() => setShowGrid(false)} title="Navigasi Soal">
        <div className="mb-3 flex gap-3 text-xs text-surface-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-brand-500" /> Dijawab</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400" /> Ragu</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-surface-200" /> Belum</span>
        </div>
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
          {questions.map((qq, i) => {
            const a = answers.get(qq.id);
            const answered = !!(a?.selected_option_id || a?.essay_answer);
            const doubtful = !!a?.is_doubtful;
            const isCurrent = i === current;
            let bg = 'bg-surface-100 text-surface-600';
            if (doubtful) bg = 'bg-amber-400 text-white';
            else if (answered) bg = 'bg-brand-500 text-white';
            return (
              <button key={qq.id} onClick={() => goTo(i)}
                className={`w-full aspect-square flex items-center justify-center text-xs font-bold rounded-lg transition-all
                  ${bg} ${isCurrent ? 'ring-2 ring-surface-900 ring-offset-1' : 'hover:scale-105'}`}>
                {i + 1}
              </button>
            );
          })}
        </div>
        <div className="mt-4 pt-3 border-t border-surface-100 text-center">
          <Button variant="primary" size="sm" onClick={() => { setShowGrid(false); setShowConfirm(true); }}>
            Kumpulkan Ujian
          </Button>
        </div>
      </Modal>

      {/* ── Submit Confirm ──────────────────────────────────── */}
      <Modal open={showConfirm} onClose={() => { setShowConfirm(false); submittedRef.current = false; }} title="Kumpulkan Ujian?" size="sm">
        <div className="space-y-3 text-sm text-surface-600">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-brand-50 rounded-lg">
              <p className="text-lg font-bold text-brand-700">{answeredCount}</p>
              <p className="text-xs text-brand-600">Dijawab</p>
            </div>
            <div className="p-2 bg-surface-50 rounded-lg">
              <p className="text-lg font-bold text-surface-700">{questions.length - answeredCount}</p>
              <p className="text-xs text-surface-500">Belum</p>
            </div>
            <div className="p-2 bg-amber-50 rounded-lg">
              <p className="text-lg font-bold text-amber-700">{doubtCount}</p>
              <p className="text-xs text-amber-600">Ragu</p>
            </div>
          </div>
          <p className="text-surface-500 text-xs text-center">Setelah dikumpulkan, Anda tidak dapat mengubah jawaban.</p>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="secondary" size="sm" onClick={() => { setShowConfirm(false); submittedRef.current = false; }}>Kembali</Button>
          <Button variant="primary" size="sm" loading={submitting} onClick={() => handleSubmit()}>Ya, Kumpulkan</Button>
        </div>
      </Modal>
    </div>
  );
}
