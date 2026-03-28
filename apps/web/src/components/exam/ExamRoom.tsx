'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Modal, Spinner } from '@/components/ui';
import { Clock, ChevronLeft, ChevronRight, Minus, Plus, Send, AlertTriangle } from 'lucide-react';

interface Question {
  index: number; id: string; question_text: string; question_type: string;
  image_url: string | null; audio_url: string | null;
  options: { id: string; option_label: string; option_text: string; image_url: string | null }[];
}
interface Answer { question_id: string; selected_option_id?: string; essay_answer?: string; is_doubtful?: boolean }
interface ExamRoomProps { sessionId: string; startedAt: string; durationMinutes: number; onFinish: (result: any) => void }

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

const C = {
  bg: '#f4f6f4', white: '#fff', border: '#e0e5e0', borderLight: '#edf0ed', borderMid: '#d4dbd4',
  text: '#1e2e22', textMid: '#4a6655', textMuted: '#8a9e8d', textFaint: '#a8b9aa',
  green: '#2d7a4f', greenLight: '#e2ebe3', greenBorder: '#b5d9c4',
};

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

  // Load questions + saved answers
  useEffect(() => {
    const saved = localStorage.getItem(`cbt_font_${sessionId}`);
    if (saved) setFontSize(parseInt(saved));
    GET<{ questions: Question[]; answers: any[] }>(`/api/student/sessions/${sessionId}/questions`).then(r => {
      if (r.success && r.data) {
        setQuestions(r.data.questions);
        const m = new Map<string, Answer>();
        for (const a of r.data.answers || [])
          m.set(a.question_id, { question_id: a.question_id, selected_option_id: a.selected_option_id, essay_answer: a.essay_answer, is_doubtful: !!a.is_doubtful });
        const local = localStorage.getItem(`cbt_answers_${sessionId}`);
        if (local) { try { for (const a of JSON.parse(local) as Answer[]) m.set(a.question_id, a); } catch {} }
        setAnswers(m);
        const pos = localStorage.getItem(`cbt_pos_${sessionId}`);
        if (pos) setCurrent(parseInt(pos) || 0);
      }
      setLoading(false);
    });
  }, [sessionId]);

  // Countdown timer
  useEffect(() => {
    const end = new Date(startedAt).getTime() + durationMinutes * 60 * 1000;
    const tick = () => {
      const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0 && !submittedRef.current) handleSubmit(true);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [startedAt, durationMinutes]);

  // Auto-sync answers + heartbeat (cek time_locked dari server)
  useEffect(() => {
    const s = setInterval(() => flushAnswers(), 15000);
    const h = setInterval(async () => {
      const r = await POST(`/api/student/sessions/${sessionId}/heartbeat`);
      if (r.data?.time_locked && !submittedRef.current) {
        setCheatMsg('Waktu ujian Anda telah berakhir. Ujian dikunci oleh sistem.');
        submittedRef.current = true; // prevent further actions
      }
    }, 15000);
    return () => { clearInterval(s); clearInterval(h); };
  }, [sessionId]);

  const flushAnswers = useCallback(async () => {
    if (dirtyRef.current.size === 0) return;
    const batch: Answer[] = [];
    dirtyRef.current.forEach(qId => { const a = answers.get(qId); if (a) batch.push(a); });
    const ids = new Set(dirtyRef.current);
    dirtyRef.current.clear();
    const r = await POST(`/api/student/sessions/${sessionId}/answers`, { answers: batch });
    if (!r.success) ids.forEach(id => dirtyRef.current.add(id));
  }, [answers, sessionId]);

  // Anti-cheat
  useEffect(() => {
    const vis = () => {
      if (document.hidden && !submittedRef.current) {
        const n = cheatCount + 1;
        setCheatCount(n);
        POST(`/api/student/sessions/${sessionId}/cheat`);
        if (n >= 3) { setCheatMsg('3x pelanggaran — ujian otomatis dikirim.'); handleSubmit(true); }
        else { setCheatMsg(`Peringatan ${n}/3: Jangan tinggalkan halaman ujian!`); setTimeout(() => setCheatMsg(''), 4000); }
      }
    };
    const ctx = (e: MouseEvent) => e.preventDefault();
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && ['c','v','a','x','u','s','p'].includes(e.key.toLowerCase())) e.preventDefault(); };
    document.addEventListener('visibilitychange', vis);
    document.addEventListener('contextmenu', ctx);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      document.removeEventListener('contextmenu', ctx);
      document.removeEventListener('keydown', key);
    };
  }, [cheatCount, sessionId]);

  const setAnswer = useCallback((qId: string, update: Partial<Answer>) => {
    setAnswers(prev => {
      const m = new Map(prev);
      const ex = m.get(qId) || { question_id: qId };
      m.set(qId, { ...ex, ...update });
      localStorage.setItem(`cbt_answers_${sessionId}`, JSON.stringify(Array.from(m.values())));
      dirtyRef.current.add(qId);
      return m;
    });
  }, [sessionId]);

  const goTo = useCallback((i: number) => {
    setCurrent(i);
    setShowGrid(false);
    localStorage.setItem(`cbt_pos_${sessionId}`, String(i));
    window.scrollTo(0, 0);
  }, [sessionId]);

  const handleSubmit = useCallback(async (force = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setShowConfirm(false);
    const batch = Array.from(answers.values());
    if (batch.length) await POST(`/api/student/sessions/${sessionId}/answers`, { answers: batch });
    const r = await POST(`/api/student/sessions/${sessionId}/submit`);
    localStorage.removeItem(`cbt_answers_${sessionId}`);
    localStorage.removeItem(`cbt_pos_${sessionId}`);
    onFinish(r.data || {});
  }, [answers, sessionId, onFinish]);

  const changeFontSize = (d: number) => {
    const n = Math.max(12, Math.min(24, fontSize + d));
    setFontSize(n);
    localStorage.setItem(`cbt_font_${sessionId}`, String(n));
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
      <Spinner size={28} />
    </div>
  );

  const q = questions[current];
  if (!q) return null;
  const ans = answers.get(q.id);
  const answeredCount = Array.from(answers.values()).filter(a => a.selected_option_id || a.essay_answer).length;
  const doubtCount = Array.from(answers.values()).filter(a => a.is_doubtful).length;
  const mm = Math.floor(timeLeft / 60);
  const ss = timeLeft % 60;
  const urgent = timeLeft < 300;
  const isLast = current === questions.length - 1;

  return (
    <div className="no-select" style={{ minHeight: '100vh', background: C.bg, display: 'flex', flexDirection: 'column', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>

      {/* ── HEADER ── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 40, background: C.white, borderBottom: `1.5px solid ${C.border}` }}>
        <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', maxWidth: '680px', margin: '0 auto' }}>

          {/* timer pill */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0,
            background: urgent ? '#fef2f2' : C.greenLight,
            border: `1.5px solid ${urgent ? '#fecaca' : C.greenBorder}`,
            padding: '6px 12px', borderRadius: '10px',
          }}>
            <Clock size={13} strokeWidth={2.5} color={urgent ? '#dc2626' : C.green} />
            <span style={{ fontFamily: 'monospace', fontSize: '14px', fontWeight: 900, color: urgent ? '#dc2626' : C.text, letterSpacing: '0.05em' }}>
              {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
            </span>
          </div>

          {/* progress */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: C.textMid }}>{answeredCount} / {questions.length}</span>
              <span style={{ fontSize: '10px', color: C.textFaint }}>dijawab</span>
            </div>
            <div style={{ height: '5px', background: '#e0e5e0', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{ height: '100%', background: C.green, borderRadius: '999px', width: `${(answeredCount / questions.length) * 100}%`, transition: 'width 0.3s' }} />
            </div>
          </div>

          {/* font controls */}
          <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
            <button onClick={() => changeFontSize(-2)} style={{ width: '28px', height: '28px', borderRadius: '8px', background: C.bg, border: `1.5px solid ${C.borderMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <Minus size={11} strokeWidth={2.5} color="#6b7c6e" />
            </button>
            <button onClick={() => changeFontSize(2)} style={{ width: '28px', height: '28px', borderRadius: '8px', background: C.bg, border: `1.5px solid ${C.borderMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <Plus size={11} strokeWidth={2.5} color="#6b7c6e" />
            </button>
          </div>
        </div>
      </header>

      {/* ── CHEAT WARNING ── */}
      {cheatMsg && (
        <div className="fade-in" style={{ background: '#dc2626', padding: '9px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', position: 'sticky', top: '53px', zIndex: 39 }}>
          <AlertTriangle size={13} color="#fff" strokeWidth={2.5} />
          <span style={{ color: '#fff', fontSize: '12px', fontWeight: 700 }}>{cheatMsg}</span>
        </div>
      )}

      {/* ── QUESTION ── */}
      <main style={{ flex: 1, padding: '12px', maxWidth: '680px', width: '100%', margin: '0 auto', paddingBottom: '80px' }}>
        <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '18px', overflow: 'hidden' }}>

          {/* soal header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1.5px solid ${C.borderLight}`, background: '#f9fbf9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span style={{ background: C.greenLight, color: '#2d6644', fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px' }}>
                Soal {current + 1}
              </span>
              <span style={{ color: C.textFaint, fontSize: '10px' }}>
                {q.question_type === 'multiple_choice' ? 'Pilihan Ganda' : 'Esai'}
              </span>
            </div>

            {/* ragu-ragu toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <div style={{ position: 'relative', width: '32px', height: '18px', borderRadius: '999px', background: ans?.is_doubtful ? '#f59e0b' : '#e0e5e0', transition: 'background 0.2s', flexShrink: 0 }}
                onClick={() => setAnswer(q.id, { is_doubtful: !ans?.is_doubtful })}>
                <div style={{ position: 'absolute', top: '2px', left: ans?.is_doubtful ? '16px' : '2px', width: '14px', height: '14px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', transition: 'left 0.2s' }} />
              </div>
              <span style={{ fontSize: '11px', fontWeight: 600, color: ans?.is_doubtful ? '#b45309' : C.textFaint }}>Ragu</span>
            </label>
          </div>

          {/* soal text */}
          <div className="exam-text" style={{ padding: '16px 14px 12px', color: C.text, lineHeight: 1.75, '--exam-font-size': `${fontSize}px` } as any}
            dangerouslySetInnerHTML={{ __html: q.question_text }} />

          {/* media */}
          {q.image_url && (
            <div style={{ padding: '0 14px 12px' }}>
              <img src={`${API_URL}${q.image_url}`} alt="" style={{ maxWidth: '100%', borderRadius: '10px', border: `1px solid ${C.borderLight}` }} />
            </div>
          )}
          {q.audio_url && (
            <div style={{ padding: '0 14px 12px' }}>
              <audio controls controlsList="nodownload" preload="auto" style={{ width: '100%' }}>
                <source src={`${API_URL}${q.audio_url}`} />
              </audio>
            </div>
          )}

          {/* options */}
          {q.question_type === 'multiple_choice' ? (
            <div style={{ padding: '0 14px 16px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {q.options.map(o => {
                const sel = ans?.selected_option_id === o.id;
                return (
                  <button key={o.id} onClick={() => setAnswer(q.id, { selected_option_id: o.id })}
                    style={{
                      width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: '10px',
                      padding: '11px 12px', borderRadius: '12px', cursor: 'pointer',
                      border: `1.5px solid ${sel ? C.green : C.borderMid}`,
                      background: sel ? C.greenLight : C.white,
                      transition: 'all 0.12s',
                    }}>
                    <span style={{
                      width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: 800, marginTop: '1px',
                      background: sel ? C.green : C.bg,
                      border: `2px solid ${sel ? C.green : C.borderMid}`,
                      color: sel ? '#fff' : C.textMuted,
                    }}>{o.option_label}</span>
                    <span style={{ flex: 1, fontSize: `${fontSize}px`, color: C.text, fontWeight: 500, paddingTop: '2px' }}>
                      {o.image_url
                        ? <img src={`${API_URL}${o.image_url}`} alt={o.option_label} style={{ maxWidth: '100%', borderRadius: '8px' }} />
                        : <span dangerouslySetInnerHTML={{ __html: o.option_text }} />}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '0 14px 16px' }}>
              <textarea value={ans?.essay_answer || ''} onChange={e => setAnswer(q.id, { essay_answer: e.target.value })}
                placeholder="Tulis jawaban..." rows={5}
                style={{ width: '100%', padding: '10px 12px', fontSize: `${fontSize}px`, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', outline: 'none', resize: 'none', color: C.text, background: C.bg, fontFamily: 'inherit' }}
                onFocus={e => { e.target.style.borderColor = C.green; e.target.style.boxShadow = '0 0 0 3px rgba(45,122,79,0.1)'; }}
                onBlur={e => { e.target.style.borderColor = C.borderMid; e.target.style.boxShadow = 'none'; }} />
            </div>
          )}
        </div>
      </main>

      {/* ── FLOATING GRID BUTTON ── */}
      <button onClick={() => setShowGrid(true)}
        style={{
          position: 'fixed', bottom: '70px', right: '16px', zIndex: 38,
          width: '48px', height: '48px', borderRadius: '14px',
          background: C.green, border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 14px rgba(45,122,79,0.35)',
        }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
        </svg>
      </button>

      {/* ── BOTTOM NAV ── */}
      <div style={{ position: 'sticky', bottom: 0, zIndex: 40, background: C.white, borderTop: `1.5px solid ${C.border}`, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', maxWidth: '680px', margin: '0 auto' }}>
          <button onClick={() => goTo(Math.max(0, current - 1))} disabled={current === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '10px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: 700, background: C.bg, color: C.textMid, border: `1.5px solid ${C.borderMid}`, cursor: current === 0 ? 'not-allowed' : 'pointer', opacity: current === 0 ? 0.35 : 1 }}>
            <ChevronLeft size={14} strokeWidth={2.5} /> Sebelumnya
          </button>

          {isLast ? (
            <button onClick={() => setShowConfirm(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '10px 20px', borderRadius: '12px', fontSize: '13px', fontWeight: 800, background: '#1a5fa8', color: '#fff', border: 'none', cursor: 'pointer' }}>
              <Send size={13} strokeWidth={2.5} /> Kirim
            </button>
          ) : (
            <button onClick={() => goTo(current + 1)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '10px 16px', borderRadius: '12px', fontSize: '13px', fontWeight: 700, background: C.green, color: '#fff', border: 'none', cursor: 'pointer' }}>
              Selanjutnya <ChevronRight size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* ── MODAL: GRID NAVIGASI ── */}
      <Modal open={showGrid} onClose={() => setShowGrid(false)} title="Navigasi Soal">
        {/* legend */}
        <div style={{ display: 'flex', gap: '14px', marginBottom: '14px', flexWrap: 'wrap' }}>
          {[
            { color: C.green,   label: 'Dijawab' },
            { color: '#f59e0b', label: 'Ragu'    },
            { color: '#e8eae8', label: 'Belum', textColor: C.textMuted },
          ].map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', fontWeight: 600, color: C.textMuted }}>
              <span style={{ width: '11px', height: '11px', borderRadius: '4px', background: l.color, display: 'inline-block', flexShrink: 0 }} />
              {l.label}
            </span>
          ))}
        </div>

        {/* grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '6px', marginBottom: '16px' }}>
          {questions.map((qq, i) => {
            const a = answers.get(qq.id);
            const answered = !!(a?.selected_option_id || a?.essay_answer);
            const doubt = !!a?.is_doubtful;
            const isCurrent = i === current;
            let bg = '#e8eae8'; let color = C.textMuted;
            if (doubt)    { bg = '#f59e0b'; color = '#fff'; }
            else if (answered) { bg = C.green;   color = '#fff'; }
            return (
              <button key={qq.id} onClick={() => goTo(i)}
                style={{
                  aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', fontWeight: 700, borderRadius: '10px', border: 'none',
                  background: isCurrent ? C.greenLight : bg,
                  color: isCurrent ? C.green : color,
                  outline: isCurrent ? `2.5px solid ${C.green}` : 'none',
                  outlineOffset: '1px',
                  cursor: 'pointer',
                }}>
                {i + 1}
              </button>
            );
          })}
        </div>

        {/* kirim button */}
        <div style={{ borderTop: `1.5px solid ${C.borderLight}`, paddingTop: '14px' }}>
          <button onClick={() => { setShowGrid(false); setShowConfirm(true); }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1a5fa8', color: '#fff', border: 'none', padding: '13px 18px', borderRadius: '14px', cursor: 'pointer' }}>
            <span style={{ fontSize: '14px', fontWeight: 800 }}>Kirim Ujian</span>
            <span style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.15)', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Send size={15} color="#fff" strokeWidth={2.5} />
            </span>
          </button>
        </div>
      </Modal>

      {/* ── MODAL: KONFIRMASI KIRIM ── */}
      <Modal open={showConfirm} onClose={() => { setShowConfirm(false); submittedRef.current = false; }} title="Kirim Ujian?" size="sm">
        <p style={{ color: C.textMuted, fontSize: '12.5px', marginBottom: '16px', lineHeight: 1.5 }}>
          Setelah dikirim, jawaban tidak dapat diubah.
        </p>

        {/* stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px', marginBottom: '18px' }}>
          <div style={{ background: C.greenLight, borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
            <p style={{ color: C.green, fontSize: '24px', fontWeight: 900, lineHeight: 1 }}>{answeredCount}</p>
            <p style={{ color: '#4a9068', fontSize: '10.5px', fontWeight: 700, marginTop: '3px' }}>Dijawab</p>
          </div>
          <div style={{ background: C.bg, borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
            <p style={{ color: '#6b7c6e', fontSize: '24px', fontWeight: 900, lineHeight: 1 }}>{questions.length - answeredCount}</p>
            <p style={{ color: C.textMuted, fontSize: '10.5px', fontWeight: 700, marginTop: '3px' }}>Belum</p>
          </div>
          <div style={{ background: '#fffbeb', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
            <p style={{ color: '#b45309', fontSize: '24px', fontWeight: 900, lineHeight: 1 }}>{doubtCount}</p>
            <p style={{ color: '#d97706', fontSize: '10.5px', fontWeight: 700, marginTop: '3px' }}>Ragu</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { setShowConfirm(false); submittedRef.current = false; }}
            style={{ flex: 1, padding: '12px', fontSize: '13px', fontWeight: 700, color: C.textMid, background: C.bg, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', cursor: 'pointer' }}>
            Kembali
          </button>
          <button onClick={() => handleSubmit()} disabled={submitting}
            style={{ flex: 1, padding: '12px', fontSize: '13px', fontWeight: 800, color: '#fff', background: '#1a5fa8', border: 'none', borderRadius: '12px', cursor: 'pointer', opacity: submitting ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            {submitting ? <Spinner size={14} /> : null} Ya, Kirim
          </button>
        </div>
      </Modal>
    </div>
  );
}
