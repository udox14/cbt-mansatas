'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { LoadingScreen, ToastProvider } from '@/components/ui';
import { LogOut, ArrowLeft } from 'lucide-react';
import { C } from '@/features/exam-engine/components/theme';
import { KemenagLogo } from '@/features/exam-engine/components/KemenagLogo';
import { TanggalHari } from '@/features/exam-engine/components/TanggalHari';
import { UlanganDashboard } from '@/features/ulangan/UlanganDashboard';
import { UlanganWorkspace } from '@/features/ulangan/UlanganWorkspace';

function UlanganContent() {
  const searchParams = useSearchParams();
  const urlExamId = searchParams.get('id');

  const { user, loading: authLoading, logout } = useAuth();
  const [selectedExamId, setSelectedExamId] = useState<string | null>(urlExamId);

  useEffect(() => {
    setSelectedExamId(urlExamId);
  }, [urlExamId]);

  const handleSelectExam = (id: string) => {
    setSelectedExamId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('id', id);
    window.history.pushState({}, '', url.toString());
  };

  const handleBackToDashboard = () => {
    setSelectedExamId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('id');
    window.history.pushState({}, '', url.toString());
  };

  if (authLoading) return <LoadingScreen />;
  if (!user) return null;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      }}
    >
      {/* Background subtle texture */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)',
          backgroundSize: '26px 26px',
          opacity: 0.3,
          zIndex: 0,
        }}
      />

      {/* Institutional Top Header */}
      <header
        style={{
          background: C.white,
          borderBottom: `1.5px solid ${C.border}`,
          padding: '0 24px',
          height: '58px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => {
              window.location.href = '/app/select-mode';
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              background: C.bg,
              border: `1.5px solid ${C.borderMid}`,
              fontSize: '11.5px',
              fontWeight: 700,
              color: C.textMid,
              cursor: 'pointer',
            }}
            title="Kembali ke Pemilihan Mode"
          >
            <ArrowLeft size={13} /> Mode Launcher
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <KemenagLogo size={28} />
            <div>
              <p style={{ color: C.text, fontSize: '11px', fontWeight: 800, lineHeight: 1.2 }}>
                CBT MANSATAS · ULANGAN HARIAN
              </p>
              <p style={{ color: '#7a9e86', fontSize: '9px', fontWeight: 600, fontStyle: 'italic', marginTop: '1px' }}>
                MAN 1 Tasikmalaya
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <TanggalHari />

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              borderLeft: `1.5px solid ${C.borderLight}`,
              paddingLeft: '14px',
            }}
          >
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '12px', fontWeight: 800, color: C.text, lineHeight: 1.2 }}>
                {user.full_name || user.username}
              </p>
              <p style={{ fontSize: '10px', color: C.textMuted, fontFamily: 'monospace' }}>
                {user.role?.toUpperCase()}
              </p>
            </div>

            <button
              onClick={logout}
              title="Keluar"
              style={{
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: '8px',
                padding: '6px',
                color: '#dc2626',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main
        style={{
          flex: 1,
          maxWidth: '1200px',
          width: '100%',
          margin: '0 auto',
          padding: '24px 20px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {selectedExamId ? (
          <UlanganWorkspace
            examId={selectedExamId}
            onBack={handleBackToDashboard}
          />
        ) : (
          <UlanganDashboard
            onSelectExam={handleSelectExam}
          />
        )}
      </main>

      {/* Footer */}
      <footer
        style={{
          textAlign: 'center',
          padding: '16px',
          color: '#a8b3a8',
          fontSize: '11.5px',
          fontWeight: 500,
          borderTop: `1px solid ${C.borderLight}`,
          background: C.white,
        }}
      >
        © 2026 MAN 1 Tasikmalaya — CBT Multi-Mode Platform
      </footer>
    </div>
  );
}

export default function UlanganPage() {
  return (
    <ToastProvider>
      <Suspense fallback={<LoadingScreen />}>
        <UlanganContent />
      </Suspense>
    </ToastProvider>
  );
}
