'use client';
import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { POST, setToken } from '@/lib/api';
import { Eye, EyeOff, ArrowRight, ChevronLeft, Info } from 'lucide-react';

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
    <div className="min-h-screen flex flex-col select-none overflow-hidden" style={{ background: '#f4f6f4' }}>

      {/* dot texture */}
      <div className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.4 }} />

      {/* blobs */}
      <div className="pointer-events-none absolute -top-12 -right-12 w-52 h-52 rounded-full" style={{ background: '#dde2dd' }} />
      <div className="pointer-events-none absolute -bottom-10 -left-10 w-44 h-44 rounded-full" style={{ background: '#d6e8dc' }} />

      {/* BACK */}
      <div className="relative z-10 px-5 pt-10 pb-2.5 max-w-md mx-auto w-full">
        <Link href="/" className="inline-flex items-center gap-1.5 font-semibold transition-opacity active:opacity-60"
          style={{ color: '#6b7c6e', fontSize: '12px' }}>
          <ChevronLeft size={16} strokeWidth={2.5} />
          Kembali
        </Link>
      </div>

      {/* MAIN */}
      <main className="relative z-10 flex-1 flex flex-col justify-center px-5 max-w-md mx-auto w-full pb-8">

        {/* Identity */}
        <div className="flex items-center gap-3 mb-6">
          <div className="shrink-0 flex items-center justify-center rounded-full"
            style={{ width: '42px', height: '42px', background: '#fff', border: '1.5px solid #cdd4cd' }}>
            <img src="/kemenag.png" alt="Kemenag" width={28} height={28} style={{ objectFit: 'contain' }} />
          </div>
          <div>
            <p className="font-extrabold leading-tight" style={{ color: '#1e2e22', fontSize: '12px', letterSpacing: '0.01em' }}>MAN 1 TASIKMALAYA</p>
            <p className="font-semibold italic mt-0.5" style={{ color: '#7a9e86', fontSize: '10px', letterSpacing: '0.06em' }}>Bangkit · Maju · Juara</p>
          </div>
        </div>

        {/* divider */}
        <div className="mb-6" style={{ height: '1px', background: 'linear-gradient(to right,transparent,#c4cec4,transparent)' }} />

        {/* Form card */}
        <div className="mb-3.5" style={{ background: '#fff', border: '1.5px solid #d4dbd4', borderRadius: '20px', padding: '22px' }}>

          {/* Title inside card */}
          <div className="mb-5">
            <p className="font-black leading-tight" style={{ color: '#1e2e22', fontSize: '22px', letterSpacing: '-0.6px' }}>Masuk ke</p>
            <p className="font-black leading-tight" style={{ color: '#2d7a4f', fontSize: '22px', letterSpacing: '-0.6px' }}>Sistem Ujian</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-3.5">
            {/* Username */}
            <div>
              <label className="block font-bold uppercase mb-1.5" style={{ color: '#4a6655', fontSize: '11px', letterSpacing: '0.05em' }}>Username / NISN</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9ab5a2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="Masukkan NISN" autoComplete="username" autoFocus
                  className="w-full font-medium transition-all"
                  style={{ padding: '12px 14px 12px 36px', fontSize: '14px', border: '1.5px solid #d4dbd4', borderRadius: '12px', color: '#1e2e22', background: '#fafbfa', outline: 'none' }}
                  onFocus={e => { e.target.style.borderColor = '#2d7a4f'; e.target.style.boxShadow = '0 0 0 3px rgba(45,122,79,0.1)'; }}
                  onBlur={e => { e.target.style.borderColor = '#d4dbd4'; e.target.style.boxShadow = 'none'; }} />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block font-bold uppercase mb-1.5" style={{ color: '#4a6655', fontSize: '11px', letterSpacing: '0.05em' }}>Password</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9ab5a2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
                <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Tanggal lahir (DDMMYYYY)" autoComplete="current-password"
                  className="w-full font-medium transition-all"
                  style={{ padding: '12px 40px 12px 36px', fontSize: '14px', border: '1.5px solid #d4dbd4', borderRadius: '12px', color: '#1e2e22', background: '#fafbfa', outline: 'none' }}
                  onFocus={e => { e.target.style.borderColor = '#2d7a4f'; e.target.style.boxShadow = '0 0 0 3px rgba(45,122,79,0.1)'; }}
                  onBlur={e => { e.target.style.borderColor = '#d4dbd4'; e.target.style.boxShadow = 'none'; }} />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity active:opacity-60">
                  {showPw ? <EyeOff size={15} color="#9ab5a2" /> : <Eye size={15} color="#9ab5a2" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2" style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '12px', padding: '10px 14px' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                <span className="font-semibold" style={{ color: '#dc2626', fontSize: '12px' }}>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-between active:scale-[0.98] transition-all disabled:opacity-50"
              style={{ background: '#2d7a4f', padding: '14px 18px', borderRadius: '14px', border: 'none', cursor: 'pointer' }}>
              <span className="font-extrabold" style={{ color: '#fff', fontSize: '14px' }}>
                {loading ? 'Memproses...' : 'Masuk'}
              </span>
              <span className="flex items-center justify-center" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.15)', borderRadius: '9px' }}>
                {loading
                  ? <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                  : <ArrowRight size={15} color="#fff" strokeWidth={2.5} />}
              </span>
            </button>
          </form>
        </div>

        {/* Help strip */}
        <div className="flex items-start gap-2.5" style={{ background: '#fff', border: '1.5px solid #d4dbd4', borderRadius: '14px', padding: '12px 14px' }}>
          <Info size={13} strokeWidth={2.2} color="#2d7a4f" className="shrink-0 mt-0.5" />
          <p className="font-medium leading-relaxed" style={{ color: '#8a9e8d', fontSize: '11px' }}>
            Hubungi panitia PMB jika mengalami kendala saat login.
          </p>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="relative z-10 pb-10 text-center max-w-md mx-auto w-full">
        <p style={{ color: '#a8b3a8', fontSize: '11px', fontWeight: 500 }}>© 2026 MAN 1 Tasikmalaya — DRUDOX</p>
      </footer>
    </div>
  );
}
