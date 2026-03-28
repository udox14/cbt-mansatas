'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { GET, POST } from '@/lib/api';
import { Button, Badge, LoadingScreen, EmptyState, ToastProvider, useToast, Confirm } from '@/components/ui';

interface Token { id: number; exam_id: number; token_code: string; exam_title: string; room_name: string }
interface Session {
  id: number; user_id: number; full_name: string; nisn: string; username: string; exam_title: string;
  status: string; cheat_warnings: number; started_at: string; finished_at: string | null;
  last_heartbeat: string; device_id: string | null; live_status: string;
  answered_count: number; total_questions: number;
}

function ProctorContent() {
  const { user, loading: authLoading, logout } = useAuth('proctor');
  const { toast } = useToast();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState<Session | null>(null);

  const fetchData = useCallback(async () => {
    const [t, s] = await Promise.all([
      GET<Token[]>('/api/proctor/token'),
      GET<Session[]>('/api/proctor/sessions'),
    ]);
    if (t.success) setTokens(t.data || []);
    if (s.success) setSessions(s.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchData();
    const iv = setInterval(fetchData, 10000); // refresh tiap 10 detik
    return () => clearInterval(iv);
  }, [user, fetchData]);

  const handleReset = async () => {
    if (!resetTarget) return;
    const r = await POST(`/api/proctor/sessions/${resetTarget.id}/reset`);
    toast(r.success ? 'success' : 'error', r.message || r.error || 'Gagal');
    setResetTarget(null);
    fetchData();
  };

  if (authLoading || loading) return <LoadingScreen />;
  if (!user) return null;

  const online = sessions.filter(s => s.live_status === 'online').length;
  const finished = sessions.filter(s => s.live_status === 'selesai').length;
  const statusColors: Record<string, string> = { online: 'green', offline: 'red', selesai: 'gray' };
  const statusLabels: Record<string, string> = { online: 'Online', offline: 'Offline', selesai: 'Selesai' };

  return (
    <div className="min-h-screen bg-surface-50">
      {/* Header */}
      <header className="bg-white border-b border-surface-100 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-surface-900">{user.full_name}</h1>
            <p className="text-xs text-surface-400">Pengawas Ruangan</p>
          </div>
          <button onClick={logout} className="text-xs text-surface-400 hover:text-red-500 font-medium transition-colors">Keluar</button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {/* Token Display */}
        <section>
          <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider mb-2">Token Aktif</h2>
          {tokens.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-100 p-4 text-center text-sm text-surface-400">
              Belum ada ujian aktif untuk ruangan Anda
            </div>
          ) : (
            <div className="grid gap-2">
              {tokens.map(t => (
                <div key={t.id} className="bg-white rounded-xl border border-surface-100 p-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-surface-500">{t.exam_title}</p>
                    <p className="text-xs text-surface-400">{t.room_name}</p>
                  </div>
                  <div className="text-2xl sm:text-3xl font-mono font-extrabold text-brand-700 tracking-[0.2em]">
                    {t.token_code}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white rounded-xl border border-surface-100 p-3 text-center">
            <p className="text-xl font-extrabold text-brand-600">{online}</p>
            <p className="text-xs text-surface-400">Online</p>
          </div>
          <div className="bg-white rounded-xl border border-surface-100 p-3 text-center">
            <p className="text-xl font-extrabold text-surface-400">{sessions.length - online - finished}</p>
            <p className="text-xs text-surface-400">Offline</p>
          </div>
          <div className="bg-white rounded-xl border border-surface-100 p-3 text-center">
            <p className="text-xl font-extrabold text-surface-600">{finished}</p>
            <p className="text-xs text-surface-400">Selesai</p>
          </div>
        </div>

        {/* Live Table */}
        <section>
          <h2 className="text-xs font-bold text-surface-400 uppercase tracking-wider mb-2">Monitoring Peserta</h2>
          {sessions.length === 0 ? (
            <EmptyState title="Belum ada peserta" desc="Peserta yang memulai ujian akan muncul di sini" />
          ) : (
            <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-50 text-surface-500 uppercase tracking-wider">
                      <th className="text-left px-3 py-2 font-semibold">Peserta</th>
                      <th className="text-center px-2 py-2 font-semibold">Status</th>
                      <th className="text-center px-2 py-2 font-semibold">Progres</th>
                      <th className="text-center px-2 py-2 font-semibold">Warn</th>
                      <th className="text-center px-2 py-2 font-semibold">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-50">
                    {sessions.map(s => (
                      <tr key={s.id} className="hover:bg-surface-50/50">
                        <td className="px-3 py-2">
                          <p className="font-semibold text-surface-800">{s.full_name}</p>
                          <p className="text-surface-400">{s.nisn || s.username}</p>
                        </td>
                        <td className="text-center px-2 py-2">
                          <Badge color={statusColors[s.live_status] || 'gray'}>
                            {s.live_status === 'online' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 pulse-dot" />}
                            {statusLabels[s.live_status] || s.live_status}
                          </Badge>
                        </td>
                        <td className="text-center px-2 py-2 font-mono text-surface-600">
                          {s.answered_count}/{s.total_questions}
                        </td>
                        <td className="text-center px-2 py-2">
                          {s.cheat_warnings > 0 ? (
                            <span className="text-red-600 font-bold">{s.cheat_warnings}</span>
                          ) : (
                            <span className="text-surface-300">0</span>
                          )}
                        </td>
                        <td className="text-center px-2 py-2">
                          {(s.live_status === 'offline' || s.status === 'active') && s.live_status !== 'selesai' && (
                            <button onClick={() => setResetTarget(s)}
                              className="text-xs text-blue-600 hover:text-blue-800 font-semibold">Reset</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>

      <Confirm open={!!resetTarget} onClose={() => setResetTarget(null)} onConfirm={handleReset}
        title="Reset Sesi Peserta?" danger={false} confirmText="Reset"
        message={`Reset device lock untuk ${resetTarget?.full_name}? Peserta bisa login ulang dari perangkat baru.`} />
    </div>
  );
}

export default function ProctorPage() {
  return <ToastProvider><ProctorContent /></ToastProvider>;
}
