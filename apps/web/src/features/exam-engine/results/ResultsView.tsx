'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, DEL } from '@/lib/api';
import { Button, EmptyState, useToast, Spinner } from '@/components/ui';
import { exportExamResults } from '@/lib/export';
import { FileDown, RefreshCw, Trash2 } from 'lucide-react';
import { C, sessionFilterKey, sessionFilterLabel, buildSessionFilters } from '../components/theme';

export function ResultsView({ examId, apiPrefix = '/api/admin' }: { examId: string; apiPrefix?: string }) {
  const { toast } = useToast();
  const [results, setResults] = useState<any[]>([]);
  const [exportRows, setExportRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [filterRoom, setFilterRoom] = useState('all');
  const [filterSession, setFilterSession] = useState('all');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'score', dir: 'desc' });
  const fetchResults = useCallback(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      GET(`${apiPrefix}/exams/${examId}/results`),
      GET(`${apiPrefix}/exams/${examId}/results-export`),
    ]).then(([resultResponse, exportResponse]) => {
      if (!alive) return;
      if (resultResponse.success) setResults(resultResponse.data || []);
      if (exportResponse.success) setExportRows(exportResponse.data || []);
      setLoading(false);
    }).catch(() => {
      if (!alive) return;
      toast('error', 'Gagal memuat hasil ujian');
      setLoading(false);
    });
    return () => { alive = false; };
  }, [examId, apiPrefix, toast]);
  useEffect(() => {
    return fetchResults();
  }, [fetchResults]);

  const deleteResultSession = async (sessionId: string, studentName: string) => {
    if (!confirm(`Hapus hasil pengerjaan "${studentName}"? Data nilai dan jawaban akan dibersihkan.`)) return;
    const res = await DEL(`${apiPrefix}/exams/${examId}/results/${sessionId}`);
    if (res.success) {
      toast('success', res.message || 'Hasil berhasil dihapus');
      fetchResults();
    } else {
      toast('error', res.error || 'Gagal menghapus hasil');
    }
  };

  const filterSource = exportRows.length ? exportRows : results;
  const rooms = Array.from(new Set(filterSource.map((r: any) => r.room_name).filter(Boolean))).sort();
  const sessionOptions = buildSessionFilters(filterSource);
  const visible = results.filter((r: any) => {
    if (filterSession !== 'all' && sessionFilterKey(r) !== filterSession) return false;
    if (filterRoom !== 'all' && r.room_name !== filterRoom) return false;
    return true;
  });
  const exportVisible = exportRows.filter((r: any) => {
    if (filterSession !== 'all' && sessionFilterKey(r) !== filterSession) return false;
    if (filterRoom !== 'all' && r.room_name !== filterRoom) return false;
    return true;
  });
  const resultSortColumns = [
    { key: 'full_name', label: 'Nama' },
    { key: 'asal_sekolah', label: 'Asal Sekolah' },
    { key: 'session', label: 'Sesi' },
    { key: 'room_name', label: 'Ruangan' },
    { key: 'total_correct', label: 'Benar', center: true },
    { key: 'total_wrong', label: 'Salah', center: true },
    { key: 'score', label: 'Nilai', center: true },
    { key: 'actions', label: 'Aksi', center: true },
  ];
  const getSortValue = (row: any, key: string) => {
    if (key === 'session') return sessionFilterLabel(row);
    if (['total_correct', 'total_wrong', 'score'].includes(key)) return Number(row[key] || 0);
    return String(row[key] || '').toLowerCase();
  };
  const sortRows = (rows: any[]) => [...rows].sort((a: any, b: any) => {
    const av = getSortValue(a, sort.key);
    const bv = getSortValue(b, sort.key);
    const compared = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sort.dir === 'asc' ? compared : -compared;
  });
  const sortedVisible = sortRows(visible);
  const sortedExportVisible = sortRows(exportVisible);
  const toggleSort = (key: string) => setSort(prev => prev.key === key
    ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: ['total_correct', 'total_wrong', 'score'].includes(key) ? 'desc' : 'asc' });
  const handleExport = async () => {
    const rows = sortedExportVisible.length ? sortedExportVisible : sortedVisible;
    if (!rows.length) {
      toast('warning', 'Tidak ada peserta untuk diexport pada filter ini');
      return;
    }
    setExporting(true);
    try {
      await exportExamResults(rows, `ujian-${examId}${filterSession !== 'all' ? `-${filterSession.replace(/[^a-zA-Z0-9]+/g, '-')}` : ''}${filterRoom !== 'all' ? `-${filterRoom}` : ''}`);
    } finally {
      setExporting(false);
    }
  };
  const recoverMissingResults = async () => {
    setRecovering(true);
    const r = await POST<{ repaired: number }>(`${apiPrefix}/exams/${examId}/results/recompute-missing`, {});
    setRecovering(false);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal memulihkan hasil');
    if (r.success) fetchResults();
  };
  const avgScore = visible.length ? Math.round(visible.reduce((s: number, r: any) => s + (r.score ?? 0), 0) / visible.length) : 0;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{visible.length} Hasil</span>
          {visible.length > 0 && <span style={{ background: C.greenLight, color: C.green, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>Rata-rata {avgScore}</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {sessionOptions.length > 1 && (
            <select value={filterSession} onChange={e => setFilterSession(e.target.value)}
              style={{ fontSize: '11.5px', fontWeight: 600, padding: '5px 10px', border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', background: C.white, color: C.textMid, cursor: 'pointer', maxWidth: '220px' }}>
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
          {!loading && <Button variant="secondary" size="sm" loading={recovering} onClick={recoverMissingResults}><RefreshCw size={13} /> Pulihkan</Button>}
          {!loading && <Button variant="secondary" size="sm" loading={exporting} onClick={handleExport}><FileDown size={13} /> Export</Button>}
        </div>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : visible.length === 0 ? <EmptyState title="Belum ada hasil" />
          : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                    <th style={{ padding: '9px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>#</th>
                    {resultSortColumns.map(col => (
                      <th key={col.key} style={{ padding: '0', textAlign: col.center ? 'center' : 'left', whiteSpace: 'nowrap' }}>
                        <button onClick={() => toggleSort(col.key)}
                          style={{
                            width: '100%',
                            padding: '9px 14px',
                            textAlign: col.center ? 'center' : 'left',
                            color: sort.key === col.key ? C.green : C.textMid,
                            fontSize: '10.5px',
                            fontWeight: sort.key === col.key ? 900 : 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                          }}>
                          {col.label} {sort.key === col.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedVisible.map((r: any, i: number) => (
                    <tr key={i} style={{ borderBottom: i < sortedVisible.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                      <td style={{ padding: '10px 14px', color: C.textMuted, fontWeight: 600 }}>{i + 1}</td>
                      <td style={{ padding: '10px 14px', color: C.text, fontWeight: 700 }}>{r.full_name}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted }}>{r.asal_sekolah || '—'}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted, fontSize: '11px' }}>{sessionFilterLabel(r)}</td>
                      <td style={{ padding: '10px 14px', color: C.textMuted }}>{r.room_name}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', color: C.green, fontWeight: 700 }}>{r.total_correct}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>{r.total_wrong}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', color: C.text, fontWeight: 900 }}>{r.score}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <button onClick={() => deleteResultSession(r.session_id, r.full_name)}
                          title="Hapus Hasil Ujian"
                          style={{ width: '26px', height: '26px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '7px', background: '#fef2f2', border: '1.5px solid #fecaca', cursor: 'pointer', color: '#dc2626' }}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  );
}

export default ResultsView;
