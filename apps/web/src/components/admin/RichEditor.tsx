'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { POST } from '@/lib/api';

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
// We load KaTeX from CDN and render math expressions
let katexLoaded = false;
let katexPromise: Promise<void> | null = null;

function loadKaTeX(): Promise<void> {
  if (katexLoaded) return Promise.resolve();
  if (katexPromise) return katexPromise;
  katexPromise = new Promise((resolve) => {
    // CSS
    if (!document.querySelector('link[href*="katex"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
      document.head.appendChild(link);
    }
    // JS
    if ((window as any).katex) { katexLoaded = true; resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
    script.onload = () => { katexLoaded = true; resolve(); };
    script.onerror = () => resolve(); // graceful fail
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

  // Initialize editor content
  useEffect(() => {
    if (editorRef.current && !initRef.current) {
      editorRef.current.innerHTML = value || '';
      initRef.current = true;
    }
  }, [value]);

  // Sync content on input
  const handleInput = useCallback(() => {
    if (editorRef.current && !showSource) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange, showSource]);

  // ── Toolbar Commands ───────────────────────────────────────
  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
    handleInput();
  };

  const toggleBold = () => exec('bold');
  const toggleItalic = () => exec('italic');
  const toggleUnderline = () => exec('underline');
  const toggleStrike = () => exec('strikeThrough');
  const toggleOL = () => exec('insertOrderedList');
  const toggleUL = () => exec('insertUnorderedList');

  // ── RTL Toggle ─────────────────────────────────────────────
  const toggleRTL = () => {
    setIsRTL(!isRTL);
    if (editorRef.current) {
      editorRef.current.dir = !isRTL ? 'rtl' : 'ltr';
      editorRef.current.style.textAlign = !isRTL ? 'right' : 'left';
    }
  };

  // ── Math Insert ────────────────────────────────────────────
  const openMath = () => { setShowMathInput(true); setMathExpr(''); setMathPreview(''); };

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
    // Wrap in span with data attribute for editing
    const mathSpan = `<span class="math-inline" data-latex="${encodeURIComponent(mathExpr)}" contenteditable="false" style="display:inline-block;padding:0 2px;cursor:default;">${html}</span>&nbsp;`;
    exec('insertHTML', mathSpan);
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
      exec('insertHTML', `<img src="${apiUrl}${r.data.url}" alt="gambar" style="max-width:100%;border-radius:8px;margin:8px 0;" />`);
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
      exec('insertHTML', `<audio controls controlsList="nodownload" preload="auto" style="width:100%;margin:8px 0;"><source src="${apiUrl}${r.data.url}" /></audio>`);
    } else {
      alert(r.error || 'Upload gagal');
    }
    e.target.value = '';
  };

  // ── Source Code Toggle ─────────────────────────────────────
  const toggleSource = () => {
    if (!showSource) {
      // Switch to source mode
      setSourceCode(editorRef.current?.innerHTML || '');
      setShowSource(true);
    } else {
      // Switch back to visual
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
  const TB = ({ onClick, active, children, title }: { onClick: () => void; active?: boolean; children: React.ReactNode; title: string }) => (
    <button type="button" onClick={onClick} title={title}
      className={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors
        ${active ? 'bg-brand-100 text-brand-700' : 'text-surface-500 hover:bg-surface-100 hover:text-surface-700'}`}>
      {children}
    </button>
  );

  return (
    <div className="border border-surface-200 rounded-xl overflow-hidden bg-white">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-surface-100 bg-surface-50/50 flex-wrap">
        <TB onClick={toggleBold} title="Tebal (Ctrl+B)"><b>B</b></TB>
        <TB onClick={toggleItalic} title="Miring (Ctrl+I)"><i>I</i></TB>
        <TB onClick={toggleUnderline} title="Garis Bawah (Ctrl+U)"><u>U</u></TB>
        <TB onClick={toggleStrike} title="Coret">
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </TB>

        <span className="w-px h-4 bg-surface-200 mx-1" />

        <TB onClick={toggleOL} title="Daftar Nomor">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6h11M10 12h11M10 18h11M3 6h1M3 12h1M3 18h1"/></svg>
        </TB>
        <TB onClick={toggleUL} title="Daftar Bullet">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
        </TB>

        <span className="w-px h-4 bg-surface-200 mx-1" />

        {/* RTL Toggle */}
        <TB onClick={toggleRTL} active={isRTL} title="Arah Teks (RTL/LTR)">
          <span className="text-[10px]">{isRTL ? 'RTL' : 'LTR'}</span>
        </TB>

        {/* Math */}
        <TB onClick={openMath} title="Sisipkan Rumus Matematika (KaTeX)">
          <span className="text-[11px] italic font-serif">∑</span>
        </TB>

        <span className="w-px h-4 bg-surface-200 mx-1" />

        {/* Image Upload */}
        <TB onClick={() => fileInputRef.current?.click()} title="Upload Gambar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </TB>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

        {/* Audio Upload */}
        <TB onClick={() => audioInputRef.current?.click()} title="Upload Audio">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        </TB>
        <input ref={audioInputRef} type="file" accept="audio/*" className="hidden" onChange={handleAudioUpload} />

        <span className="w-px h-4 bg-surface-200 mx-1" />

        {/* Source Toggle */}
        <TB onClick={toggleSource} active={showSource} title="Kode HTML">
          <span className="text-[10px] font-mono">&lt;/&gt;</span>
        </TB>

        {uploading && (
          <span className="text-[10px] text-surface-400 ml-2 animate-pulse">Mengupload...</span>
        )}
      </div>

      {/* Editor Area */}
      {showSource ? (
        <textarea
          value={sourceCode}
          onChange={(e) => handleSourceChange(e.target.value)}
          className="w-full px-3 py-2 text-sm font-mono text-surface-700 bg-surface-50 outline-none resize-none"
          style={{ minHeight }}
          spellCheck={false}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          onBlur={handleInput}
          className="px-3 py-2 text-sm text-surface-800 outline-none overflow-y-auto"
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
            <h3 className="font-bold text-surface-900 text-sm mb-3">Sisipkan Rumus Matematika</h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Ekspresi LaTeX</label>
                <input
                  value={mathExpr}
                  onChange={e => updateMathPreview(e.target.value)}
                  placeholder="contoh: \frac{a}{b}, x^2, \sqrt{n}"
                  className="w-full px-3 py-2 mt-1 text-sm font-mono bg-surface-50 border border-surface-200 rounded-lg outline-none focus:border-brand-500"
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
                    className="px-2 py-1 text-[10px] bg-surface-100 hover:bg-surface-200 rounded font-mono text-surface-600 transition-colors">
                    {q.label}
                  </button>
                ))}
              </div>

              {/* Preview */}
              {mathPreview && (
                <div className="p-3 bg-surface-50 rounded-lg border border-surface-100">
                  <p className="text-[10px] text-surface-400 mb-1 uppercase font-semibold">Preview</p>
                  <div className="text-lg" dangerouslySetInnerHTML={{ __html: mathPreview }} />
                </div>
              )}

              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setShowMathInput(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-surface-600 bg-surface-100 rounded-lg hover:bg-surface-200">
                  Batal
                </button>
                <button type="button" onClick={insertMath} disabled={!mathExpr.trim()}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50">
                  Sisipkan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Styles for empty placeholder */}
      <style jsx>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #94a3b8;
          pointer-events: none;
        }
        [contenteditable] img {
          max-width: 100%;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
