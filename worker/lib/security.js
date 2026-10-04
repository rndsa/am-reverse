// worker/lib/security.js — CORS whitelist + header keamanan

const ALLOWED_ORIGINS = (globalThis.__ALLOWED_ORIGINS__ || 'https://v.axjet.xyz,https://www.v.axjet.xyz,https://am-reverse.ren73265.workers.dev')
  .split(',').map(s => s.trim()).filter(Boolean);

function isDevOrigin(origin) {
  if (!origin) return false;
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local');
  } catch { return false; }
}

export function corsHeaders(origin) {
  const h = {};
  if (origin && (ALLOWED_ORIGINS.includes(origin) || isDevOrigin(origin))) {
    h['access-control-allow-origin'] = origin;
    h['vary'] = 'Origin';
  }
  h['access-control-allow-headers'] = 'content-type, x-api-key, authorization, x-master-key, x-admin-password, x-internal';
  h['access-control-allow-methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
  return h;
}

export function securityHeaders(origin) {
  return Object.assign({
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'"
    ].join('; ')
  }, corsHeaders(origin));
}

// Rate limiter per-isolate (best-effort). Ceiling keras anti memory-leak.
const MAX_KEYS = 10000;
const buckets = new Map();

// [FIX R3] batas GLOBAL lintas-IP (circuit breaker). Menahan lonjakan walau IP dirotasi.
const globalWindows = new Map();
export function rateLimitGlobal(name, limit, windowMs = 60000) {
  const t = Date.now();
  const w = globalWindows.get(name);
  if (!w || (t - w.ts) >= windowMs) { globalWindows.set(name, { count: 1, ts: t }); return { ok: true, remaining: limit - 1, retryAfterSec: 0 }; }
  if (w.count >= limit) return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((windowMs - (t - w.ts)) / 1000)) };
  w.count += 1;
  return { ok: true, remaining: limit - w.count, retryAfterSec: 0 };
}

export function rateLimit(key, limit, windowMs) {
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || (t - b.ts) >= windowMs) {
    buckets.set(key, { tokens: limit - 1, ts: t });
    prune(windowMs * 2);
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  if (b.tokens <= 0) {
    return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((windowMs - (t - b.ts)) / 1000)) };
  }
  b.tokens -= 1;
  return { ok: true, remaining: b.tokens, retryAfterSec: 0 };
}

function prune(ttlMs) {
  const cutoff = Date.now() - ttlMs;
  for (const [k, b] of buckets) if (b.ts < cutoff) buckets.delete(k);
  if (buckets.size > MAX_KEYS) {
    const overflow = buckets.size - MAX_KEYS;
    let i = 0;
    for (const k of buckets.keys()) { if (i++ >= overflow) break; buckets.delete(k); }
  }
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip')
      || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
      || 'unknown';
}
