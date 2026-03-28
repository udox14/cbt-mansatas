'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function LandingPage() {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(true); }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-950 via-surface-900 to-surface-950 relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />

      {/* Glow */}
      <div className="absolute top-[-20%] left-[50%] translate-x-[-50%] w-[600px] h-[600px] rounded-full bg-brand-500/10 blur-[120px]" />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Nav */}
        <nav className="flex items-center justify-between px-5 sm:px-8 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
              </svg>
            </div>
            <span className="font-bold text-white text-sm tracking-tight">CBT PMB</span>
          </div>
          <Link href="/login/"
            className="text-sm font-semibold text-brand-400 hover:text-brand-300 transition-colors">
            Masuk →
          </Link>
        </nav>

        {/* Hero */}
        <main className="flex-1 flex items-center justify-center px-5 sm:px-8">
          <div className={`text-center max-w-xl mx-auto transition-all duration-700 ${show ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            {/* Logo placeholder */}
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm flex items-center justify-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round">
                <path d="M12 14l9-5-9-5-9 5 9 5z"/><path d="M12 14l6.16-3.422a12 12 0 01.665 6.479A12 12 0 0112 20.5a12 12 0 01-6.824-3.443 12 12 0 01.665-6.479L12 14z"/>
                <path d="M12 14l9-5-9-5-9 5 9 5zM12 14v6.5M20 7v5"/>
              </svg>
            </div>

            <div className="inline-block px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 mb-4">
              <span className="text-xs font-semibold text-brand-400">Penerimaan Murid Baru 2025/2026</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-extrabold text-white leading-tight mb-4 tracking-tight">
              Ujian Seleksi
              <span className="block text-brand-400">Penerimaan Murid Baru</span>
            </h1>

            <p className="text-surface-400 text-sm sm:text-base mb-8 max-w-md mx-auto leading-relaxed">
              Sistem ujian berbasis komputer yang aman, cepat, dan andal.
              Selamat datang, semoga sukses!
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/login/"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-500
                  text-white font-bold rounded-xl shadow-lg shadow-brand-600/25 transition-all active:scale-[0.97] text-sm">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>
                </svg>
                Masuk ke Ujian
              </Link>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="text-center py-4 px-5">
          <p className="text-xs text-surface-600">© 2025 — Sistem CBT PMB</p>
        </footer>
      </div>
    </div>
  );
}
