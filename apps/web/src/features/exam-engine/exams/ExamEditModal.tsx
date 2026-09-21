'use client';
import React from 'react';
import { Modal, Input, Textarea, Select, Button } from '@/components/ui';
import RichEditor from '@/components/admin/RichEditor';
import { Shield, Sparkles } from 'lucide-react';
import type { Exam, CbtEvent } from '../types';
import { DEFAULT_RULES_TEMPLATE, DEFAULT_COMPLETION_MESSAGE } from '../types';
import { C } from '../components/theme';

export function ExamEditModal({
  open,
  onClose,
  editExam,
  setEditExam,
  events,
  jalurList,
  saving,
  saveExam,
}: {
  open: boolean;
  onClose: () => void;
  editExam: Partial<Exam> | null;
  setEditExam: React.Dispatch<React.SetStateAction<Partial<Exam> | null>>;
  events: CbtEvent[];
  jalurList: string[];
  saving: boolean;
  saveExam: () => Promise<void>;
}) {
  if (!editExam) return null;

  return (
    <Modal open={open} onClose={onClose} title={editExam.id ? 'Edit Ujian' : 'Buat Ujian'} size="lg">
      <div className="space-y-3">
        <Input label="Judul" value={editExam.title || ''} onChange={e => setEditExam({ ...editExam, title: e.target.value })} />
        <Textarea label="Deskripsi" value={editExam.description || ''} rows={2} onChange={e => setEditExam({ ...editExam, description: e.target.value })} />
        <Select
          label="Kegiatan"
          value={editExam.event_id || ''}
          onChange={e => setEditExam({ ...editExam, event_id: e.target.value })}
          options={[{ value: '', label: 'Pilih kegiatan' }, ...events.map(event => ({ value: event.id, label: `${event.code} · ${event.name}` }))]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Mapel / bagian" placeholder="Contoh: Matematika" value={editExam.subject_name || ''} onChange={e => setEditExam({ ...editExam, subject_name: e.target.value })} />
          <Input label="Urutan mapel" type="number" min={0} value={editExam.sequence_order ?? 1} onChange={e => setEditExam({ ...editExam, sequence_order: parseInt(e.target.value) || 0 })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Durasi (menit)" type="number" value={editExam.duration_minutes || 60} onChange={e => setEditExam({ ...editExam, duration_minutes: parseInt(e.target.value) })} />
          <Select
            label="Status"
            value={editExam.active_status || 'draft'}
            onChange={e => setEditExam({ ...editExam, active_status: e.target.value })}
            options={[{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Aktif' }, { value: 'finished', label: 'Selesai' }]}
          />
        </div>
        {/* Target Jalur */}
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: C.textMid, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px' }}>Target Peserta (Jalur)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setEditExam({ ...editExam, target_jalur: null })}
              style={{ padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', border: `1.5px solid ${!editExam.target_jalur ? C.green : C.borderMid}`, background: !editExam.target_jalur ? C.greenLight : C.white, color: !editExam.target_jalur ? C.green : C.textMuted }}
            >
              Semua Jalur
            </button>
            {jalurList.map(j => {
              const selected = (editExam.target_jalur || '').split(',').map(s => s.trim().toLowerCase()).includes(j.toLowerCase());
              const toggle = () => {
                const current = editExam.target_jalur ? editExam.target_jalur.split(',').map(s => s.trim()).filter(Boolean) : [];
                const next = selected ? current.filter(c => c.toLowerCase() !== j.toLowerCase()) : [...current, j];
                setEditExam({ ...editExam, target_jalur: next.length ? next.join(',') : null });
              };
              return (
                <button
                  key={j}
                  type="button"
                  onClick={toggle}
                  style={{ padding: '5px 12px', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', cursor: 'pointer', border: `1.5px solid ${selected ? '#1a5fa8' : C.borderMid}`, background: selected ? '#e0f0ff' : C.white, color: selected ? '#1a5fa8' : C.textMuted }}
                >
                  {j}
                </button>
              );
            })}
          </div>
          {editExam.target_jalur && <p style={{ color: C.textMuted, fontSize: '10.5px', marginTop: '4px' }}>Hanya peserta dengan jalur terpilih yang bisa melihat ujian ini.</p>}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-500">Tata Tertib</label>
            <button
              type="button"
              onClick={() => setEditExam({ ...editExam, rules_text: DEFAULT_RULES_TEMPLATE })}
              className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 hover:underline flex items-center gap-1 cursor-pointer"
              title="Gunakan template tata tertib bawaan"
            >
              <Sparkles size={12} /> Isi Template Bawaan
            </button>
          </div>
          <RichEditor value={editExam.rules_text || ''} onChange={v => setEditExam({ ...editExam, rules_text: v })} minHeight={80} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-500">Pesan Selesai</label>
            <button
              type="button"
              onClick={() => setEditExam({ ...editExam, completion_message: DEFAULT_COMPLETION_MESSAGE })}
              className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 hover:underline flex items-center gap-1 cursor-pointer"
              title="Gunakan template pesan selesai bawaan"
            >
              <Sparkles size={12} /> Isi Template Bawaan
            </button>
          </div>
          <Textarea
            value={editExam.completion_message || ''}
            rows={5}
            placeholder={'Contoh:\nTerima kasih sudah mengikuti ujian.\n- Tetap duduk di tempat\n- Tunggu instruksi proktor'}
            onChange={e => setEditExam({ ...editExam, completion_message: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600">
          {[{ k: 'randomize_questions', l: 'Acak Soal' }, { k: 'randomize_options', l: 'Acak Opsi' }, { k: 'is_score_visible', l: 'Tampilkan Skor' }, { k: 'enforce_fullscreen', l: 'Wajib Fullscreen' }].map(c => (
            <label key={c.k} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={!!(editExam as any)[c.k]}
                onChange={e => setEditExam({ ...editExam, [c.k]: e.target.checked ? 1 : 0 })}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              {c.l}
            </label>
          ))}
        </div>
        {/* ── Anti-Cheat ── */}
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-3">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
            <Shield size={14} className="text-amber-600" /> Pengaturan Anti-Cheat
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Input
                type="number"
                label="Batas Pelanggaran"
                value={String((editExam as any).cheat_limit ?? 3)}
                onChange={e => setEditExam({ ...editExam, cheat_limit: parseInt(e.target.value) || 3 })}
              />
              <p className="text-[10px] text-amber-700 mt-1">Berapa kali pelanggaran sebelum aksi dieksekusi</p>
            </div>
            <div>
              <Select
                label="Aksi Saat Batas Tercapai"
                value="lock"
                onChange={() => setEditExam({ ...editExam, cheat_action: 'lock' })}
                options={[
                  { value: 'lock', label: '🔒 Kunci Sesi (Proktor buka)' },
                ]}
              />
              <p className="text-[10px] text-amber-700 mt-1">"Kunci" = proktor bisa buka kembali sesi</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Batal</Button>
          <Button size="sm" loading={saving} onClick={saveExam}>Simpan</Button>
        </div>
      </div>
    </Modal>
  );
}

export default ExamEditModal;
