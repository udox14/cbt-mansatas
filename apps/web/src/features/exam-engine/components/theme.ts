export const C = {
  bg: '#f4f6f4',
  white: '#fff',
  border: '#e0e5e0',
  borderLight: '#edf0ed',
  borderMid: '#d4dbd4',
  text: '#1e2e22',
  textMid: '#4a6655',
  textMuted: '#8a9e8d',
  textFaint: '#a8b9aa',
  green: '#2d7a4f',
  greenLight: '#e2ebe3',
  greenBorder: '#b5d9c4',
};

export const normalizeJenisKelamin = (value?: string | null) => {
  const normalized = (value || '').trim().toUpperCase().replace(/[\s_-]+/g, ' ');
  if (!normalized) return '';
  if (normalized === 'L' || normalized.startsWith('LAKI') || normalized === 'PRIA') return 'L';
  if (normalized === 'P' || normalized.startsWith('PEREMPUAN') || normalized === 'WANITA') return 'P';
  return normalized;
};

export const parseServerTime = (value: string) => {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : Date.now();
};

export const sessionFilterKey = (row: any) => `${row?.tanggal_tes || ''}|${row?.sesi_tes || ''}`;

export const sessionFilterLabel = (row: any) => {
  const tanggal = row?.tanggal_tes || '';
  const sesi = row?.sesi_tes || '';
  if (!tanggal && !sesi) return 'Tanpa Sesi / Simulasi';
  return [tanggal || 'Tanpa tanggal', sesi || 'Tanpa sesi'].join(' - ');
};

export const buildSessionFilters = (rows: any[]) =>
  Array.from(
    new Map(
      rows.map((row: any) => {
        const key = sessionFilterKey(row);
        return [key, { key, label: sessionFilterLabel(row) }];
      })
    ).values()
  ).sort((a: any, b: any) => {
    if (a.key === '|') return 1;
    if (b.key === '|') return -1;
    return a.label.localeCompare(b.label);
  });
