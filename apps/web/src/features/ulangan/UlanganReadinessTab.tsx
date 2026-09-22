'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST } from '@/lib/api';
import { Button, useToast, Spinner } from '@/components/ui';
import { CheckCircle2, XCircle, AlertCircle, PlayCircle, RefreshCw } from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import type { UlanganExam, UlanganReadiness } from './types';

interface Props {
  exam: UlanganExam;
  onStatusChanged: (newStatus: string) => void;
}

export function UlanganReadinessTab({ exam, onStatusChanged }: Props) {
  const { toast } = useToast();
  const [readiness, setReadiness] = useState<UlanganReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const fetchReadiness = useCallback(async () => {
    setLoading(true);
    try {
      const res = await GET<UlanganReadiness>(`/api/ulangan/exams/${exam.id}/readiness`);
      if (res.success && res.data) {
        setReadiness(res.data);
      }
    } catch {
      toast('error', 'Gagal memuat kesiapan ulangan');
    } finally {
      setLoading(false);
    }
  }, [exam.id, toast]);

  useEffect(() => {
    fetchReadiness();
  }, [fetchReadiness]);

  const handleMarkReady = async () => {
    setUpdating(true);
    try {
      const res = await POST(`/api/ulangan/exams/${exam.id}/status`, { status: 'ready' });
      if (res.success) {
        toast('success', 'Status ulangan berhasil diubah menjadi SIAP');
        onStatusChanged('ready');
      } else {
        toast('error', res.error || 'Gagal mengubah status');
      }
    } catch {
      toast('error', 'Terjadi kesalahan sistem');
    } finally {
      setUpdating(false);
    }
  };

  const isDraft = exam.status === 'draft' || exam.status === 'configuration';

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div
        style={{
          background: C.white,
          border: `1.5px solid ${C.borderMid}`,
          borderRadius: '12px',
          padding: '18px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                color: readiness?.ready ? C.green : '#dc2626',
                background: readiness?.ready ? C.greenLight : '#fef2f2',
                border: `1px solid ${readiness?.ready ? C.greenBorder : '#fecaca'}`,
                fontSize: '11px',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '999px',
              }}
            >
              {readiness?.ready ? 'SIAP DILAKSANAKAN' : 'BELUM LENGKAP'}
            </span>
            <span style={{ fontSize: '12px', color: C.textMid, fontWeight: 700 }}>
              Pemeriksaan Kesiapan Ulangan
            </span>
          </div>
          <p style={{ fontSize: '11.5px', color: C.textFaint, marginTop: '4px' }}>
            Sebelum ulangan dibuka untuk siswa, pastikan butir soal, peserta kelas, dan token ujian sudah siap.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button variant="secondary" size="sm" onClick={fetchReadiness} disabled={loading || updating}>
            <RefreshCw size={13} /> Refresh
          </Button>
          {isDraft && readiness?.ready && (
            <Button size="sm" onClick={handleMarkReady} loading={updating}>
              <CheckCircle2 size={13} /> Tandai Siap Ujian
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <Spinner />
          <p className="text-xs text-gray-400 mt-2">Memeriksa kriteria kesiapan...</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {readiness?.checks.map((c) => (
            <div
              key={c.key}
              style={{
                background: C.white,
                border: `1.5px solid ${c.ok ? C.borderMid : '#fecaca'}`,
                borderRadius: '12px',
                padding: '14px 16px',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start',
              }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}>
                {c.ok ? (
                  <CheckCircle2 size={18} className="text-emerald-700" />
                ) : c.blocking ? (
                  <XCircle size={18} className="text-red-500" />
                ) : (
                  <AlertCircle size={18} className="text-amber-500" />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '12.5px', fontWeight: 800, color: c.ok ? C.text : '#b91c1c' }}>
                  {c.message}
                </p>
                <p style={{ fontSize: '11px', color: C.textFaint, marginTop: '2px' }}>
                  Kunci: <code>{c.key}</code> {c.blocking && !c.ok && '• Memblokir aktivasi'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
