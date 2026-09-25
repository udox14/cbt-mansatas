'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { GET, POST, PUT, DEL } from '@/lib/api';
import { Button, Modal, EmptyState, useToast, Confirm, Spinner } from '@/components/ui';
import RichEditor from '@/components/admin/RichEditor';
import BulkImport from '@/components/admin/BulkImport';
import MathContent from '@/components/content/MathContent';
import { isFullArabic } from '@/lib/rtl';
import { Plus, Pencil, Trash2, Upload, Image, Volume2, X, Sparkles } from 'lucide-react';
import type { Question, QOption } from '../types';
import { C } from '../components/theme';
import { AiQuestionGenerator } from './AiQuestionGenerator';

function getQuestionSummary(html: string): { typeBadge?: string; text: string } {
  if (!html) return { text: '' };

  let badge: string | undefined;
  if (/class=["']cbt-dialogue["']/i.test(html) || /(?:^|\n)[A-Za-z\u0600-\u06FF\s]{2,15}:/m.test(html)) {
    badge = 'Dialog';
  } else if (/class=["']cbt-poem["']/i.test(html)) {
    badge = 'Puisi';
  } else if (/class=["']cbt-stimulus-box["']/i.test(html)) {
    badge = 'Wacana';
  }

  // Strip HTML tags to find lines
  const clean = html.replace(/<[^>]+>/g, '\n').split('\n').map(s => s.trim()).filter(Boolean);
  if (clean.length === 0) return { typeBadge: badge, text: '' };

  // Find the question line: preference to the line with '?' or the last line
  const qLine = clean.slice().reverse().find(line => line.includes('?') && line.length > 8);
  if (qLine && clean.length > 1 && qLine !== clean[0]) {
    return { typeBadge: badge, text: qLine };
  }

  // If no question mark found, clean any boilerplate lead-in from the first line
  const firstLine = clean.join(' ').replace(
    /^\s*(?:Read the following (?:passage|poem|dialogue|text|conversation|story|excerpt) carefully,?\s*(?:then|and)?\s*answer the questions?\s*(?:below|that follow)?\.?\s*|Bacalah (?:teks|paragraf|wacana|kutipan|dialog|puisi|bacaan) berikut (?:ini )?(?:dengan (?:saksama|seksama|teliti))?,?\s*(?:kemudian|lalu)?\s*(?:jawablah|jawab)?\s*(?:pertanyaan|soal)?\s*(?:di bawah ini|berikut)?(?: nomor \d+)?[\.:]?\s*|Perhatikan (?:teks|paragraf|wacana|kutipan|dialog|puisi|pernyataan|tabel|potongan dialog) berikut (?:ini)?[\.:]?\s*)/i,
    ''
  ).trim();

  return { typeBadge: badge, text: firstLine || clean[0] };
}

export function QuestionsView({ examId, apiPrefix = '/api/admin' }: { examId: string; apiPrefix?: string }) {
  const { toast } = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [editQ, setEditQ] = useState<Partial<Question & { options: QOption[] }> | null>(null);
  const [saving, setSaving] = useState(false);
  const [delTarget, setDelTarget] = useState<string | null>(null);
  const [showDelAllModal, setShowDelAllModal] = useState(false);
  const [showDelBatchModal, setShowDelBatchModal] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [showAiGen, setShowAiGen] = useState(false);
  const [uploading, setUploading] = useState('');

  const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

  const fetchQ = useCallback(async () => {
    const r = await GET<Question[]>(`${apiPrefix}/exams/${examId}/questions`);
    if (r.success) {
      const list = r.data || [];
      setQuestions(list);
      setSelectedIds(prev => {
        const valid = new Set(list.map(q => q.id));
        const next = new Set<string>();
        prev.forEach(id => { if (valid.has(id)) next.add(id); });
        return next;
      });
    }
    setLoading(false);
  }, [examId, apiPrefix]);
  useEffect(() => { fetchQ(); }, [fetchQ]);

  const toggleSelectOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === questions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(questions.map(q => q.id)));
    }
  };

  const handleDeleteBatch = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    const r = await POST<{ deleted_count?: number }>(
      `${apiPrefix}/exams/${examId}/questions/delete-batch`,
      { question_ids: Array.from(selectedIds) }
    );
    setBatchDeleting(false);
    if (r.success) {
      toast('success', `${selectedIds.size} butir soal berhasil dihapus`);
      setSelectedIds(new Set());
      setShowDelBatchModal(false);
      fetchQ();
    } else {
      toast('error', r.error || 'Gagal menghapus butir soal terpilih');
    }
  };

  const handleDeleteAll = async () => {
    setBatchDeleting(true);
    const r = await POST<{ deleted_count?: number }>(
      `${apiPrefix}/exams/${examId}/questions/delete-batch`,
      { all: true }
    );
    setBatchDeleting(false);
    if (r.success) {
      toast(
        'success',
        r.data?.deleted_count
          ? `${r.data.deleted_count} butir soal berhasil dihapus`
          : 'Semua butir soal berhasil dihapus'
      );
      setSelectedIds(new Set());
      setShowDelAllModal(false);
      fetchQ();
    } else {
      toast('error', r.error || 'Gagal menghapus seluruh butir soal');
    }
  };

  const saveQ = async () => {
    if (!editQ?.question_text) { toast('error', 'Teks soal wajib'); return; }
    setSaving(true);
    const r = editQ.id
      ? await PUT(`${apiPrefix}/questions/${editQ.id}`, editQ)
      : await POST(`${apiPrefix}/exams/${examId}/questions`, { ...editQ, question_order: questions.length + 1 });
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
    const fd = new FormData();
    fd.append('file', file);
    fd.append('exam_id', examId);
    const r = await POST<{ url: string }>(`${apiPrefix}/upload`, fd);
    setUploading('');
    if (r.success && r.data) { setEditQ(prev => prev ? { ...prev, [type === 'image' ? 'image_url' : 'audio_url']: r.data!.url } : null); toast('success', 'Upload berhasil'); }
    else toast('error', r.error || 'Gagal');
    e.target.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span style={{ color: C.textMid, fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {questions.length} Soal
          </span>
          {questions.length > 0 && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-gray-600 select-none hover:text-gray-900">
              <input
                type="checkbox"
                checked={selectedIds.size > 0 && selectedIds.size === questions.length}
                onChange={toggleSelectAll}
                className="w-3.5 h-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <span className="text-[11px] font-medium text-gray-500">
                {selectedIds.size === questions.length && questions.length > 0 ? 'Batal Semua' : 'Pilih Semua'}
              </span>
            </label>
          )}
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {questions.length > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowDelAllModal(true)}
              title="Hapus semua butir soal ujian sekaligus"
            >
              <Trash2 size={13} /> Hapus Semua
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}><Upload size={13} /> Import</Button>
          <Button variant="secondary" size="sm" onClick={() => setShowAiGen(true)}><Sparkles size={13} /> Buat dengan AI</Button>
          <Button size="sm" onClick={newQ}><Plus size={13} /> Tambah Soal</Button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between px-3.5 py-2 bg-red-50 border border-red-200 rounded-xl text-xs shadow-sm">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
            <span className="font-bold text-red-900">
              {selectedIds.size} butir soal dipilih
            </span>
            <span className="text-red-600 text-[11px] hidden sm:inline">
              (dari total {questions.length} butir)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              className="!text-xs !py-1 !px-2.5 bg-white"
            >
              Batal
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={batchDeleting}
              onClick={() => setShowDelBatchModal(true)}
              className="!text-xs !py-1 !px-2.5"
            >
              <Trash2 size={12} /> Hapus Terpilih ({selectedIds.size})
            </Button>
          </div>
        </div>
      )}

      {loading ? <div className="py-12 text-center"><Spinner /></div>
        : questions.length === 0 ? <EmptyState title="Belum ada soal" />
          : (
            <div style={{ background: C.white, border: `1.5px solid ${C.borderMid}`, borderRadius: '12px', overflow: 'hidden' }}>
              {questions.map((q, i) => (
                <div
                  key={q.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '11px 14px',
                    borderBottom: i < questions.length - 1 ? `1px solid ${C.borderLight}` : 'none',
                    background: selectedIds.has(q.id) ? '#fff5f5' : C.white,
                    transition: 'background-color 0.15s',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(q.id)}
                    onChange={() => toggleSelectOne(q.id)}
                    aria-label={`Pilih nomor ${i + 1}`}
                    className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer flex-shrink-0"
                  />
                  <span style={{ color: C.textFaint, fontSize: '12px', fontWeight: 700, width: '22px', flexShrink: 0 }}>{i + 1}</span>
                  {(() => {
                    const summary = getQuestionSummary(q.question_text);
                    return (
                      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                        {summary.typeBadge && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{
                              background: summary.typeBadge === 'Dialog' ? '#e0f2fe' : summary.typeBadge === 'Puisi' ? '#fef3c7' : '#f1f5f9',
                              color: summary.typeBadge === 'Dialog' ? '#0369a1' : summary.typeBadge === 'Puisi' ? '#b45309' : '#475569',
                            }}
                          >
                            {summary.typeBadge}
                          </span>
                        )}
                        <span
                          style={{ fontSize: '12.5px', color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {summary.text}
                        </span>
                      </div>
                    );
                  })()}
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
        onConfirm={async () => { if (!delTarget) return; await DEL(`${apiPrefix}/questions/${delTarget}`); setDelTarget(null); fetchQ(); }}
        title="Hapus Soal?" message="Soal yang dihapus tidak dapat dikembalikan." />
      <Confirm
        open={showDelBatchModal}
        onClose={() => setShowDelBatchModal(false)}
        onConfirm={handleDeleteBatch}
        title={`Hapus ${selectedIds.size} Soal Terpilih?`}
        message={`Anda akan menghapus ${selectedIds.size} butir soal beserta seluruh pilihan jawabannya secara permanen. Tindakan ini tidak dapat dibatalkan.`}
        confirmText={`Hapus ${selectedIds.size} Soal`}
      />
      <Confirm
        open={showDelAllModal}
        onClose={() => setShowDelAllModal(false)}
        onConfirm={handleDeleteAll}
        title="Hapus Seluruh Soal Ujian?"
        message={`PERINGATAN: Semua (${questions.length}) butir soal beserta seluruh pilihan jawaban dalam ujian ini akan dihapus secara permanen. Tindakan ini tidak dapat dibatalkan.`}
        confirmText="Hapus Semua Soal"
      />
      <BulkImport type="questions" examId={examId} apiPrefix={apiPrefix} open={showImport} onClose={() => setShowImport(false)} onSuccess={() => { setShowImport(false); fetchQ(); }} />
      <AiQuestionGenerator
        examId={examId}
        apiPrefix={apiPrefix}
        open={showAiGen}
        onClose={() => setShowAiGen(false)}
        onSuccess={() => {
          setShowAiGen(false);
          fetchQ();
        }}
      />
    </div>
  );
}

export default QuestionsView;
