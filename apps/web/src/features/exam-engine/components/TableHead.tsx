import React from 'react';
import { C } from './theme';

export function TableHead({ cols }: { cols: { label: string; center?: boolean }[] }) {
  return (
    <thead>
      <tr style={{ background: C.bg, borderBottom: `1.5px solid ${C.borderMid}` }}>
        {cols.map(c => (
          <th
            key={c.label}
            style={{
              padding: '9px 14px',
              textAlign: c.center ? 'center' : 'left',
              color: C.textMid,
              fontSize: '10.5px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              whiteSpace: 'nowrap',
            }}
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export default TableHead;
