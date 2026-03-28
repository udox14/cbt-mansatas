'use client';
import { ReactNode, useState, createContext, useContext, useCallback } from 'react';

// ── MODAL ────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, size = 'md' }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode; size?: 'sm' | 'md' | 'lg'
}) {
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-2xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-gray-900/50" />
      <div className={`relative bg-white rounded-t-xl sm:rounded-xl w-full ${w} max-h-[90vh] overflow-y-auto shadow-xl fade-in`}
        onClick={e => e.stopPropagation()}>
        {title && (
          <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3.5 flex items-center justify-between z-10">
            <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-0.5"><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l8 8M13 5l-8 8"/></svg></button>
          </div>
        )}
        <div className="p-5">{children}</div>
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
    const id = Date.now(); setToasts(p => [...p, { id, type, msg }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  const bg: Record<ToastType, string> = { success: 'bg-primary-600', error: 'bg-red-600', warning: 'bg-amber-500', info: 'bg-gray-800' };
  return (<ToastCtx.Provider value={{ toast }}>{children}
    <div className="fixed top-4 right-4 z-[100] space-y-2 max-w-xs">
      {toasts.map(t => <div key={t.id} className={`${bg[t.type]} text-white px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg fade-in`}>{t.msg}</div>)}
    </div>
  </ToastCtx.Provider>);
}

// ── SIMPLE COMPONENTS ─────────────────────────────────────────
export function Spinner({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" /><path d="M12 2a10 10 0 019.8 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}
export function LoadingScreen() {
  return <div className="min-h-screen flex items-center justify-center"><div className="text-center"><Spinner size={28} /><p className="text-sm text-gray-400 mt-3">Memuat...</p></div></div>;
}
export function EmptyState({ title, desc }: { title: string; desc?: string }) {
  return <div className="text-center py-16 px-4"><div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center"><svg width="20" height="20" fill="none" stroke="#9ca3af" strokeWidth="1.5"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 7h6M7 10h4"/></svg></div><p className="font-medium text-gray-600">{title}</p>{desc && <p className="text-sm text-gray-400 mt-1">{desc}</p>}</div>;
}
export function Badge({ children, color = 'gray' }: { children: ReactNode; color?: string }) {
  const c: Record<string, string> = { green: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-700', yellow: 'bg-amber-50 text-amber-700', blue: 'bg-sky-50 text-sky-700', gray: 'bg-gray-100 text-gray-600', purple: 'bg-violet-50 text-violet-700' };
  return <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-full ${c[color] || c.gray}`}>{children}</span>;
}
export function Confirm({ open, onClose, onConfirm, title, message, confirmText = 'Hapus', danger = true }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; confirmText?: string; danger?: boolean;
}) {
  return <Modal open={open} onClose={onClose} title={title} size="sm">
    <p className="text-sm text-gray-500 mb-4">{message}</p>
    <div className="flex gap-2 justify-end">
      <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">Batal</button>
      <button onClick={onConfirm} className={`px-3 py-1.5 text-sm font-medium text-white rounded-lg ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'}`}>{confirmText}</button>
    </div>
  </Modal>;
}

// ── FORM ELEMENTS ─────────────────────────────────────────────
export function Input({ label, error, className = '', ...p }: { label?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <div><label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
    <input className={`w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition ${error ? 'border-red-400' : ''} ${className}`} {...p} />
    {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}</div>;
}
export function Textarea({ label, className = '', ...p }: { label?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <div><label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
    <textarea className={`w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none transition ${className}`} {...p} /></div>;
}
export function Select({ label, options, className = '', ...p }: { label?: string; options: { value: string | number; label: string }[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <div><label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
    <select className={`w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition ${className}`} {...p}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>;
}
export function Button({ variant = 'primary', size = 'md', loading, children, className = '', ...p }: {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md'; loading?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const v: Record<string, string> = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm',
    secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-gray-600 hover:bg-gray-100',
  };
  const s = size === 'sm' ? 'text-xs px-3 py-1.5' : 'text-sm px-4 py-2';
  return <button className={`inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all disabled:opacity-50 ${v[variant]} ${s} ${className}`} disabled={loading || p.disabled} {...p}>
    {loading && <Spinner size={14} />}{children}
  </button>;
}
