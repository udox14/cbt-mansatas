'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { POST, setToken } from '@/lib/api';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) { setError('Lengkapi semua kolom'); return; }
    setLoading(true);
    const r = await POST('/api/auth/login', { username: username.trim(), password });
    setLoading(false);
    if (!r.success) { setError(r.error || 'Login gagal'); return; }
    setToken(r.data.token);
    localStorage.setItem('cbt_user', JSON.stringify({
      sub: r.data.user.id, username: r.data.user.username,
      role: r.data.user.role, room_id: r.data.user.room_id,
      full_name: r.data.user.full_name, source: r.data.user.source,
    }));
    const routes: Record<string, string> = { admin: '/admin/', proctor: '/proctor/', student: '/student/' };
    window.location.href = routes[r.data.user.role] || '/student/';
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface-50 to-surface-100 px-4">
      {/* Background subtle */}
      <div className="absolute inset-0 opacity-[0.02]"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #0f172a 1px, transparent 0)', backgroundSize: '24px 24px' }} />

      <div className="relative w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-6">
          <Link href="/" className="inline-flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center shadow-md shadow-brand-600/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
              </svg>
            </div>
            <span className="font-bold text-surface-800 tracking-tight">CBT PMB</span>
          </Link>
          <h1 className="text-xl font-extrabold text-surface-900 tracking-tight">Masuk ke Sistem</h1>
          <p className="text-sm text-surface-400 mt-1">Pendaftar PMB: username = NISN, password = tanggal lahir (DDMMYYYY)</p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-sm shadow-surface-200/50 border border-surface-100 p-5">
          <form onSubmit={handleLogin} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Username / NISN</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Masukkan username"
                className="w-full px-3 py-2.5 text-sm bg-surface-50 border border-surface-200 rounded-xl outline-none
                  focus:border-brand-500 focus:bg-white transition-all" autoComplete="username" autoFocus />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  className="w-full px-3 py-2.5 pr-10 text-sm bg-surface-50 border border-surface-200 rounded-xl outline-none
                    focus:border-brand-500 focus:bg-white transition-all" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 transition-colors">
                  {showPw ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-medium">{error}</div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm rounded-xl
                shadow-sm shadow-brand-600/20 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="animate-spin">
                  <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" opacity="0.3"/>
                  <path d="M12 2a10 10 0 019.8 8" stroke="white" strokeWidth="3" strokeLinecap="round"/>
                </svg>
              ) : null}
              {loading ? 'Memproses...' : 'Masuk'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-surface-400 mt-4">
          Hubungi panitia jika belum memiliki akun
        </p>
      </div>
    </div>
  );
}
