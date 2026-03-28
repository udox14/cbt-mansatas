// ============================================================
// Helpers: Hash, Shuffle, Token, ID Generation
// ============================================================

const encoder = new TextEncoder();

// Generate TEXT ID (sama format dengan PMB: lower hex random)
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Password hashing (PBKDF2, Workers-native)
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...new Uint8Array(derived)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256
  );
  return [...new Uint8Array(derived)].map(b => b.toString(16).padStart(2, '0')).join('') === hashHex;
}

// Fisher-Yates shuffle
export function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Generate token PIN 6 digit
export function generateToken(): string {
  const arr = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(arr, b => (b % 10).toString()).join('');
}

// Randomize maps
export function buildRandomMaps(
  questions: { id: string; options: { id: string }[] }[],
  randomizeQuestions: boolean,
  randomizeOptions: boolean
): { questionMap: string[]; optionMap: Record<string, string[]> } {
  let qIds = questions.map(q => q.id);
  if (randomizeQuestions) qIds = shuffle(qIds);
  const optionMap: Record<string, string[]> = {};
  for (const q of questions) {
    let oIds = q.options.map(o => o.id);
    if (randomizeOptions) oIds = shuffle(oIds);
    optionMap[q.id] = oIds;
  }
  return { questionMap: qIds, optionMap };
}

export function now(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export function ok<T>(data: T, message?: string) {
  return { success: true as const, data, message };
}

export function err(message: string, status = 400) {
  return { success: false as const, error: message, _status: status };
}
