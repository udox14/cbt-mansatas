'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, Modal, Spinner, Badge } from '@/components/ui';
import { Clock, ChevronLeft, ChevronRight, Grid3x3, Minus, Plus, Send, AlertTriangle, Check } from 'lucide-react';

interface Question { index: number; id: string; question_text: string; question_type: string; image_url: string | null; audio_url: string | null;
  options: { id: string; option_label: string; option_text: string; image_url: string | null }[] }
interface Answer { question_id: string; selected_option_id?: string; essay_answer?: string; is_doubtful?: boolean }
interface ExamRoomProps { sessionId: string; startedAt: string; durationMinutes: number; onFinish: (result: any) => void }

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export default function ExamRoom({ sessionId, startedAt, durationMinutes, onFinish }: ExamRoomProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Map<string, Answer>>(new Map());
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [timeLeft, setTimeLeft] = useState(0);
  const [cheatCount, setCheatCount] = useState(0);
  const [cheatMsg, setCheatMsg] = useState('');
  const dirtyRef = useRef(new Set<string>());
  const submittedRef = useRef(false);

  // Load
  useEffect(() => {
    const s = localStorage.getItem(`cbt_font_${sessionId}`); if (s) setFontSize(parseInt(s));
    GET<{ questions: Question[]; answers: any[] }>(`/api/student/sessions/${sessionId}/questions`).then(r => {
      if (r.success && r.data) {
        setQuestions(r.data.questions);
        const m = new Map<string, Answer>();
        for (const a of r.data.answers || []) m.set(a.question_id, { question_id: a.question_id, selected_option_id: a.selected_option_id, essay_answer: a.essay_answer, is_doubtful: !!a.is_doubtful });
        const local = localStorage.getItem(`cbt_answers_${sessionId}`);
        if (local) { try { for (const a of JSON.parse(local) as Answer[]) m.set(a.question_id, a); } catch {} }
        setAnswers(m);
        const pos = localStorage.getItem(`cbt_pos_${sessionId}`); if (pos) setCurrent(parseInt(pos) || 0);
      } setLoading(false);
    });
  }, [sessionId]);

  // Timer
  useEffect(() => {
    const end = new Date(startedAt).getTime() + durationMinutes * 60 * 1000;
    const tick = () => { const left = Math.max(0, Math.floor((end - Date.now()) / 1000)); setTimeLeft(left); if (left <= 0 && !submittedRef.current) handleSubmit(true); };
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv);
  }, [startedAt, durationMinutes]);

  // Sync & heartbeat
  useEffect(() => {
    const s = setInterval(() => flushAnswers(), 15000);
    const h = setInterval(() => POST(`/api/student/sessions/${sessionId}/heartbeat`), 15000);
    return () => { clearInterval(s); clearInterval(h); };
  }, [sessionId]);

  const flushAnswers = useCallback(async () => {
    if (dirtyRef.current.size === 0) return;
    const batch: Answer[] = []; const cur = new Map(answers);
    dirtyRef.current.forEach(qId => { const a = cur.get(qId); if (a) batch.push(a); });
    const ids = new Set(dirtyRef.current); dirtyRef.current.clear();
    const r = await POST(`/api/student/sessions/${sessionId}/answers`, { answers: batch });
    if (!r.success) ids.forEach(id => dirtyRef.current.add(id));
  }, [answers, sessionId]);

  // Anti-cheat
  useEffect(() => {
    const vis = () => { if (document.hidden && !submittedRef.current) {
      const n = cheatCount + 1; setCheatCount(n); POST(`/api/student/sessions/${sessionId}/cheat`);
      if (n >= 3) { setCheatMsg('3x pelanggaran — ujian otomatis dikumpulkan.'); handleSubmit(true); }
      else { setCheatMsg(`Peringatan ${n}/3: Jangan tinggalkan halaman ujian!`); setTimeout(() => setCheatMsg(''), 4000); }
    }};
    const ctx = (e: MouseEvent) => e.preventDefault();
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey||e.metaKey)&&['c','v','a','x','u','s','p'].includes(e.key.toLowerCase())) e.preventDefault(); };
    document.addEventListener('visibilitychange', vis); document.addEventListener('contextmenu', ctx); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('visibilitychange', vis); document.removeEventListener('contextmenu', ctx); document.removeEventListener('keydown', key); };
  }, [cheatCount, sessionId]);

  const setAnswer = useCallback((qId: string, update: Partial<Answer>) => {
    setAnswers(prev => { const m = new Map(prev); const ex = m.get(qId) || { question_id: qId }; m.set(qId, { ...ex, ...update });
      localStorage.setItem(`cbt_answers_${sessionId}`, JSON.stringify(Array.from(m.values())));
      dirtyRef.current.add(qId); return m; });
  }, [sessionId]);

  const goTo = useCallback((i: number) => { setCurrent(i); setShowGrid(false); localStorage.setItem(`cbt_pos_${sessionId}`, String(i)); window.scrollTo(0, 0); }, [sessionId]);

  const handleSubmit = useCallback(async (force = false) => {
    if (submittedRef.current) return; submittedRef.current = true; setSubmitting(true); setShowConfirm(false);
    const batch = Array.from(answers.values()); if (batch.length) await POST(`/api/student/sessions/${sessionId}/answers`, { answers: batch });
    const r = await POST(`/api/student/sessions/${sessionId}/submit`);
    localStorage.removeItem(`cbt_answers_${sessionId}`); localStorage.removeItem(`cbt_pos_${sessionId}`);
    onFinish(r.data || {});
  }, [answers, sessionId, onFinish]);

  const changeFontSize = (d: number) => { const n = Math.max(12, Math.min(24, fontSize + d)); setFontSize(n); localStorage.setItem(`cbt_font_${sessionId}`, String(n)); };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner size={28} /></div>;
  const q = questions[current]; if (!q) return null;
  const ans = answers.get(q.id);
  const answeredCount = Array.from(answers.values()).filter(a => a.selected_option_id || a.essay_answer).length;
  const doubtCount = Array.from(answers.values()).filter(a => a.is_doubtful).length;
  const mm = Math.floor(timeLeft / 60); const ss = timeLeft % 60;
  const urgent = timeLeft < 300;

  return (
    <div className="min-h-screen bg-gray-50 no-select flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100 px-3 py-2">
        <div className="flex items-center justify-between gap-2 max-w-3xl mx-auto">
          <div className={`flex items-center gap-1.5 font-mono font-bold text-sm tabular-nums ${urgent ? 'text-red-600' : 'text-gray-800'}`}>
            <Clock size={14} strokeWidth={2.5} />{String(mm).padStart(2,'0')}:{String(ss).padStart(2,'0')}</div>
          <span className="text-[11px] text-gray-400">{answeredCount}/{questions.length}</span>
          <div className="flex items-center gap-0.5">
            <button onClick={() => changeFontSize(-2)} className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100"><Minus size={13} /></button>
            <button onClick={() => changeFontSize(2)} className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100"><Plus size={13} /></button>
          </div>
          <button onClick={() => setShowGrid(true)} className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200">
            <Grid3x3 size={13} /> {current + 1}/{questions.length}</button>
        </div>
      </header>

      {cheatMsg && <div className="sticky top-[52px] z-30 bg-red-600 text-white text-xs font-medium text-center py-2 px-4 fade-in flex items-center justify-center gap-1.5"><AlertTriangle size={13} /> {cheatMsg}</div>}

      {/* Question */}
      <main className="flex-1 px-3 py-3 max-w-3xl mx-auto w-full">
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-50 bg-gray-50/50">
            <span className="text-xs font-medium text-gray-500">Soal {current + 1}</span>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={!!ans?.is_doubtful} onChange={e => setAnswer(q.id, { is_doubtful: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-gray-300 text-amber-500 focus:ring-amber-500" /><span className="text-xs text-amber-600 font-medium">Ragu-ragu</span></label>
          </div>
          <div className="px-4 py-3 exam-text" style={{ '--exam-font-size': `${fontSize}px` } as any} dangerouslySetInnerHTML={{ __html: q.question_text }} />
          {q.image_url && <div className="px-4 pb-3"><img src={`${API_URL}${q.image_url}`} alt="" className="max-w-full rounded-lg border border-gray-100" /></div>}
          {q.audio_url && <div className="px-4 pb-3"><audio controls controlsList="nodownload" preload="auto"><source src={`${API_URL}${q.audio_url}`} /></audio></div>}
          {q.question_type === 'multiple_choice' ? (
            <div className="px-4 pb-4 space-y-2">{q.options.map(o => {
              const sel = ans?.selected_option_id === o.id;
              return <button key={o.id} onClick={() => setAnswer(q.id, { selected_option_id: o.id })}
                className={`w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border transition text-sm
                  ${sel ? 'bg-primary-50 border-primary-500 ring-1 ring-primary-500/30' : 'bg-white border-gray-200 hover:border-gray-300'}`}>
                <span className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-bold border-2 mt-0.5
                  ${sel ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300 text-gray-400'}`}>{o.option_label}</span>
                <span className="flex-1" style={{ fontSize: `${fontSize}px` }}>
                  {o.image_url ? <img src={`${API_URL}${o.image_url}`} alt={o.option_label} className="max-w-full rounded" />
                   : <span dangerouslySetInnerHTML={{ __html: o.option_text }} />}</span>
              </button>; })}</div>
          ) : (
            <div className="px-4 pb-4"><textarea value={ans?.essay_answer || ''} onChange={e => setAnswer(q.id, { essay_answer: e.target.value })}
              placeholder="Tulis jawaban..." rows={5} style={{ fontSize: `${fontSize}px` }}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none" /></div>
          )}
        </div>
      </main>

      {/* Bottom nav */}
      <div className="sticky bottom-0 z-40 bg-white border-t border-gray-100 px-3 py-2">
        <div className="flex items-center justify-between gap-2 max-w-3xl mx-auto">
          <button onClick={() => goTo(Math.max(0, current - 1))} disabled={current === 0}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-gray-500 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-30">
            <ChevronLeft size={14} /> Sebelumnya</button>
          {current < questions.length - 1
            ? <button onClick={() => goTo(current + 1)} className="flex items-center gap-1 px-4 py-2 text-xs font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700">Selanjutnya <ChevronRight size={14} /></button>
            : <button onClick={() => setShowConfirm(true)} className="flex items-center gap-1 px-4 py-2 text-xs font-medium text-white bg-sky-600 rounded-lg hover:bg-sky-700">Kumpulkan <Send size={13} /></button>}
        </div>
      </div>

      {/* Grid */}
      <Modal open={showGrid} onClose={() => setShowGrid(false)} title="Navigasi Soal">
        <div className="mb-3 flex gap-4 text-[11px] text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary-500" /> Dijawab</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Ragu</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-200" /> Belum</span>
        </div>
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
          {questions.map((qq, i) => { const a = answers.get(qq.id); const answered = !!(a?.selected_option_id || a?.essay_answer); const doubt = !!a?.is_doubtful;
            let bg = 'bg-gray-100 text-gray-500'; if (doubt) bg = 'bg-amber-400 text-white'; else if (answered) bg = 'bg-primary-500 text-white';
            return <button key={qq.id} onClick={() => goTo(i)} className={`aspect-square flex items-center justify-center text-xs font-semibold rounded-lg transition ${bg} ${i === current ? 'ring-2 ring-gray-800 ring-offset-1' : 'hover:scale-105'}`}>{i + 1}</button>;
          })}
        </div>
        <div className="mt-4 pt-3 border-t border-gray-100 text-center"><Button size="sm" onClick={() => { setShowGrid(false); setShowConfirm(true); }}><Send size={13} /> Kumpulkan Ujian</Button></div>
      </Modal>

      {/* Confirm submit */}
      <Modal open={showConfirm} onClose={() => { setShowConfirm(false); submittedRef.current = false; }} title="Kumpulkan Ujian?" size="sm">
        <div className="grid grid-cols-3 gap-3 text-center mb-4">
          <div className="p-3 bg-primary-50 rounded-lg"><p className="text-xl font-bold text-primary-700">{answeredCount}</p><p className="text-[11px] text-primary-600">Dijawab</p></div>
          <div className="p-3 bg-gray-50 rounded-lg"><p className="text-xl font-bold text-gray-600">{questions.length - answeredCount}</p><p className="text-[11px] text-gray-500">Belum</p></div>
          <div className="p-3 bg-amber-50 rounded-lg"><p className="text-xl font-bold text-amber-600">{doubtCount}</p><p className="text-[11px] text-amber-500">Ragu</p></div>
        </div>
        <p className="text-xs text-gray-400 text-center mb-4">Setelah dikumpulkan, jawaban tidak dapat diubah.</p>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" size="sm" onClick={() => { setShowConfirm(false); submittedRef.current = false; }}>Kembali</Button>
          <Button size="sm" loading={submitting} onClick={() => handleSubmit()}>Ya, Kumpulkan</Button>
        </div>
      </Modal>
    </div>
  );
}
