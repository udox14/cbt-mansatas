'use client';
import { forwardRef, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, useEffect, useState, createContext, useContext, useCallback } from 'react';

// ── BUTTON ───────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const btnBase = 'inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none';
const btnVariants: Record<BtnVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20',
  secondary: 'bg-surface-100 text-surface-700 hover:bg-surface-200 border border-surface-200',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-surface-600 hover:bg-surface-100',
};
const btnSizes = { sm: 'text-xs px-3 py-1.5 gap-1.5', md: 'text-sm px-4 py-2 gap-2', lg: 'text-base px-6 py-2.5 gap-2' };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(({ variant = 'primary', size = 'md', loading, children, className = '', ...p }, ref) => (
  <button ref={ref} className={`${btnBase} ${btnVariants[variant]} ${btnSizes[size]} ${className}`} disabled={loading || p.disabled} {...p}>
    {loading && <Spinner size={14} />}{children}
  </button>
));
Button.displayName = 'Button';

// ── INPUT ────────────────────────────────────────────────────
interface InputProps extends InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string }
export const Input = forwardRef<HTMLInputElement, InputProps>(({ label, error, className = '', ...p }, ref) => (
  <div className="space-y-1">
    {label && <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">{label}</label>}
    <input ref={ref} className={`w-full px-3 py-2 text-sm bg-surface-50 border rounded-lg outline-none transition-colors
      ${error ? 'border-red-400 focus:border-red-500' : 'border-surface-200 focus:border-brand-500'} ${className}`} {...p} />
    {error && <p className="text-xs text-red-500">{error}</p>}
  </div>
));
Input.displayName = 'Input';

// ── TEXTAREA ─────────────────────────────────────────────────
export function Textarea({ label, className = '', ...p }: { label?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="space-y-1">
      {label && <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">{label}</label>}
      <textarea className={`w-full px-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-lg outline-none
        focus:border-brand-500 transition-colors resize-none ${className}`} {...p} />
    </div>
  );
}

// ── SELECT ───────────────────────────────────────────────────
export function Select({ label, options, className = '', ...p }: {
  label?: string; options: { value: string | number; label: string }[];
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="space-y-1">
      {label && <label className="text-xs font-semibold text-surface-500 uppercase tracking-wide">{label}</label>}
      <select className={`w-full px-3 py-2 text-sm bg-surface-50 border border-surface-200 rounded-lg outline-none
        focus:border-brand-500 transition-colors ${className}`} {...p}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── MODAL ────────────────────────────────────────────────────
interface ModalProps { open: boolean; onClose: () => void; title?: string; children: ReactNode; size?: 'sm' | 'md' | 'lg' }
export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  if (!open) return null;
  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div className={`relative bg-white rounded-t-2xl sm:rounded-2xl w-full ${w} max-h-[90vh] overflow-y-auto shadow-2xl drawer-enter sm:animate-none`}
        onClick={e => e.stopPropagation()}>
        {title && (
          <div className="sticky top-0 bg-white/90 backdrop-blur-sm px-5 py-3 border-b border-surface-100 flex items-center justify-between z-10">
            <h3 className="font-bold text-surface-900">{title}</h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-100 text-surface-400">
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l8 8M14 6l-8 8"/></svg>
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── TOAST ────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'warning' | 'info';
interface Toast { id: number; type: ToastType; message: string }
const ToastCtx = createContext<{ toast: (type: ToastType, message: string) => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((type: ToastType, message: string) => {
    const id = Date.now();
    setToasts(p => [...p, { id, type, message }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3500);
  }, []);
  const colors: Record<ToastType, string> = {
    success: 'bg-brand-600 text-white', error: 'bg-red-600 text-white',
    warning: 'bg-amber-500 text-white', info: 'bg-surface-800 text-white',
  };
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] space-y-2 max-w-xs">
        {toasts.map(t => (
          <div key={t.id} className={`${colors[t.type]} px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg toast-enter`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── BADGE ────────────────────────────────────────────────────
const badgeColors: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700', red: 'bg-red-50 text-red-700',
  yellow: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700',
  gray: 'bg-surface-100 text-surface-600', purple: 'bg-purple-50 text-purple-700',
};
export function Badge({ children, color = 'gray' }: { children: ReactNode; color?: string }) {
  return <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-md ${badgeColors[color] || badgeColors.gray}`}>{children}</span>;
}

// ── SPINNER ──────────────────────────────────────────────────
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M12 2a10 10 0 019.8 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ── LOADING SCREEN ───────────────────────────────────────────
export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="text-center space-y-3">
        <Spinner size={32} />
        <p className="text-sm text-surface-500">Memuat...</p>
      </div>
    </div>
  );
}

// ── EMPTY STATE ──────────────────────────────────────────────
export function EmptyState({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="text-center py-12 px-4">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-100 flex items-center justify-center">
        <svg width="24" height="24" fill="none" stroke="#94a3b8" strokeWidth="1.5"><path d="M3 7h18M3 12h18M3 17h12"/></svg>
      </div>
      <p className="font-semibold text-surface-700">{title}</p>
      {desc && <p className="text-sm text-surface-400 mt-1">{desc}</p>}
    </div>
  );
}

// ── CONFIRM DIALOG ───────────────────────────────────────────
export function Confirm({ open, onClose, onConfirm, title, message, confirmText = 'Hapus', danger = true }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; confirmText?: string; danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-surface-600 mb-4">{message}</p>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" size="sm" onClick={onClose}>Batal</Button>
        <Button variant={danger ? 'danger' : 'primary'} size="sm" onClick={onConfirm}>{confirmText}</Button>
      </div>
    </Modal>
  );
}
