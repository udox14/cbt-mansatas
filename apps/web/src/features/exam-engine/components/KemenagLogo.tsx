import React from 'react';

export function KemenagLogo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/kemenag.png"
      alt="Kemenag"
      width={size}
      height={size}
      style={{ objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

export default KemenagLogo;
