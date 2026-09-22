'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, DEL } from '@/lib/api';
import { Button, useToast, Spinner, Confirm } from '@/components/ui';
import { Users, UserCheck, RefreshCw, Trash2, ShieldAlert } from 'lucide-react';
import { C } from '../exam-engine/components/theme';
import type { UlanganExam, UlanganRosterParticipant } from './types';

interface Props {
  exam: UlanganExam;
  onRosterUpdated?: () => void;
}

export function UlanganRosterTab({ exam, onRosterUpdated }: Props) {
  const { toast } = useToast();
  const [participants, setParticipants] = useState<UlanganRosterParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchRoster = useCallback(async () => {
    setLoading(true);
    try {
      const res = await GET<UlanganRosterParticipant[]>(`/api/ulangan/exams/${exam.id}/roster`);
      if (res.success && res.data) {
        setParticipants(res.data);
      }
    } catch {
      toast('error', 'Gagal memuat peserta ulangan');
    } finally {
      setLoading(false);
    }
  }, [exam.id, toast]);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const handleSnapshotClass = async () => {
    setSnapshotting(true);
    try {
      const res = await POST<{ snapshotted_count: number }>(
        `/api/ulangan/exams/${exam.id}/roster/snapshot-class`,
        {}
      );
      if (res.success) {
        toast('success', res.message || `Berhasil mensinkronkan peserta`);
        fetchRoster();
        onRosterUpdated?.();
      } else {
        toast('error', res.error || 'Gagal sinkronisasi peserta');
      }
    } catch {
      toast('error', 'Terjadi kesalahan sistem saat sinkronisasi peserta');
    } finally {
      setSnapshotting(false);
    }
  };

  const handleClearRoster = async () => {
    setClearing(true);
    try {
      const res = await DEL(`/api/ulangan/exams/${exam.id}/roster`);
      if (res.success) {
        toast('success', 'Daftar peserta berhasil dikosongkan');
        fetchRoster();
        onRosterUpdated?.();
      } else {
        toast('error', res.error || 'Gagal menghapus peserta');
      }
    } catch {
      toast('error', 'Terjadi kesalahan');
    } finally {
      setClearing(false);
      setShowClearConfirm(false);
    }
  };

  const isEditable = exam.status === 'draft' || exam.status === 'configuration';

  return (
    <div className="space-y-4">
      {/* Control Banner */}
      <div
        style={{
          background: C.white,
          border: `1.5px solid ${C.borderMid}`,
          borderRadius: '12px',
          padding: '16px 20px',
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
                color: C.green,
                background: C.greenLight,
                border: `1px solid ${C.greenBorder}`,
                fontSize: '11px',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '999px',
              }}
            >
              KELAS {exam.class_name || 'TERTENTU'}
            </span>
            <span style={{ fontSize: '12px', color: C.textMid, fontWeight: 700 }}>
              {participants.length} Siswa Terdaftar
            </span>
          </div>
          <p style={{ fontSize: '11.5px', color: C.textFaint, marginTop: '4px' }}>
            Peserta disinkronkan langsung dari data siswa aktif kelas <b>{exam.class_name}</b> di Mansatas.
            Tidak memerlukan pembagian kartu ruangan ujian.
          </p>
        </div>

        {isEditable && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {participants.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowClearConfirm(true)}
                disabled={clearing || snapshotting}
                style={{ color: '#dc2626' }}
              >
                <Trash2 size={13} /> Kosongkan Peserta
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSnapshotClass}
              loading={snapshotting}
              disabled={clearing}
            >
              <RefreshCw size={13} /> {participants.length === 0 ? 'Sinkronkan Peserta Kelas' : 'Update Peserta Kelas'}
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center">
          <Spinner />
          <p className="text-xs text-gray-400 mt-2">Memuat daftar peserta...</p>
        </div>
      ) : participants.length === 0 ? (
        <div
          style={{
            background: C.white,
            border: `1.5px dashed ${C.borderMid}`,
            borderRadius: '12px',
            padding: '36px 20px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '999px',
              background: C.greenLight,
              color: C.green,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '10px',
            }}
          >
            <Users size={22} />
          </div>
          <h3 style={{ fontSize: '14px', fontWeight: 800, color: C.text }}>
            Belum Ada Peserta Terdaftar
          </h3>
          <p style={{ fontSize: '12px', color: C.textMid, maxWidth: '420px', margin: '6px auto 16px' }}>
            Siswa kelas <b>{exam.class_name}</b> belum dimasukkan ke roster ujian ini.
            Klik tombol di bawah untuk mengambil seluruh data siswa aktif dari Mansatas.
          </p>
          {isEditable && (
            <Button size="sm" onClick={handleSnapshotClass} loading={snapshotting}>
              <UserCheck size={14} /> Sinkronkan Siswa Kelas Sekarang
            </Button>
          )}
        </div>
      ) : (
        <div
          style={{
            background: C.white,
            border: `1.5px solid ${C.borderMid}`,
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', width: '40px' }}>
                    #
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>
                    NISN / Akun
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>
                    Nama Siswa
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'left', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>
                    Kelas
                  </th>
                  <th style={{ padding: '10px 14px', textAlign: 'center', color: C.textMid, fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase' }}>
                    Status Ruangan
                  </th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p, idx) => (
                  <tr
                    key={p.id}
                    style={{
                      borderBottom: idx < participants.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                    }}
                  >
                    <td style={{ padding: '10px 14px', color: C.textFaint, fontWeight: 700 }}>
                      {idx + 1}
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '11px', color: C.textMid, fontWeight: 600 }}>
                      {p.nisn || p.username}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: C.text }}>
                      {p.full_name}
                    </td>
                    <td style={{ padding: '10px 14px', color: C.textMid, fontWeight: 600 }}>
                      {p.class_name}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                      <span
                        style={{
                          background: '#edf0ed',
                          color: '#49574b',
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '999px',
                        }}
                      >
                        Langsung di Kelas
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Confirm
        open={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearRoster}
        title="Kosongkan Peserta Ulangan?"
        message="Daftar peserta ulangan ini akan dihapus. Anda dapat melakukan sinkronisasi ulang kapan saja sebelum ujian dimulai."
      />
    </div>
  );
}
