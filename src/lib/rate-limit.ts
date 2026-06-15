/**
 * Lightweight in-memory rate limiter (per-process, fixed window).
 * Adequate for login/invite-accept protection on a single Vercel function.
 *
 * Phase 2 upgrade: swap implementation for Upstash Ratelimit / Redis
 * when the app scales beyond one serverless container.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
const SWEEP_PROBABILITY = 0.01;

function sweep(now: number) {
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
  if (buckets.size > MAX_BUCKETS) {
    // Last resort: nuke everything. Better to forget rate-limits than OOM.
    buckets.clear();
  }
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetMs: number;
};

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  // Probabilistic GC — amortizes cost across calls.
  if (Math.random() < SWEEP_PROBABILITY || buckets.size > MAX_BUCKETS) {
    sweep(now);
  }

  const b = buckets.get(key);

  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, resetMs: windowMs };
  }

  if (b.count >= max) {
    return { ok: false, remaining: 0, resetMs: b.resetAt - now };
  }

  b.count += 1;
  return { ok: true, remaining: max - b.count, resetMs: b.resetAt - now };
}

/** Best-effort IP extraction from common Vercel/edge headers. */
export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
