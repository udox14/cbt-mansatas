'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, PUT } from '@/lib/api';
import { Button, useToast } from '@/components/ui';
import { CheckCircle2, AlertTriangle, Info, RefreshCw, Lock, Unlock } from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import type { EventReadinessResult, ReadinessCheckItem } from './types';

interface Props {
  eventId: string;
  currentStatus: string;
  onStatusChange?: (newStatus: string) => void;
}

export function KegiatanReadiness({ eventId, currentStatus, onStatusChange }: Props) {
  const { toast } = useToast();
  const [readiness, setReadiness] = useState<EventReadinessResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState(false);

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    try {
      const res = await GET<EventReadinessResult>(`/api/kegiatan/events/${eventId}/readiness`);
      if (res.success && res.data) {
        setReadiness(res.data);
      } else {
        toast('error', res.error || 'Gagal memuat status kesiapan');
      }
    } catch {
      toast('error', 'Gagal memuat status kesiapan kegiatan');
    } finally {
      setLoading(false);
    }
  }, [eventId, toast]);

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  const handleTransitionToReady = async () => {
    if (!readiness?.ready) {
      toast('error', 'Semua kriteria wajib harus terpenuhi sebelum menetapkan status Siap');
      return;
    }
    setTransitioning(true);
    try {
      const res = await PUT<{ status: string }>(`/api/kegiatan/events/${eventId}/status`, { status: 'ready' });
      if (res.success) {
        toast('success', 'Status kegiatan berhasil ditetapkan menjadi Siap (Ready)');
        if (onStatusChange) onStatusChange('ready');
        fetchReadiness();
      } else {
        toast('error', res.error || 'Gagal mengubah status kegiatan');
      }
    } catch {
      toast('error', 'Terjadi kesalahan jaringan saat mengubah status');
    } finally {
      setTransitioning(false);
    }
  };

  const handleRollbackToConfiguration = async () => {
    setTransitioning(true);
    try {
      const res = await PUT<{ status: string }>(`/api/kegiatan/events/${eventId}/status`, { status: 'configuration' });
      if (res.success) {
        toast('success', 'Kegiatan dikembalikan ke status Konfigurasi');
        if (onStatusChange) onStatusChange('configuration');
        fetchReadiness();
      } else {
        toast('error', res.error || 'Gagal mengubah status');
      }
    } catch {
      toast('error', 'Terjadi kesalahan jaringan');
    } finally {
      setTransitioning(false);
    }
  };

  const getCheckTitle = (key: ReadinessCheckItem['key']) => {
    switch (key) {
      case 'event_config':
        return 'Konfigurasi Informasi Kegiatan';
      case 'exams':
        return 'Ujian Terdaftar';
      case 'questions':
        return 'Kelengkapan Bank Soal & Kunci Jawaban';
      case 'participants':
        return 'Snapshot Peserta Roster';
      case 'tokens':
        return 'Token & Akses Ruangan';
      default:
        return key;
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner */}
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: C.text }}>
              Pemeriksaan Kesiapan Pelaksanaan (Readiness Gate)
            </h3>
            <p style={{ fontSize: '12px', color: C.textMid, marginTop: '2px' }}>
              Validasi server-authoritative yang memastikan seluruh prasyarat ujian telah lengkap sebelum hari-H.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchReadiness} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Muat Ulang
          </Button>
        </div>

        {/* Status Indicator Banner */}
        {readiness && (
          <div
            style={{
              marginTop: '14px',
              padding: '12px 14px',
              borderRadius: '9px',
              background: readiness.ready ? C.greenLight : '#fffbe6',
              border: `1.5px solid ${readiness.ready ? C.greenBorder : '#ffe58f'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              {readiness.ready ? (
                <CheckCircle2 size={18} color={C.green} />
              ) : (
                <AlertTriangle size={18} color="#d48806" />
              )}
              <div>
                <p style={{ fontSize: '12.5px', fontWeight: 800, color: readiness.ready ? C.green : '#d48806' }}>
                  {readiness.ready
                    ? 'Seluruh Prasyarat Kesiapan Terpenuhi'
                    : 'Prasyarat Belum Lengkap'}
                </p>
                <p style={{ fontSize: '11px', color: C.textMid, marginTop: '1px' }}>
                  {readiness.ready
                    ? 'Kegiatan dapat dikunci ke status Siap (Ready) untuk pelaksanaan ujian.'
                    : 'Periksa daftar checklist di bawah untuk melengkapi kekurangan konfigurasi.'}
                </p>
              </div>
            </div>

            {/* Action transition button */}
            {currentStatus === 'configuration' && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleTransitionToReady}
                disabled={!readiness.ready || transitioning}
              >
                <Lock size={13} />
                {transitioning ? 'Mengunci...' : 'Kunci & Tetapkan Siap (Ready)'}
              </Button>
            )}

            {currentStatus === 'ready' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRollbackToConfiguration}
                disabled={transitioning}
              >
                <Unlock size={13} />
                {transitioning ? 'Membuka...' : 'Buka Kembali Konfigurasi'}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Checklist Items */}
      <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, background: '#fafbfa' }}>
          <p style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: C.textMid }}>
            Checklist Kesiapan Server
          </p>
        </div>

        <div className="divide-y divide-[#e0e5e0]">
          {readiness?.checks.map((check) => (
            <div key={check.key} style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{ marginTop: '2px', flexShrink: 0 }}>
                  {check.ok ? (
                    <CheckCircle2 size={18} color={C.green} />
                  ) : check.blocking ? (
                    <AlertTriangle size={18} color="#dc2626" />
                  ) : (
                    <Info size={18} color="#1a5fa8" />
                  )}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>
                      {getCheckTitle(check.key)}
                    </p>
                    {check.blocking ? (
                      <span style={{ fontSize: '9.5px', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', background: check.ok ? C.greenLight : '#fee2e2', color: check.ok ? C.green : '#dc2626' }}>
                        WAJIB
                      </span>
                    ) : (
                      <span style={{ fontSize: '9.5px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1' }}>
                        INFORMASIONAL
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: '12px', color: check.ok ? C.textMid : '#991b1b', marginTop: '3px' }}>
                    {check.message}
                  </p>
                </div>
              </div>

              <div>
                <span style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '3px 9px',
                  borderRadius: '999px',
                  background: check.ok ? C.greenLight : '#fee2e2',
                  color: check.ok ? C.green : '#dc2626',
                  border: `1px solid ${check.ok ? C.greenBorder : '#fca5a5'}`,
                }}>
                  {check.ok ? 'LOLOS' : 'BELUM'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
