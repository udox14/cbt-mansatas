// ============================================================
// Rate Limiter — Cloudflare KV based
// Strategy: sliding window counter per key
// ============================================================

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // seconds
}

/**
 * Check & increment rate limit counter.
 * @param kv        - KVNamespace binding (RATE_LIMIT)
 * @param key       - Unique key, e.g. "login:ip:1.2.3.4" or "login:user:nisn123"
 * @param limit     - Max requests allowed in the window
 * @param windowSec - Window size in seconds
 */
export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  const kvKey = `rl:${key}`;
  const raw = await kv.get(kvKey);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= limit) {
    // Get remaining TTL for retryAfter
    const meta = await kv.getWithMetadata<{ count: number }>(kvKey);
    return { allowed: false, remaining: 0, retryAfter: windowSec };
  }

  const newCount = count + 1;
  // Only set TTL on first write (sliding window approximation)
  await kv.put(kvKey, String(newCount), { expirationTtl: windowSec });

  return { allowed: true, remaining: limit - newCount, retryAfter: 0 };
}

/**
 * Reset counter for a key (e.g. on successful login, clear failed attempts)
 */
export async function resetRateLimit(kv: KVNamespace, key: string): Promise<void> {
  await kv.delete(`rl:${key}`);
}
