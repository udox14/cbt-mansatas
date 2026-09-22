'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { GET } from '@/lib/api';
import { Button, Spinner } from '@/components/ui';
import { exportExamAnalytics } from '@/lib/export';
import { FileDown } from 'lucide-react';
import { C, parseServerTime, sessionFilterKey, sessionFilterLabel, buildSessionFilters } from '../components/theme';
import TableHead from '../components/TableHead';

export function AnalyticsView({ examId, apiPrefix = '/api/admin' }: { examId: string; apiPrefix?: string }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [questionAnalytics, setQuestionAnalytics] = useState<any>({ questions: [], options: [], rows: [] });
  const [loading, setLoading] = useState(true);
  const [filterRoom, setFilterRoom] = useState('all');
  const [filterSession, setFilterSession] = useState('all');
  const [analyticsTab, setAnalyticsTab] = useState<'ringkasan' | 'nilai' | 'pelanggaran' | 'soal' | 'sesi'>('ringkasan');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      GET(`${apiPrefix}/exams/${examId}/sessions`),
      GET(`${apiPrefix}/exams/${examId}/results`),
      GET(`${apiPrefix}/exams/${examId}/question-analytics`),
    ])
      .then(([s, r, q]) => {
        if (s.success) setSessions(s.data || []);
        if (r.success) setResults(r.data || []);
        if (q.success) setQuestionAnalytics(q.data || { questions: [], options: [], rows: [] });
      })
      .finally(() => setLoading(false));
  }, [examId, apiPrefix]);

  const rooms = useMemo(() => Array.from(new Set([...sessions, ...results].map((x: any) => x.room_name).filter(Boolean))).sort(), [sessions, results]);
  const sessionOptions = useMemo(() => buildSessionFilters([...sessions, ...results]), [sessions, results]);
  const filteredSessions = sessions.filter((s: any) => {
    if (filterSession !== 'all' && sessionFilterKey(s) !== filterSession) return false;
    if (filterRoom !== 'all' && s.room_name !== filterRoom) return false;
    return true;
  });
  const filteredResults = results.filter((r: any) => {
    if (filterSession !== 'all' && sessionFilterKey(r) !== filterSession) return false;
    if (filterRoom !== 'all' && r.room_name !== filterRoom) return false;
    return true;
  });

  const submittedIds = new Set(filteredResults.map((r: any) => r.session_id));
  const started = filteredSessions.length;
  const finished = filteredSessions.filter((s: any) => s.status === 'submitted' || submittedIds.has(s.id)).length;
  const locked = filteredSessions.filter((s: any) => Number(s.is_time_locked) === 1 && s.status !== 'submitted').length;
  const totalViolations = filteredSessions.reduce((sum: number, s: any) => sum + Number(s.cheat_log_count || s.cheat_warnings || 0), 0);
  const avgScore = filteredResults.length ? Math.round(filteredResults.reduce((sum: number, r: any) => sum + Number(r.score || 0), 0) / filteredResults.length) : 0;
  const scores = filteredResults.map((r: any) => Number(r.score || 0));
  const maxScore = scores.length ? Math.max(...scores) : 0;
  const minScore = scores.length ? Math.min(...scores) : 0;
  const totalCorrect = filteredResults.reduce((sum: number, r: any) => sum + Number(r.total_correct || 0), 0);
  const totalWrong = filteredResults.reduce((sum: number, r: any) => sum + Number(r.total_wrong || 0), 0);
  const totalUnanswered = filteredResults.reduce((sum: number, r: any) => sum + Number(r.total_unanswered || 0), 0);

  const scoreBuckets = [
    { label: '0-40', count: scores.filter(score => score <= 40).length },
    { label: '41-60', count: scores.filter(score => score > 40 && score <= 60).length },
    { label: '61-75', count: scores.filter(score => score > 60 && score <= 75).length },
    { label: '76-90', count: scores.filter(score => score > 75 && score <= 90).length },
    { label: '91-100', count: scores.filter(score => score > 90).length },
  ];
  const maxBucket = Math.max(1, ...scoreBuckets.map(b => b.count));
  const topScorers = [...filteredResults]
    .sort((a: any, b: any) => Number(b.score || 0) - Number(a.score || 0) || String(a.full_name || '').localeCompare(String(b.full_name || '')))
    .slice(0, 10);

  const resultGroups = filteredResults.reduce((map: Map<string, number[]>, r: any) => {
    const key = `${sessionFilterKey(r)}|${r.room_name || 'Tanpa ruangan'}`;
    const list = map.get(key) || [];
    list.push(Number(r.score || 0));
    map.set(key, list);
    return map;
  }, new Map());
  const roomSessionRows = Array.from(filteredSessions.reduce((map: Map<string, any>, s: any) => {
    const key = `${sessionFilterKey(s)}|${s.room_name || 'Tanpa ruangan'}`;
    const row = map.get(key) || { key, label: sessionFilterLabel(s), room: s.room_name || 'Tanpa ruangan', peserta: 0, selesai: 0, dikunci: 0, pelanggaran: 0 };
    row.peserta += 1;
    if (s.status === 'submitted' || submittedIds.has(s.id)) row.selesai += 1;
    if (Number(s.is_time_locked) === 1 && s.status !== 'submitted') row.dikunci += 1;
    row.pelanggaran += Number(s.cheat_log_count || s.cheat_warnings || 0);
    map.set(key, row);
    return map;
  }, new Map()).values()).map((row: any) => {
    const scoresForRow = resultGroups.get(row.key) || [];
    return { ...row, rata: scoresForRow.length ? Math.round(scoresForRow.reduce((a: number, b: number) => a + b, 0) / scoresForRow.length) : 0 };
  }).sort((a: any, b: any) => `${a.label} ${a.room}`.localeCompare(`${b.label} ${b.room}`));

  const topViolations = filteredSessions
    .map((s: any) => ({ ...s, total: Number(s.cheat_log_count || s.cheat_warnings || 0) }))
    .filter((s: any) => s.total > 0)
    .sort((a: any, b: any) => b.total - a.total)
    .slice(0, 5);

  const qaRows = (questionAnalytics.rows || []).filter((row: any) => {
    if (filterSession !== 'all' && sessionFilterKey(row) !== filterSession) return false;
    if (filterRoom !== 'all' && row.room_name !== filterRoom) return false;
    return true;
  });
  const sessionCount = new Set(qaRows.map((row: any) => row.session_id)).size;
  const optionCounts = qaRows.reduce((map: Map<string, number>, row: any) => {
    if (row.selected_option_id) map.set(row.selected_option_id, (map.get(row.selected_option_id) || 0) + 1);
    return map;
  }, new Map());
  const questionRows = (questionAnalytics.questions || []).map((q: any) => {
    const rows = qaRows.filter((row: any) => row.question_id === q.id);
    const answered = rows.filter((row: any) => Number(row.answered) === 1).length;
    const correct = rows.filter((row: any) => Number(row.is_correct) === 1).length;
    const blank = Math.max(0, sessionCount - answered);
    const wrong = Math.max(0, answered - correct);
    const correctRate = sessionCount ? Math.round((correct / sessionCount) * 100) : 0;
    const difficulty = correctRate >= 76 ? 'Mudah' : correctRate >= 41 ? 'Sedang' : 'Sulit';
    const flag = sessionCount === 0
      ? 'Belum ada data'
      : correctRate <= 20
        ? 'Perlu review'
        : blank / Math.max(1, sessionCount) >= 0.3
          ? 'Banyak kosong'
          : '';
    const options = (questionAnalytics.options || [])
      .filter((option: any) => option.question_id === q.id)
      .map((option: any) => ({ ...option, count: optionCounts.get(option.id) || 0 }));
    return {
      ...q,
      answered_count: answered,
      correct_count: correct,
      wrong_count: wrong,
      blank_count: blank,
      correct_rate: correctRate,
      difficulty,
      flag,
      options,
    };
  });
  const hardQuestions = questionRows
    .filter((q: any) => q.question_type === 'multiple_choice' && sessionCount > 0)
    .sort((a: any, b: any) => a.correct_rate - b.correct_rate)
    .slice(0, 5);
  const suspiciousQuestions = questionRows.filter((q: any) => q.flag).slice(0, 6);
  const avgDuration = (() => {
    const durations = filteredSessions
      .map((s: any) => {
        if (!s.started_at || !s.finished_at) return 0;
        const diff = parseServerTime(s.finished_at) - parseServerTime(s.started_at);
        return diff > 0 ? Math.round(diff / 60000) : 0;
      })
      .filter(Boolean);
    return durations.length ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length) : 0;
  })();

  const statStyle = (accent: string = C.greenLight) => ({ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px', boxShadow: `inset 0 4px 0 ${accent}` });
  const statText = { color: C.text, fontSize: '24px', fontWeight: 900, lineHeight: 1 };
  const statLabel = { color: C.textMuted, fontSize: '11px', marginTop: '6px', fontWeight: 700 };
  const analyticsTabs: { key: typeof analyticsTab; label: string }[] = [
    { key: 'ringkasan', label: 'Ringkasan' },
    { key: 'nilai', label: 'Nilai' },
    { key: 'pelanggaran', label: 'Pelanggaran' },
    { key: 'soal', label: 'Soal' },
    { key: 'sesi', label: 'Sesi/Ruangan' },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Analitik Ujian</span>
          <p style={{ color: C.textFaint, fontSize: '11px', marginTop: '2px' }}>Ringkasan progres, nilai, pelanggaran, dan performa sesi/ruangan.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {sessionOptions.length > 1 && (
            <select value={filterSession} onChange={e => setFilterSession(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer', maxWidth: '240px' }}>
              <option value="all">Semua Sesi</option>
              {sessionOptions.map((s: any) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
          {rooms.length > 1 && (
            <select value={filterRoom} onChange={e => setFilterRoom(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer' }}>
              <option value="all">Semua Ruangan</option>
              {rooms.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          {questionRows.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => exportExamAnalytics(questionRows, `ujian-${examId}`)}>
              <FileDown size={13} /> Export Analitik
            </Button>
          )}
        </div>
      </div>

      <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', padding: '0 10px', display: 'flex', gap: '4px', overflowX: 'auto' }}>
        {analyticsTabs.map(tab => (
          <button key={tab.key} onClick={() => setAnalyticsTab(tab.key)}
            style={{
              padding: '10px 12px 9px',
              fontSize: '11.5px',
              fontWeight: analyticsTab === tab.key ? 900 : 700,
              color: analyticsTab === tab.key ? C.green : C.textMuted,
              background: 'none',
              border: 'none',
              borderBottom: `2.5px solid ${analyticsTab === tab.key ? C.green : 'transparent'}`,
              marginBottom: '-1.5px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))', gap: '10px' }}>
              {[
                ['Peserta', started, C.greenLight],
                ['Selesai', finished, '#eef2ff'],
                ['Belum Selesai', Math.max(0, started - finished), '#f1f1f0'],
                ['Dikunci', locked, '#fffbeb'],
                ['Pelanggaran', totalViolations, '#fef2f2'],
                ['Rata-rata', avgScore, C.greenLight],
                ['Durasi Avg', `${avgDuration}m`, '#e0f0ff'],
              ].map(([label, value, color]) => (
                <div key={String(label)} style={statStyle(String(color))}>
                  <p style={statText}>{value}</p>
                  <p style={statLabel}>{label}</p>
                </div>
              ))}
            </div>

            {analyticsTab === 'nilai' && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Distribusi Nilai</p>
                <div className="space-y-2">
                  {scoreBuckets.map(bucket => (
                    <div key={bucket.label} style={{ display: 'grid', gridTemplateColumns: '52px 1fr 34px', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: C.textMuted, fontSize: '11px', fontWeight: 700 }}>{bucket.label}</span>
                      <div style={{ height: '9px', borderRadius: '999px', background: '#edf0ed', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round((bucket.count / maxBucket) * 100)}%`, height: '100%', background: C.green, borderRadius: '999px' }} />
                      </div>
                      <span style={{ color: C.text, fontSize: '11px', fontWeight: 800, textAlign: 'right' }}>{bucket.count}</span>
                    </div>
                  ))}
                </div>
                <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '12px' }}>Tertinggi {maxScore} - Terendah {minScore} - Rata-rata {avgScore}</p>
              </div>

              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Top Siswa Nilai Tertinggi</p>
                {topScorers.length === 0
                  ? <p style={{ color: C.textFaint, fontSize: '12px' }}>Belum ada nilai pada filter ini.</p>
                  : topScorers.map((r: any, i: number) => (
                    <div key={r.session_id || `${r.user_id}-${i}`} style={{ display: 'grid', gridTemplateColumns: '34px 1fr auto', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: i < topScorers.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                      <span style={{ width: '26px', height: '26px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: i < 3 ? C.green : '#edf0ed', color: i < 3 ? C.white : C.textMuted, fontSize: '11px', fontWeight: 900 }}>{i + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ color: C.text, fontSize: '12px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.full_name}</p>
                        <p style={{ color: C.textFaint, fontSize: '10.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nisn || 'Tanpa NISN'} - {sessionFilterLabel(r)} - {r.room_name || 'Tanpa ruangan'}</p>
                      </div>
                      <span style={{ color: C.green, fontSize: '18px', fontWeight: 900 }}>{Number(r.score || 0)}</span>
                    </div>
                  ))}
              </div>
            </div>
            )}

            {analyticsTab === 'pelanggaran' && (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
              <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Pelanggaran Terbanyak</p>
              {topViolations.length === 0
                ? <p style={{ color: C.textFaint, fontSize: '12px' }}>Belum ada pelanggaran pada filter ini.</p>
                : topViolations.map((s: any) => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${C.borderLight}` }}>
                    <div>
                      <p style={{ color: C.text, fontSize: '12px', fontWeight: 800 }}>{s.full_name}</p>
                      <p style={{ color: C.textFaint, fontSize: '10.5px' }}>{sessionFilterLabel(s)} - {s.room_name}</p>
                    </div>
                    <span style={{ color: '#dc2626', fontSize: '13px', fontWeight: 900 }}>{s.total}</span>
                  </div>
                ))}
            </div>
            )}

            {analyticsTab === 'ringkasan' && (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
              <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Kualitas Jawaban</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '10px' }}>
                {[
                  ['Benar', totalCorrect, C.green],
                  ['Salah', totalWrong, '#dc2626'],
                  ['Kosong', totalUnanswered, C.textMuted],
                ].map(([label, value, color]) => (
                  <div key={String(label)} style={{ background: C.bg, borderRadius: '12px', padding: '12px', textAlign: 'center' }}>
                    <p style={{ color: String(color), fontSize: '22px', fontWeight: 900, lineHeight: 1 }}>{value}</p>
                    <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '4px' }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>
            )}

            {analyticsTab === 'soal' && (
            <>
            <div className="grid gap-3 lg:grid-cols-2">
              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Soal Paling Sulit</p>
                {hardQuestions.length === 0
                  ? <p style={{ color: C.textFaint, fontSize: '12px' }}>Belum ada data soal pilihan ganda.</p>
                  : hardQuestions.map((q: any) => (
                    <div key={q.id} style={{ padding: '8px 0', borderBottom: `1px solid ${C.borderLight}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                        <p style={{ color: C.text, fontSize: '12px', fontWeight: 800 }}>No. {q.question_order}</p>
                        <span style={{ color: q.correct_rate <= 20 ? '#dc2626' : '#b45309', fontSize: '11px', fontWeight: 900 }}>{q.correct_rate}% benar</span>
                      </div>
                      <p style={{ color: C.textMuted, fontSize: '11px', marginTop: '3px', lineHeight: 1.4 }}>{String(q.question_text || '').replace(/<[^>]+>/g, '').slice(0, 150)}</p>
                    </div>
                  ))}
              </div>

              <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', padding: '14px' }}>
                <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, marginBottom: '10px' }}>Deteksi Soal Mencurigakan</p>
                {suspiciousQuestions.length === 0
                  ? <p style={{ color: C.textFaint, fontSize: '12px' }}>Tidak ada soal yang perlu perhatian khusus pada filter ini.</p>
                  : suspiciousQuestions.map((q: any) => (
                    <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '8px 0', borderBottom: `1px solid ${C.borderLight}` }}>
                      <div>
                        <p style={{ color: C.text, fontSize: '12px', fontWeight: 800 }}>No. {q.question_order} - {q.difficulty}</p>
                        <p style={{ color: C.textFaint, fontSize: '10.5px' }}>{q.blank_count} kosong, {q.wrong_count} salah, {q.correct_count} benar</p>
                      </div>
                      <span style={{ background: '#fef2f2', color: '#dc2626', borderRadius: '999px', padding: '2px 8px', fontSize: '10px', fontWeight: 800, height: 'fit-content' }}>{q.flag}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', overflow: 'auto' }}>
              <div style={{ padding: '14px 14px 0' }}>
                <p style={{ color: C.text, fontSize: '13px', fontWeight: 800 }}>Analitik Per Soal & Opsi</p>
                <p style={{ color: C.textFaint, fontSize: '11px', marginTop: '2px' }}>Sebaran jawaban membantu melihat pengecoh yang terlalu kuat atau soal yang perlu review.</p>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '980px', marginTop: '10px' }}>
                <TableHead cols={[{ label: 'No' }, { label: 'Ringkasan Soal' }, { label: 'Benar', center: true }, { label: 'Salah', center: true }, { label: 'Kosong', center: true }, { label: '% Benar', center: true }, { label: 'Opsi Dipilih' }, { label: 'Catatan' }]} />
                <tbody>
                  {questionRows.length === 0
                    ? <tr><td colSpan={8} style={{ padding: '18px', textAlign: 'center', color: C.textFaint }}>Belum ada data soal</td></tr>
                    : questionRows.map((q: any, i: number) => (
                      <tr key={q.id} style={{ borderBottom: i < questionRows.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                        <td style={{ padding: '10px 14px', color: C.text, fontWeight: 900 }}>{q.question_order}</td>
                        <td style={{ padding: '10px 14px', color: C.textMuted, maxWidth: '300px' }}>{String(q.question_text || '').replace(/<[^>]+>/g, '').slice(0, 120)}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: C.green, fontWeight: 800 }}>{q.correct_count}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: '#dc2626', fontWeight: 800 }}>{q.wrong_count}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: C.textMuted, fontWeight: 800 }}>{q.blank_count}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 900, color: q.correct_rate <= 20 ? '#dc2626' : q.correct_rate <= 40 ? '#b45309' : C.green }}>{q.correct_rate}%</td>
                        <td style={{ padding: '10px 14px', color: C.textMuted, minWidth: '240px' }}>
                          {q.question_type === 'essay'
                            ? <span>Essay</span>
                            : q.options.map((o: any) => (
                              <span key={o.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '8px', marginBottom: '4px', color: o.is_correct ? C.green : C.textMuted, fontWeight: o.is_correct ? 900 : 700 }}>
                                {o.option_label}: {o.count}{o.is_correct ? ' ✓' : ''}
                              </span>
                            ))}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          {q.flag
                            ? <span style={{ background: '#fef2f2', color: '#dc2626', borderRadius: '999px', padding: '2px 8px', fontSize: '10px', fontWeight: 800 }}>{q.flag}</span>
                            : <span style={{ color: C.textFaint }}>-</span>}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            </>
            )}

            {analyticsTab === 'sesi' && (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '14px', overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '760px' }}>
                <TableHead cols={[{ label: 'Sesi' }, { label: 'Ruangan' }, { label: 'Peserta', center: true }, { label: 'Selesai', center: true }, { label: 'Belum', center: true }, { label: 'Dikunci', center: true }, { label: 'Langgar', center: true }, { label: 'Rata-rata', center: true }]} />
                <tbody>
                  {roomSessionRows.length === 0
                    ? <tr><td colSpan={8} style={{ padding: '18px', textAlign: 'center', color: C.textFaint }}>Belum ada data analitik</td></tr>
                    : roomSessionRows.map((row: any, i: number) => (
                      <tr key={row.key} style={{ borderBottom: i < roomSessionRows.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                        <td style={{ padding: '10px 14px', color: C.textMuted }}>{row.label}</td>
                        <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{row.room}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>{row.peserta}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: C.green, fontWeight: 800 }}>{row.selesai}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center' }}>{row.peserta - row.selesai}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: row.dikunci ? '#b45309' : C.textMuted, fontWeight: 800 }}>{row.dikunci}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: row.pelanggaran ? '#dc2626' : C.textMuted, fontWeight: 800 }}>{row.pelanggaran}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: C.text, fontWeight: 900 }}>{row.rata}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            )}
          </>
        )}
    </div>
  );
}

export default AnalyticsView;
