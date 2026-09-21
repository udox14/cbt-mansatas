'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, PUT, DEL } from '@/lib/api';
import { Button, Modal, EmptyState, useToast, Confirm, Spinner } from '@/components/ui';
import RichEditor from '@/components/admin/RichEditor';
import BulkImport from '@/components/admin/BulkImport';
import MathContent from '@/components/content/MathContent';
import { isFullArabic } from '@/lib/rtl';
import { Plus, Pencil, Trash2, Upload, Image, Volume2, X } from 'lucide-react';
import type { Question, QOption } from '../types';
import { C } from '../components/theme';

export function QuestionsView({ examId }: { examId: string }) {
  const { toast } = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editQ, setEditQ] = useState<Partial<Question & { options: QOption[] }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [uploading, setUploading] = useState('');
  const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

  const fetchQ = useCallback(async () => {
    const r = await GET<Question[]>(`/api/admin/exams/${examId}/questions`);
    if (r.success) setQuestions(r.data || []);
    setLoading(false);
  }, [examId]);
  useEffect(() => { fetchQ(); }, [fetchQ]);

  const saveQ = async () => {
    if (!editQ?.question_text) { toast('error', 'Teks soal wajib'); return; }
    setSaving(true);
    const r = editQ.id
      ? await PUT(`/api/admin/questions/${editQ.id}`, editQ)
      : await POST(`/api/admin/exams/${examId}/questions`, { ...editQ, question_order: questions.length + 1 });
    setSaving(false);
    if (r.success) { toast('success', 'Berhasil'); setEditQ(null); fetchQ(); } else toast('error', r.error || 'Gagal');
  };
  const newQ = () => setEditQ({
    question_text: '', question_type: 'multiple_choice', image_url: null, audio_url: null,
    options: 'ABCD'.split('').map((l, i) => ({ option_label: l, option_text: '', image_url: null, is_correct: i === 0 ? 1 : 0 }))
  });
  const updOpt = (idx: number, f: string, v: any) => {
    if (!editQ?.options) return;
    const o = [...editQ.options];
    if (f === 'is_correct') o.forEach((x, i) => { x.is_correct = i === idx ? 1 : 0; }); else (o[idx] as any)[f] = v;
    setEditQ({ ...editQ, options: o });
  };
  const upload = async (type: 'image' | 'audio', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUploading(type);
    const fd = new FormData(); fd.append('file', file);
    const r = await POST<{ url: string }>('/api/admin/upload', fd);
    setUploading('');
    if (r.success && r.data) { setEditQ(prev => prev ? { ...prev, [type === 'image' ? 'image_url' : 'audio_url']: r.data!.url } : null); toast('success', 'Upload berhasil'); }
    else toast('error', r.error || 'Gagal');
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{questions.length} Soal</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}><Upload size={13} /> Import</Button>
          <Button size="sm" onClick={newQ}><Plus size={13} /> Tambah Soal</Button>
        </div>
      </div>
      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : questions.length === 0 ? <EmptyState title="Belum ada soal" />
          : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
              {questions.map((q, i) => (
                <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 14px', borderBottom: i < questions.length - 1 ? `1px solid ${C.borderLight}` : 'none' }}>
                  <span style={{ color: C.textFaint, fontSize: '12px', fontWeight: 700, width: '22px', flexShrink: 0 }}>{i + 1}</span>
                  <MathContent
                    html={q.question_text}
                    className="flex-1 min-w-0"
                    style={{ fontSize: '12.5px', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  />
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {q.options?.map(o => (
                      <span key={o.option_label} style={{ background: o.is_correct ? C.greenLight : '#f1f1f0', color: o.is_correct ? '#2d6644' : '#8a9e8d', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px' }}>{o.option_label}</span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => setEditQ(q)} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.greenLight; (e.currentTarget as HTMLElement).style.color = C.green; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}>
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setDelTarget(q.id)} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#fef2f2'; (e.currentTarget as HTMLElement).style.color = '#dc2626'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      <Modal open={!!editQ} onClose={() => setEditQ(null)} title={editQ?.id ? 'Edit Soal' : 'Tambah Soal'} size="lg">
        {editQ && (
          <div className="space-y-3">
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Teks Soal</label>
              <RichEditor value={editQ.question_text || ''} onChange={v => setEditQ({ ...editQ, question_text: v })} minHeight={100} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Gambar</label>
                {editQ.image_url
                  ? <div className="relative"><img src={`${API_URL}${editQ.image_url}`} alt="" className="w-full rounded-lg border max-h-28 object-cover" /><button onClick={() => setEditQ({ ...editQ, image_url: null })} className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"><X size={10} /></button></div>
                  : <label className="flex items-center justify-center gap-1.5 px-3 py-3 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-400 text-xs text-gray-400">{uploading === 'image' ? <Spinner size={14} /> : <><Image size={14} /> Upload Gambar</>}<input type="file" accept="image/*" className="hidden" onChange={e => upload('image', e)} /></label>}
              </div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1">Audio</label>
                {editQ.audio_url
                  ? <div className="relative"><audio controls className="w-full"><source src={`${API_URL}${editQ.audio_url}`} /></audio><button onClick={() => setEditQ({ ...editQ, audio_url: null })} className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"><X size={10} /></button></div>
                  : <label className="flex items-center justify-center gap-1.5 px-3 py-3 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-primary-400 text-xs text-gray-400">{uploading === 'audio' ? <Spinner size={14} /> : <><Volume2 size={14} /> Upload Audio</>}<input type="file" accept="audio/*" className="hidden" onChange={e => upload('audio', e)} /></label>}
              </div>
            </div>
            {editQ.question_type === 'multiple_choice' && editQ.options && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-500">Opsi Jawaban</label>
                <p className="text-[10px] text-gray-400">Untuk rumus, ketik dengan delimiter <code>$...$</code> atau <code>$$...$$</code>.</p>
                {editQ.options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="radio" name="correct" checked={!!o.is_correct} onChange={() => updOpt(i, 'is_correct', true)} className="text-primary-600" />
                    <span className="text-xs font-semibold text-gray-400 w-4">{o.option_label}</span>
                    <input value={o.option_text} onChange={e => updOpt(i, 'option_text', e.target.value)} placeholder={`Opsi ${o.option_label} — contoh $x^2$`} dir="auto"
                      className={`flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 ${isFullArabic(o.option_text) ? 'arabic' : ''}`} />
                  </div>
                ))}
                {editQ.options.length < 5 && (
                  <button onClick={() => setEditQ({ ...editQ, options: [...editQ.options!, { option_label: 'ABCDE'[editQ.options!.length], option_text: '', image_url: null, is_correct: 0 }] })}
                    className="text-xs text-primary-600 font-medium hover:underline">+ Tambah Opsi</button>
                )}
              </div>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="secondary" size="sm" onClick={() => setEditQ(null)}>Batal</Button>
              <Button size="sm" loading={saving} onClick={saveQ}>Simpan</Button>
            </div>
          </div>
        )}
      </Modal>
      <Confirm open={!!delTarget} onClose={() => setDelTarget(null)}
        onConfirm={async () => { if (!delTarget) return; await DEL(`/api/admin/questions/${delTarget}`); setDelTarget(null); fetchQ(); }}
        title="Hapus Soal?" message="Soal yang dihapus tidak dapat dikembalikan." />
      <BulkImport type="questions" examId={examId} open={showImport} onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); fetchQ(); }} />
    </div>
  );
}

export default QuestionsView;
