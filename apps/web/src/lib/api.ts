const API = process.env.NEXT_PUBLIC_API_URL || 'https://cbtmansatas.drudox.workers.dev';

interface ApiRes<T = any> { success: boolean; data?: T; message?: string; error?: string }

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('cbt_token');
}
export function setToken(t: string) { localStorage.setItem('cbt_token', t); }
export function clearToken() { localStorage.removeItem('cbt_token'); localStorage.removeItem('cbt_user'); }

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<ApiRes<T>> {
  const token = getToken();
  const h: Record<string, string> = { ...(opts.headers as Record<string, string> || {}) };
  if (token) h['Authorization'] = `Bearer ${token}`;
  if (!(opts.body instanceof FormData)) h['Content-Type'] = 'application/json';
  try {
    const r = await fetch(`${API}${path}`, { ...opts, headers: h });
    const d = await r.json() as ApiRes<T>;
    if (!r.ok && !d.error) { d.error = `HTTP ${r.status}`; d.success = false; }
    return d;
  } catch (e: any) {
    return { success: false, error: e.message || 'Koneksi gagal' };
  }
}

export const GET = <T = any>(p: string) => api<T>(p);
export const POST = <T = any>(p: string, b?: any) =>
  api<T>(p, { method: 'POST', body: b instanceof FormData ? b : JSON.stringify(b) });
export const PUT = <T = any>(p: string, b?: any) =>
  api<T>(p, { method: 'PUT', body: JSON.stringify(b) });
export const DEL = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
