import React from 'react';
import { C } from './theme';

export function TanggalHari() {
  const now = new Date();
  const hari = now.toLocaleDateString('id-ID', { weekday: 'long' });
  const tanggal = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div>
      <p style={{ color: C.text, fontSize: '13px', fontWeight: 800, lineHeight: 1.2 }}>{hari}</p>
      <p style={{ color: C.textMuted, fontSize: '11px', fontWeight: 500, marginTop: '1px' }}>{tanggal}</p>
    </div>
  );
}

export default TanggalHari;
