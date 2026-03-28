'use client';
import { useState, useEffect, useCallback } from 'react';
import { GET, clearToken } from '@/lib/api';

export interface AuthUser {
  sub: string;
  username: string;
  role: 'admin' | 'proctor' | 'student';
  room_id: string | null;
  full_name: string;
  source: 'admins' | 'pendaftar' | 'cbt_user';
}

export function useAuth(requiredRole?: string) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = localStorage.getItem('cbt_user');
    if (cached) {
      try {
        const u = JSON.parse(cached) as AuthUser;
        if (!requiredRole || u.role === requiredRole) { setUser(u); setLoading(false); return; }
      } catch {}
    }
    GET<AuthUser>('/api/auth/me').then(r => {
      if (r.success && r.data) {
        localStorage.setItem('cbt_user', JSON.stringify(r.data));
        if (!requiredRole || r.data.role === requiredRole) setUser(r.data);
        else { clearToken(); window.location.href = '/login/'; }
      } else {
        clearToken(); window.location.href = '/login/';
      }
    }).finally(() => setLoading(false));
  }, [requiredRole]);

  const logout = useCallback(() => { clearToken(); window.location.href = '/login/'; }, []);
  return { user, loading, logout };
}
