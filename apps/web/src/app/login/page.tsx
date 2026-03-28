'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { POST, setToken } from '@/lib/api';
import { BookOpen, Eye, EyeOff, ArrowRight } from 'lucide-react';

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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-5">
            <div className="w-9 h-9 rounded-lg bg-primary-600 flex items-center justify-center text-white"><BookOpen size={17} /></div>
            <span className="font-bold text-gray-800">CBT PMB</span>
          </Link>
          <h1 className="text-lg font-bold text-gray-900">Masuk ke Sistem</h1>
          <p className="text-xs text-gray-400 mt-1">Peserta PMB: username = NISN, password = tanggal lahir (DDMMYYYY)</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Username / NISN</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Masukkan username" autoComplete="username" autoFocus
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Masukkan password" autoComplete="current-password"
                  className="w-full px-3 py-2.5 pr-10 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition" />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && <div className="px-3 py-2 bg-red-50 rounded-lg text-xs text-red-600 font-medium">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-semibold text-sm rounded-lg shadow-sm transition-all disabled:opacity-50">
              {loading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ArrowRight size={16} />}
              {loading ? 'Memproses...' : 'Masuk'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-gray-400 mt-5">Hubungi panitia jika belum memiliki akun</p>
      </div>
    </div>
  );
}
