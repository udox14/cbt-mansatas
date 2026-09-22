'use client';

import React, { useState } from 'react';
import { Modal, Button, useToast } from '@/components/ui';
import { POST, PUT } from '@/lib/api';
import { C } from '../exam-engine/components/theme';
import type { KegiatanEvent } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  event?: KegiatanEvent | null;
  onSuccess: (savedEventId?: string) => void;
}

export function KegiatanEventForm({ open, onClose, event, onSuccess }: Props) {
  const { toast } = useToast();
  const isEdit = Boolean(event);

  const [code, setCode] = useState(event?.code || '');
  const [name, setName] = useState(event?.name || '');
  const [description, setDescription] = useState(event?.description || '');
  const [startsAt, setStartsAt] = useState(event?.starts_at ? event.starts_at.slice(0, 10) : '');
  const [endsAt, setEndsAt] = useState(event?.ends_at ? event.ends_at.slice(0, 10) : '');
  const [proctorBefore, setProctorBefore] = useState(event?.proctor_access_before_minutes ?? 30);
  const [proctorAfter, setProctorAfter] = useState(event?.proctor_access_after_minutes ?? 45);
  const [saving, setSaving] = useState(false);

  // Sync when event changes
  React.useEffect(() => {
    if (event) {
      setCode(event.code || '');
      setName(event.name || '');
      setDescription(event.description || '');
      setStartsAt(event.starts_at ? event.starts_at.slice(0, 10) : '');
      setEndsAt(event.ends_at ? event.ends_at.slice(0, 10) : '');
      setProctorBefore(event.proctor_access_before_minutes ?? 30);
      setProctorAfter(event.proctor_access_after_minutes ?? 45);
    } else {
      setCode('');
      setName('');
      setDescription('');
      setStartsAt('');
      setEndsAt('');
      setProctorBefore(30);
      setProctorAfter(45);
    }
  }, [event, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();

    if (!cleanCode) {
      toast('error', 'Kode kegiatan wajib diisi');
      return;
    }
    if (!cleanName) {
      toast('error', 'Nama kegiatan wajib diisi');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        code: cleanCode,
        name: cleanName,
        description: description.trim() || null,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        proctor_access_before_minutes: Number(proctorBefore),
        proctor_access_after_minutes: Number(proctorAfter),
        participant_source: 'mansatas',
      };

      if (isEdit && event) {
        const res = await PUT(`/api/kegiatan/events/${event.id}`, payload);
        if (res.success) {
          toast('success', 'Kegiatan berhasil diperbarui');
          onSuccess(event.id);
          onClose();
        } else {
          toast('error', res.error || 'Gagal memperbarui kegiatan');
        }
      } else {
        const res = await POST<{ id: string }>('/api/kegiatan/events', payload);
        if (res.success && res.data) {
          toast('success', 'Kegiatan berhasil dibuat');
          onSuccess(res.data.id);
          onClose();
        } else {
          toast('error', res.error || 'Gagal membuat kegiatan');
        }
      }
    } catch {
      toast('error', 'Terjadi kesalahan jaringan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Ubah Informasi Kegiatan' : 'Buat Kegiatan / Lomba Baru'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Kode Kegiatan <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Contoh: OSN-K-2026, OMI-2026, TRYOUT-01"
            disabled={isEdit}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: '8px',
              border: `1.5px solid ${C.border}`,
              background: isEdit ? '#f9fafb' : C.white,
              fontSize: '13px',
              marginTop: '4px',
              fontWeight: 600,
            }}
          />
          <p style={{ fontSize: '10.5px', color: C.textFaint, marginTop: '3px' }}>
            Identifier unik alfanumerik huruf besar (tidak dapat diubah setelah dibuat).
          </p>
        </div>

        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Nama Kegiatan <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Seleksi Olimpiade Sains Nasional Tingkat Madrasah"
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: '8px',
              border: `1.5px solid ${C.border}`,
              background: C.white,
              fontSize: '13px',
              marginTop: '4px',
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Deskripsi / Keterangan (Opsional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Keterangan singkat mengenai tujuan atau pelaksanaan kegiatan..."
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: '8px',
              border: `1.5px solid ${C.border}`,
              background: C.white,
              fontSize: '12.5px',
              marginTop: '4px',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>
              Tanggal Mulai
            </label>
            <input
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '8px',
                border: `1.5px solid ${C.border}`,
                background: C.white,
                fontSize: '12.5px',
                marginTop: '4px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>
              Tanggal Selesai
            </label>
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '8px',
                border: `1.5px solid ${C.border}`,
                background: C.white,
                fontSize: '12.5px',
                marginTop: '4px',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={{ fontSize: '10.5px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>
              Akses Proktor Sebelum (Menit)
            </label>
            <input
              type="number"
              min={0}
              max={180}
              value={proctorBefore}
              onChange={(e) => setProctorBefore(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '8px',
                border: `1.5px solid ${C.border}`,
                background: C.white,
                fontSize: '12.5px',
                marginTop: '4px',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10.5px', fontWeight: 700, color: C.textMid, textTransform: 'uppercase' }}>
              Akses Proktor Sesudah (Menit)
            </label>
            <input
              type="number"
              min={0}
              max={240}
              value={proctorAfter}
              onChange={(e) => setProctorAfter(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '8px',
                border: `1.5px solid ${C.border}`,
                background: C.white,
                fontSize: '12.5px',
                marginTop: '4px',
              }}
            />
          </div>
        </div>

        <div style={{ background: C.greenLight, border: `1.5px solid ${C.greenBorder}`, borderRadius: '9px', padding: '10px 12px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: C.green }}>Sumber Peserta: SISWA MADRASAH (MANSATAS-DB)</p>
          <p style={{ fontSize: '10px', color: C.textMid, marginTop: '2px' }}>
            Peserta dipilih langsung dari direktori siswa aktif madrasah dan disnapshot ke roster kegiatan.
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '10px', borderTop: `1px solid ${C.border}` }}>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={saving}>
            {saving ? 'Menyimpan...' : isEdit ? 'Perbarui Kegiatan' : 'Simpan Kegiatan'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
