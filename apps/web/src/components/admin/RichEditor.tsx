'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { POST } from '@/lib/api';
import { Bold, Italic, Underline, Strikethrough, ListOrdered, List, Image, Music, Code, Type } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// TipTap-like Rich Editor (Zero-dependency, custom implementation)
// Supports: Bold, Italic, Underline, Math (KaTeX), RTL, Image/Audio upload
// ═══════════════════════════════════════════════════════════════

interface RichEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

// ── KaTeX Rendering ──────────────────────────────────────────
let katexLoaded = false;
let katexPromise: Promise<void> | null = null;

function loadKaTeX(): Promise<void> {
  if (katexLoaded) return Promise.resolve();
  if (katexPromise) return katexPromise;
  katexPromise = new Promise((resolve) => {
    if (!document.querySelector('link[href*="katex"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
      document.head.appendChild(link);
    }
    if ((window as any).katex) { katexLoaded = true; resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
    script.onload = () => { katexLoaded = true; resolve(); };
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  return katexPromise;
}

function renderKaTeX(latex: string): string {
  try {
    if ((window as any).katex) {
      return (window as any).katex.renderToString(latex, { throwOnError: false, displayMode: false });
    }
  } catch {}
  return `<code>${latex}</code>`;
}

export default function RichEditor({ value, onChange, placeholder = 'Tulis di sini...', minHeight = 150 }: RichEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const [showMathInput, setShowMathInput] = useState(false);
  const [mathExpr, setMathExpr] = useState('');
  const [mathPreview, setMathPreview] = useState('');
  const [isRTL, setIsRTL] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [sourceCode, setSourceCode] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const initRef = useRef(false);

  // Load KaTeX on mount
  useEffect(() => { loadKaTeX(); }, []);

  // Initialize editor content only once
  useEffect(() => {
    if (editorRef.current && !initRef.current) {
      editorRef.current.innerHTML = value || '';
      initRef.current = true;
    }
  }, [value]);

  // ── Save & Restore Selection ────────────────────────────────
  // This is the key fix: before a toolbar button steals focus,
  // we save the current selection so execCommand works correctly.
  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    if (!savedRangeRef.current) {
      // If no saved range, just focus the editor
      editorRef.current?.focus();
      return;
    }
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
    editorRef.current?.focus();
  }, []);

  // ── Sync content on input ───────────────────────────────────
  const handleInput = useCallback(() => {
    if (editorRef.current && !showSource) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange, showSource]);

  // ── Toolbar Commands ────────────────────────────────────────
  // Uses mouseDown (not onClick) to prevent editor from losing focus/selection
  const exec = useCallback((cmd: string, val?: string) => {
    restoreSelection();
    document.execCommand(cmd, false, val ?? undefined);
    handleInput();
  }, [restoreSelection, handleInput]);

  const toggleBold = () => exec('bold');
  const toggleItalic = () => exec('italic');
  const toggleUnderline = () => exec('underline');
  const toggleStrike = () => exec('strikeThrough');
  const toggleOL = () => exec('insertOrderedList');
  const toggleUL = () => exec('insertUnorderedList');

  // ── RTL Toggle ─────────────────────────────────────────────
  const toggleRTL = () => {
    const next = !isRTL;
    setIsRTL(next);
    if (editorRef.current) {
      editorRef.current.dir = next ? 'rtl' : 'ltr';
      editorRef.current.style.textAlign = next ? 'right' : 'left';
    }
  };

  // ── Math Insert ────────────────────────────────────────────
  const openMath = () => {
    saveSelection(); // save before modal opens
    setShowMathInput(true);
    setMathExpr('');
    setMathPreview('');
  };

  const updateMathPreview = (expr: string) => {
    setMathExpr(expr);
    if (expr.trim()) {
      loadKaTeX().then(() => setMathPreview(renderKaTeX(expr)));
    } else {
      setMathPreview('');
    }
  };

  const insertMath = () => {
    if (!mathExpr.trim()) return;
    const html = renderKaTeX(mathExpr);
    const mathSpan = `<span class="math-inline" data-latex="${encodeURIComponent(mathExpr)}" contenteditable="false" style="display:inline-block;padding:0 2px;cursor:default;">${html}</span>&nbsp;`;
    restoreSelection();
    document.execCommand('insertHTML', false, mathSpan);
    handleInput();
    setShowMathInput(false);
    setMathExpr('');
  };

  // ── R2 Image Upload ────────────────────────────────────────
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('File harus berupa gambar'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('Ukuran maksimal 5MB'); return; }

    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const r = await POST<{ key: string; url: string }>('/api/admin/upload', fd);
    setUploading(false);

    if (r.success && r.data) {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      restoreSelection();
      document.execCommand('insertHTML', false, `<img src="${apiUrl}${r.data.url}" alt="gambar" style="max-width:100%;border-radius:8px;margin:8px 0;" />`);
      handleInput();
    } else {
      alert(r.error || 'Upload gagal');
    }
    e.target.value = '';
  };

  // ── R2 Audio Upload ────────────────────────────────────────
  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) { alert('File harus berupa audio'); return; }
    if (file.size > 20 * 1024 * 1024) { alert('Ukuran maksimal 20MB'); return; }

    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    const r = await POST<{ key: string; url: string }>('/api/admin/upload', fd);
    setUploading(false);

    if (r.success && r.data) {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      restoreSelection();
      document.execCommand('insertHTML', false, `<audio controls controlsList="nodownload" preload="auto" style="width:100%;margin:8px 0;"><source src="${apiUrl}${r.data.url}" /></audio>`);
      handleInput();
    } else {
      alert(r.error || 'Upload gagal');
    }
    e.target.value = '';
  };

  // ── Source Code Toggle ─────────────────────────────────────
  const toggleSource = () => {
    if (!showSource) {
      setSourceCode(editorRef.current?.innerHTML || '');
      setShowSource(true);
    } else {
      if (editorRef.current) {
        editorRef.current.innerHTML = sourceCode;
        onChange(sourceCode);
      }
      setShowSource(false);
    }
  };

  const handleSourceChange = (val: string) => {
    setSourceCode(val);
    onChange(val);
  };

  // ── Toolbar Button Component ───────────────────────────────
  // Uses onMouseDown + preventDefault to prevent editor losing focus/selection
  const TB = ({
    onMouseDown,
    active,
    children,
    title,
  }: {
    onMouseDown: (e: React.MouseEvent) => void;
    active?: boolean;
    children: React.ReactNode;
    title: string;
  }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault(); // ← prevents editor from losing focus
        onMouseDown(e);
      }}
      className={`w-7 h-7 flex items-center justify-center rounded text-xs transition-colors
        ${active ? 'bg-primary-100 text-primary-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
    >
      {children}
    </button>
  );

  return (
    <>
      {/* Inject editor styles once */}
      <style>{`
        .rich-editor-content:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
        .rich-editor-content img {
          max-width: 100%;
          border-radius: 8px;
        }
        .rich-editor-content b, .rich-editor-content strong { font-weight: 700; }
        .rich-editor-content i, .rich-editor-content em { font-style: italic; }
        .rich-editor-content u { text-decoration: underline; }
        .rich-editor-content s { text-decoration: line-through; }
        .rich-editor-content ul { list-style: disc; padding-left: 1.5rem; }
        .rich-editor-content ol { list-style: decimal; padding-left: 1.5rem; }
      `}</style>

      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-gray-50/50 flex-wrap">
          <TB onMouseDown={toggleBold} title="Tebal (Ctrl+B)"><Bold size={14} /></TB>
          <TB onMouseDown={toggleItalic} title="Miring (Ctrl+I)"><Italic size={14} /></TB>
          <TB onMouseDown={toggleUnderline} title="Garis Bawah (Ctrl+U)"><Underline size={14} /></TB>
          <TB onMouseDown={toggleStrike} title="Coret"><Strikethrough size={14} /></TB>
          <span className="w-px h-4 bg-gray-200 mx-1" />
          <TB onMouseDown={toggleOL} title="Daftar Nomor"><ListOrdered size={14} /></TB>
          <TB onMouseDown={toggleUL} title="Daftar Bullet"><List size={14} /></TB>
          <span className="w-px h-4 bg-gray-200 mx-1" />
          <TB onMouseDown={(e) => { e.preventDefault(); toggleRTL(); }} active={isRTL} title="Arah Teks (RTL/LTR)"><Type size={13} /></TB>
          <TB onMouseDown={(e) => { e.preventDefault(); openMath(); }} title="Rumus Matematika">
            <span className="text-[11px] font-serif italic">fx</span>
          </TB>
          <span className="w-px h-4 bg-gray-200 mx-1" />
          <TB onMouseDown={(e) => { e.preventDefault(); fileInputRef.current?.click(); }} title="Upload Gambar">
            <Image size={14} />
          </TB>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
          <TB onMouseDown={(e) => { e.preventDefault(); audioInputRef.current?.click(); }} title="Upload Audio">
            <Music size={14} />
          </TB>
          <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} />
          <span className="w-px h-4 bg-gray-200 mx-1" />
          <TB onMouseDown={(e) => { e.preventDefault(); toggleSource(); }} active={showSource} title="Kode HTML">
            <Code size={14} />
          </TB>
          {uploading && <span className="text-[10px] text-gray-400 ml-2 animate-pulse">Mengupload...</span>}
        </div>

        {/* Editor Area */}
        {showSource ? (
          <textarea
            value={sourceCode}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="w-full px-3 py-2 text-sm font-mono text-gray-700 bg-gray-50 outline-none resize-none"
            style={{ minHeight }}
            spellCheck={false}
          />
        ) : (
          <div
            ref={editorRef}
            contentEditable
            onInput={handleInput}
            onSelect={saveSelection}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            className="rich-editor-content px-3 py-2 text-sm text-gray-800 outline-none overflow-y-auto"
            style={{ minHeight }}
            data-placeholder={placeholder}
            suppressContentEditableWarning
          />
        )}

        {/* Math Input Modal */}
        {showMathInput && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setShowMathInput(false)}>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
            <div className="relative bg-white rounded-2xl w-full max-w-md shadow-2xl p-5" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-gray-900 text-sm mb-3">Sisipkan Rumus Matematika</h3>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ekspresi LaTeX</label>
                  <input
                    value={mathExpr}
                    onChange={e => updateMathPreview(e.target.value)}
                    placeholder="contoh: \frac{a}{b}, x^2, \sqrt{n}"
                    className="w-full px-3 py-2 mt-1 text-sm font-mono bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-primary-500"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') insertMath(); }}
                  />
                </div>

                {/* Quick buttons */}
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: 'Pecahan', val: '\\frac{a}{b}' },
                    { label: 'Pangkat', val: 'x^{2}' },
                    { label: 'Akar', val: '\\sqrt{x}' },
                    { label: 'Sigma', val: '\\sum_{i=1}^{n}' },
                    { label: 'Integral', val: '\\int_{a}^{b}' },
                    { label: 'Pi', val: '\\pi' },
                    { label: 'Theta', val: '\\theta' },
                    { label: 'Infinity', val: '\\infty' },
                    { label: '≤', val: '\\leq' },
                    { label: '≥', val: '\\geq' },
                    { label: '≠', val: '\\neq' },
                    { label: '±', val: '\\pm' },
                  ].map(q => (
                    <button key={q.val} type="button"
                      onClick={() => updateMathPreview(mathExpr + q.val)}
                      className="px-2 py-1 text-[10px] bg-gray-100 hover:bg-gray-200 rounded font-mono text-gray-600 transition-colors">
                      {q.label}
                    </button>
                  ))}
                </div>

                {/* Preview */}
                {mathPreview && (
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <p className="text-[10px] text-gray-400 mb-1 uppercase font-semibold">Preview</p>
                    <div className="text-lg" dangerouslySetInnerHTML={{ __html: mathPreview }} />
                  </div>
                )}

                <div className="flex gap-2 justify-end pt-1">
                  <button type="button" onClick={() => setShowMathInput(false)}
                    className="px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
                    Batal
                  </button>
                  <button type="button" onClick={insertMath} disabled={!mathExpr.trim()}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50">
                    Sisipkan
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
