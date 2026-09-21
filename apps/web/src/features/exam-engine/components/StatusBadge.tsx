import React from 'react';
import { C } from './theme';

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: '#e0f0ff', color: '#1a5fa8', label: 'Aktif' },
    draft: { bg: '#f1f1f0', color: '#6b7c6e', label: 'Draft' },
    finished: { bg: C.greenLight, color: '#2d6644', label: 'Selesai' },
  };
  const s = map[status] || map.draft;
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: '10px',
        fontWeight: 700,
        padding: '3px 9px',
        borderRadius: '999px',
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  );
}

export default StatusBadge;
