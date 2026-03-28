// ============================================================
// JWT - Web Crypto API (zero dependencies, Workers-native)
// ============================================================

import type { JWTPayload } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInHours = 12
): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInHours * 3600,
  };

  const h = base64url(encoder.encode(JSON.stringify(header)));
  const p = base64url(encoder.encode(JSON.stringify(fullPayload)));
  const data = encoder.encode(`${h}.${p}`);

  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, data);

  return `${h}.${p}.${base64url(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;

    const key = await getKey(secret);
    const data = encoder.encode(`${h}.${p}`);
    const sig = base64urlDecode(s);

    const valid = await crypto.subtle.verify('HMAC', key, sig, data);
    if (!valid) return null;

    const payload: JWTPayload = JSON.parse(decoder.decode(base64urlDecode(p)));

    // Cek expired
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}
