'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { GET } from '@/lib/api';
import { EmptyState, Spinner } from '@/components/ui';
import { C, parseServerTime, sessionFilterKey, sessionFilterLabel, buildSessionFilters } from '../components/theme';

export function MonitorView({ examId, apiPrefix = '/api/admin' }: { examId: string; apiPrefix?: string }) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterRoom, setFilterRoom] = useState('all');
  const [filterSession, setFilterSession] = useState('all');
  const fetchS = useCallback(async () => { const r = await GET(`${apiPrefix}/exams/${examId}/sessions`); if (r.success) setSessions(r.data || []); setLoading(false); }, [examId, apiPrefix]);
  useEffect(() => { fetchS(); const iv = setInterval(fetchS, 10000); return () => clearInterval(iv); }, [fetchS]);
  const rooms = Array.from(new Set(sessions.map((s: any) => s.room_name).filter(Boolean))).sort();
  const sessionOptions = buildSessionFilters(sessions);
  const visible = sessions.filter((s: any) => {
    if (filterSession !== 'all' && sessionFilterKey(s) !== filterSession) return false;
    if (filterRoom !== 'all' && s.room_name !== filterRoom) return false;
    return true;
  });
  const online = visible.filter((s: any) => s.status === 'active' && (Date.now() - parseServerTime(s.last_heartbeat)) < 30000).length;
  const done = visible.filter((s: any) => s.status === 'submitted').length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{visible.length} Peserta</span>
          {visible.length > 0 && (
            <>
              <span style={{ background: C.greenLight, color: C.green, fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>🟢 {online} Online</span>
              <span style={{ background: '#f1f1f0', color: '#6b7c6e', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px' }}>✓ {done} Selesai</span>
            </>
          )}
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
          <span style={{ background: '#e0f0ff', color: '#1a5fa8', fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px' }}>Auto-refresh 10s</span>
        </div>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : visible.length === 0 ? <EmptyState title="Belum ada sesi" />
          : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
              {visible.map((s: any, i: number) => {
                const isOnline = s.status === 'active' && (Date.now() - parseServerTime(s.last_heartbeat)) < 30000;
                const isDone = s.status === 'submitted';
                const isLocked = s.is_time_locked && !isDone;
                const violationTotal = Number(s.cheat_log_count || s.cheat_warnings || 0);
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderBottom: i < visible.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                    <span style={{ flex: 1, color: C.text, fontSize: '12.5px', fontWeight: 700 }}>{s.full_name}</span>
                    <span style={{ color: C.textFaint, fontSize: '10.5px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionFilterLabel(s)}</span>
                    <span style={{ color: '#6b7c6e', fontSize: '11.5px' }}>{s.room_name}</span>
                    <span style={{ background: isDone ? '#f1f1f0' : isLocked ? '#fef3c7' : isOnline ? C.greenLight : '#fef2f2', color: isDone ? '#6b7c6e' : isLocked ? '#92400e' : isOnline ? '#2d6644' : '#dc2626', fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px' }}>
                      {isDone ? 'Selesai' : isLocked ? '🔒 Dikunci' : isOnline ? 'Online' : 'Offline'}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: violationTotal > 0 ? 700 : 400, color: violationTotal > 0 ? '#dc2626' : C.textFaint }}>
                      {violationTotal} ⚠
                    </span>
                  </div>
                );
              })}
            </div>
          )}
    </div>
  );
}

export default MonitorView;
