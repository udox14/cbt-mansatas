'use client';
import { ReactNode, useState, createContext, useContext, useCallback } from 'react';

const C = {
  white: '#fff', bg: '#f4f6f4', border: '#e0e5e0', borderMid: '#d4dbd4',
  text: '#1e2e22', textMid: '#4a6655', textMuted: '#8a9e8d', textFaint: '#a8b9aa',
  green: '#2d7a4f', greenLight: '#e2ebe3', greenBorder: '#b5d9c4',
};

// ── MODAL ────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md' }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; size?: 'sm' | 'md' | 'lg';
}) {
  if (!open) return null;
  const maxW = { sm: '420px', md: '560px', lg: '680px' }[size];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      className="sm:items-center" onClick={onClose}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(30,46,34,0.4)' }} />
      <div style={{
        position: 'relative', background: C.white, width: '100%', maxWidth: maxW,
        maxHeight: '90vh', overflowY: 'auto',
        borderRadius: '20px 20px 0 0', boxShadow: '0 -4px 32px rgba(0,0,0,0.08)',
      }} className="sm:rounded-xl fade-in" onClick={e => e.stopPropagation()}>
        {title && (
          <div style={{ position: 'sticky', top: 0, background: C.white, borderBottom: `1.5px solid ${C.border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, borderRadius: '20px 20px 0 0' }}>
            <p style={{ fontWeight: 800, color: C.text, fontSize: '14px' }}>{title}</p>
            <button onClick={onClose} style={{ background: C.bg, border: `1.5px solid ${C.borderMid}`, borderRadius: '8px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <svg width="14" height="14" fill="none" stroke={C.textMuted} strokeWidth="2.5"><path d="M3 3l8 8M11 3l-8 8"/></svg>
            </button>
          </div>
        )}
        <div style={{ padding: '20px' }}>{children}</div>
      </div>
    </div>
  );
}

// ── TOAST ─────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'warning' | 'info';
const ToastCtx = createContext<{ toast: (type: ToastType, msg: string) => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; type: ToastType; msg: string }[]>([]);
  const toast = useCallback((type: ToastType, msg: string) => {
    const id = Date.now();
    setToasts(p => [...p, { id, type, msg }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  const styles: Record<ToastType, { bg: string; color: string }> = {
    success: { bg: C.greenLight,  color: '#2d6644'  },
    error:   { bg: '#fef2f2',     color: '#dc2626'  },
    warning: { bg: '#fffbeb',     color: '#b45309'  },
    info:    { bg: '#f1f1f0',     color: '#4a6655'  },
  };
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div style={{ position: 'fixed', top: '16px', right: '16px', zIndex: 100, display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '300px' }}>
        {toasts.map(t => (
          <div key={t.id} className="fade-in" style={{
            background: styles[t.type].bg, color: styles[t.type].color,
            border: `1.5px solid ${C.borderMid}`,
            padding: '10px 14px', borderRadius: '12px', fontSize: '12.5px', fontWeight: 700,
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          }}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── SPINNER ───────────────────────────────────────────────────
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.15" />
      <path d="M12 2a10 10 0 019.8 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ── LOADING SCREEN ────────────────────────────────────────────
export function LoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
      <div style={{ textAlign: 'center', color: C.textMuted }}>
        <Spinner size={28} />
        <p style={{ fontSize: '12px', marginTop: '10px', fontWeight: 500 }}>Memuat...</p>
      </div>
    </div>
  );
}

// ── EMPTY STATE ───────────────────────────────────────────────
export function EmptyState({ title, desc }: { title: string; desc?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 16px' }}>
      <div style={{ width: '44px', height: '44px', margin: '0 auto 12px', borderRadius: '14px', background: C.bg, border: `1.5px solid ${C.borderMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="18" height="18" fill="none" stroke={C.textFaint as string} strokeWidth="1.5"><rect x="2" y="2" width="14" height="14" rx="2"/><path d="M6 6h6M6 9h4"/></svg>
      </div>
      <p style={{ fontWeight: 700, color: C.textMuted, fontSize: '13px' }}>{title}</p>
      {desc && <p style={{ color: '#a8b9aa', fontSize: '12px', marginTop: '3px' }}>{desc}</p>}
    </div>
  );
}

// ── BADGE ─────────────────────────────────────────────────────
export function Badge({ children, color = 'gray' }: { children: ReactNode; color?: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    green:  { bg: C.greenLight,  color: '#2d6644'  },
    blue:   { bg: '#e0f0ff',     color: '#1a5fa8'  },
    red:    { bg: '#fef2f2',     color: '#dc2626'  },
    yellow: { bg: '#fffbeb',     color: '#b45309'  },
    gray:   { bg: '#f1f1f0',     color: '#6b7c6e'  },
    purple: { bg: '#f3f0ff',     color: '#5b3fd4'  },
  };
  const s = map[color] || map.gray;
  return <span style={{ display: 'inline-block', background: s.bg, color: s.color, fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '999px' }}>{children}</span>;
}

// ── CONFIRM ───────────────────────────────────────────────────
export function Confirm({ open, onClose, onConfirm, title, message, confirmText = 'Hapus', danger = true }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: string; confirmText?: string; danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p style={{ color: C.textMuted, fontSize: '13px', marginBottom: '20px', lineHeight: 1.5 }}>{message}</p>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 700, color: C.textMid, background: C.bg, border: `1.5px solid ${C.borderMid}`, borderRadius: '10px', cursor: 'pointer' }}>Batal</button>
        <button onClick={onConfirm} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 700, color: '#fff', background: danger ? '#dc2626' : C.green, border: 'none', borderRadius: '10px', cursor: 'pointer' }}>{confirmText}</button>
      </div>
    </Modal>
  );
}

// ── FORM ELEMENTS ─────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '10px 12px', fontSize: '13px', fontWeight: 500,
  background: C.bg, border: `1.5px solid ${C.borderMid}`, borderRadius: '10px',
  outline: 'none', color: C.text, fontFamily: 'inherit',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};

export function Input({ label, error, className = '', ...p }: { label?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      {label && <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: C.textMid, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px' }}>{label}</label>}
      <input style={{ ...inputStyle, borderColor: error ? '#fca5a5' : C.borderMid } as any} className={className}
        onFocus={e => { e.target.style.borderColor = C.green; e.target.style.boxShadow = '0 0 0 3px rgba(45,122,79,0.1)'; }}
        onBlur={e => { e.target.style.borderColor = error ? '#fca5a5' : C.borderMid; e.target.style.boxShadow = 'none'; }}
        {...p} />
      {error && <p style={{ color: '#dc2626', fontSize: '11px', marginTop: '3px' }}>{error}</p>}
    </div>
  );
}

export function Textarea({ label, className = '', ...p }: { label?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div>
      {label && <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: C.textMid, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px' }}>{label}</label>}
      <textarea style={{ ...inputStyle, resize: 'none' } as any}
        onFocus={e => { e.target.style.borderColor = C.green; e.target.style.boxShadow = '0 0 0 3px rgba(45,122,79,0.1)'; }}
        onBlur={e => { e.target.style.borderColor = C.borderMid; e.target.style.boxShadow = 'none'; }}
        className={className} {...p} />
    </div>
  );
}

export function Select({ label, options, className = '', ...p }: { label?: string; options: { value: string | number; label: string }[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div>
      {label && <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: C.textMid, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: '6px' }}>{label}</label>}
      <select style={inputStyle as any} className={className}
        onFocus={e => { e.target.style.borderColor = C.green; e.target.style.boxShadow = '0 0 0 3px rgba(45,122,79,0.1)'; }}
        onBlur={e => { e.target.style.borderColor = C.borderMid; e.target.style.boxShadow = 'none'; }}
        {...p}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Button({ variant = 'primary', size = 'md', loading, children, className = '', ...p }: {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md'; loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants: Record<string, React.CSSProperties> = {
    primary:   { background: C.green,    color: '#fff',       border: 'none'                                          },
    secondary: { background: C.bg,       color: C.textMid,    border: `1.5px solid ${C.borderMid}`                    },
    danger:    { background: '#fef2f2',  color: '#dc2626',    border: '1.5px solid #fecaca'                           },
    ghost:     { background: 'none',     color: C.textMuted,  border: 'none'                                          },
  };
  const sizes: Record<string, React.CSSProperties> = {
    sm: { fontSize: '12px', padding: '7px 13px' },
    md: { fontSize: '13px', padding: '9px 16px' },
  };
  return (
    <button style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px', fontWeight: 700, borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit', transition: 'opacity 0.15s', ...variants[variant], ...sizes[size] } as any}
      disabled={loading || p.disabled} className={className} {...p}>
      {loading && <Spinner size={13} />}{children}
    </button>
  );
}

