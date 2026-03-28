'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST } from '@/lib/api';
import { Button, Badge, LoadingScreen, EmptyState, ToastProvider, useToast, Confirm, Spinner } from '@/components/ui';
import { LogOut, RefreshCw, Monitor, KeyRound, Wifi, WifiOff, CheckCircle, AlertTriangle } from 'lucide-react';

function ProctorContent() {
  const { user, loading: authLoading, logout } = useAuth('proctor');
  const { toast } = useToast();
  const [tokens, setTokens] = useState<any[]>([]); const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true); const [resetTarget, setResetTarget] = useState<any>(null);

  const fetchData = useCallback(async () => {
    const [t, s] = await Promise.all([GET('/api/proctor/token'), GET('/api/proctor/sessions')]);
    if (t.success) setTokens(t.data || []); if (s.success) setSessions(s.data || []); setLoading(false);
  }, []);

  useEffect(() => { if (!user) return; fetchData(); const iv = setInterval(fetchData, 10000); return () => clearInterval(iv); }, [user, fetchData]);

  const handleReset = async () => { if (!resetTarget) return; await POST(`/api/proctor/sessions/${resetTarget.id}/reset`); toast('success', 'Sesi berhasil direset'); setResetTarget(null); fetchData(); };

  if (authLoading || loading) return <LoadingScreen />;
  if (!user) return null;

  const online = sessions.filter((s: any) => s.live_status === 'online').length;
  const finished = sessions.filter((s: any) => s.live_status === 'selesai').length;
  const offline = sessions.length - online - finished;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div><h1 className="text-sm font-semibold text-gray-900">{user.full_name}</h1><p className="text-[11px] text-gray-400">Pengawas Ruangan</p></div>
          <button onClick={logout} className="text-gray-400 hover:text-red-500"><LogOut size={16} /></button>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-5 space-y-5">
        {/* Token */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Token Aktif</h2>
          {tokens.length === 0 ? <div className="bg-white rounded-lg border border-gray-200 p-4 text-center text-sm text-gray-400">Belum ada ujian aktif</div> : (
            <div className="space-y-2">{tokens.map((t: any) => (
              <div key={t.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
                <div><p className="text-xs text-gray-500">{t.exam_title}</p><p className="text-[11px] text-gray-400">{t.room_name}</p></div>
                <span className="text-2xl sm:text-3xl font-mono font-bold text-primary-700 tracking-widest">{t.token_code}</span>
              </div>))}</div>)}
        </section>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[{ n: online, l: 'Online', Icon: Wifi, c: 'text-primary-600' }, { n: offline, l: 'Offline', Icon: WifiOff, c: 'text-gray-400' }, { n: finished, l: 'Selesai', Icon: CheckCircle, c: 'text-gray-500' }].map(s => (
            <div key={s.l} className="bg-white rounded-lg border border-gray-200 p-3 text-center">
              <s.Icon size={16} className={`mx-auto mb-1 ${s.c}`} /><p className="text-xl font-bold text-gray-800">{s.n}</p><p className="text-[11px] text-gray-400">{s.l}</p></div>))}
        </div>

        {/* Table */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Monitoring Peserta</h2>
          {sessions.length === 0 ? <EmptyState title="Belum ada peserta" /> : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden overflow-x-auto">
              <table className="w-full text-xs"><thead><tr className="bg-gray-50 text-gray-500 border-b border-gray-100">
                <th className="text-left px-4 py-2.5 font-medium">Peserta</th><th className="text-center px-3 py-2.5 font-medium">Status</th><th className="text-center px-3 py-2.5 font-medium">Progres</th><th className="text-center px-3 py-2.5 font-medium">Warn</th><th className="text-center px-3 py-2.5 font-medium">Aksi</th>
              </tr></thead>
              <tbody>{sessions.map((s: any) => (
                <tr key={s.id} className="border-b border-gray-50">
                  <td className="px-4 py-2.5"><p className="font-medium text-gray-800">{s.full_name}</p><p className="text-gray-400 text-[10px]">{s.nisn}</p></td>
                  <td className="text-center px-3 py-2.5"><Badge color={s.live_status === 'selesai' ? 'gray' : s.live_status === 'online' ? 'green' : 'red'}>{s.live_status === 'online' ? 'Online' : s.live_status === 'selesai' ? 'Selesai' : 'Offline'}</Badge></td>
                  <td className="text-center px-3 py-2.5 font-mono text-gray-600">{s.answered_count}/{s.total_questions}</td>
                  <td className="text-center px-3 py-2.5">{s.cheat_warnings > 0 ? <span className="text-red-600 font-bold">{s.cheat_warnings}</span> : <span className="text-gray-300">0</span>}</td>
                  <td className="text-center px-3 py-2.5">{s.live_status !== 'selesai' && <button onClick={() => setResetTarget(s)} className="text-xs text-primary-600 font-medium hover:underline">Reset</button>}</td>
                </tr>))}</tbody></table></div>)}
        </section>
      </main>
      <Confirm open={!!resetTarget} onClose={() => setResetTarget(null)} onConfirm={handleReset} title="Reset Sesi?" danger={false} confirmText="Reset"
        message={`Reset device lock untuk ${resetTarget?.full_name}?`} />
    </div>
  );
}

export default function ProctorPage() { return <ToastProvider><ProctorContent /></ToastProvider>; }
