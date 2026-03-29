export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const ok  = (data?: any, message?: string) => ({ success: true, data, message });
export const err = (error: string) => ({ success: false, error });

// ── PASSWORD HASHING (PBKDF2 via Web Crypto) ──────────────────
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashArr = Array.from(new Uint8Array(bits));
  const saltArr = Array.from(salt);
  const toHex = (arr: number[]) => arr.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${toHex(saltArr)}:${toHex(hashArr)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) return false;
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
    const keyMaterial = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    const computed = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    return computed === hashHex;
  } catch { return false; }
}

// ── TOKEN GENERATOR (6-digit numeric) ────────────────────────
export function generateToken(): string {
  const arr = crypto.getRandomValues(new Uint32Array(1));
  return String(arr[0] % 1000000).padStart(6, '0');
}


// ── PARSE SESI STRING ─────────────────────────────────────────
// Input: "Sesi 1 (07.30 - 09.30 WIB)" atau "Sesi 2 (10.00 - 12.00 WIB)"
// Output: { jamMulai: "07:30", jamSelesai: "09:30" } atau null jika gagal parse
export function parseSesiJam(sesiTes: string): { jamMulai: string; jamSelesai: string } | null {
  if (!sesiTes) return null;
  // Match pola (HH.MM - HH.MM ...) dengan berbagai variasi spasi
  const match = sesiTes.match(/\((\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/);
  if (!match) return null;
  const pad = (n: string) => n.padStart(2, '0');
  return {
    jamMulai:   `${pad(match[1])}:${match[2]}`,
    jamSelesai: `${pad(match[3])}:${match[4]}`,
  };
}

// ── CEK APAKAH SEKARANG DALAM JADWAL UJIAN ────────────────────
// tanggalTes: "2025-05-21" (YYYY-MM-DD)
// jamMulai/Selesai: "07:30"
// Timezone: Asia/Jakarta (WIB = UTC+7)
export type JadwalStatus = 'belum' | 'aktif' | 'selesai';

export function cekJadwal(
  tanggalTes: string,
  jamMulai: string,
  jamSelesai: string,
  nowIso?: string // opsional, default = now
): JadwalStatus {
  if (!tanggalTes || !jamMulai || !jamSelesai) return 'aktif'; // kalau data tidak lengkap, biarkan masuk

  const nowDate = nowIso ? new Date(nowIso) : new Date();
  // Buat timestamp mulai dan selesai dalam WIB (UTC+7)
  const toWIBTimestamp = (date: string, time: string) => {
    const [h, m] = time.split(':').map(Number);
    const [y, mo, d] = date.split('-').map(Number);
    // WIB = UTC+7, jadi kita buat UTC dengan kurangi 7 jam
    return new Date(Date.UTC(y, mo - 1, d, h - 7, m, 0)).getTime();
  };

  const mulai   = toWIBTimestamp(tanggalTes, jamMulai);
  const selesai = toWIBTimestamp(tanggalTes, jamSelesai);
  const now     = nowDate.getTime();

  if (now < mulai)   return 'belum';
  if (now > selesai) return 'selesai';
  return 'aktif';
}

// ── RANDOMIZE ─────────────────────────────────────────────────
export function buildRandomMaps(
  questions: { id: string; options: { id: string }[] }[],
  randomizeQuestions: boolean,
  randomizeOptions: boolean
) {
  const qList = randomizeQuestions ? shuffle([...questions]) : questions;
  const questionMap = qList.map(q => q.id);
  const optionMap: Record<string, string[]> = {};
  for (const q of qList) {
    optionMap[q.id] = randomizeOptions ? shuffle(q.options.map(o => o.id)) : q.options.map(o => o.id);
  }
  return { questionMap, optionMap };
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
