// lib/ratelimit.js — in-memory token-bucket rate limiter dengan hard ceiling.
// Vercel serverless: state per-instance (best-effort; lapisan kedua di Edge/WAF).
// Batas memori WAJIB — cegah DoS memory leak dari map yang tumbuh tanpa batas.

const MAX_KEYS = 10000 // ceiling keras
const buckets = new Map() // key -> { tokens, ts }

function now() { return Date.now() }

function prune(ttlMs) {
  // Fase 1: buang entry yang udah expired
  const cutoff = now() - ttlMs
  for (const [k, b] of buckets) {
    if (b.ts < cutoff) buckets.delete(k)
  }
  // Fase 2: kalau masih di atas ceiling, evict yang paling tua (FIFO)
  if (buckets.size > MAX_KEYS) {
    const overflow = buckets.size - MAX_KEYS
    let i = 0
    for (const k of buckets.keys()) {
      if (i++ >= overflow) break
      buckets.delete(k)
    }
  }
}

/**
 * Cek + konsumsi 1 token.
 * @param {string} key      identifier (mis. `ip:1.2.3.4:send-link`)
 * @param {number} limit    jumlah request maksimum per window
 * @param {number} windowMs panjang window (ms)
 * @returns {{ok:boolean, remaining:number, retryAfterSec:number}}
 */
function hit(key, limit = 10, windowMs = 60000) {
  const t = now()
  const b = buckets.get(key)

  if (!b || (t - b.ts) >= windowMs) {
    buckets.set(key, { tokens: limit - 1, ts: t })
    prune(windowMs * 2)
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 }
  }

  if (b.tokens <= 0) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (t - b.ts)) / 1000))
    return { ok: false, remaining: 0, retryAfterSec }
  }

  b.tokens -= 1
  return { ok: true, remaining: b.tokens, retryAfterSec: 0 }
}

function reset(key) { buckets.delete(key) }
function size() { return buckets.size }


// ================= [FIX R3] GLOBAL CIRCUIT BREAKER =================
// Masalah: limiter per-IP in-memory tidak efektif di serverless —
// (1) tiap instance punya Map sendiri -> limit efektif = limit x jumlah instance,
// (2) attacker yang punya banyak IP tidak terpengaruh sama sekali,
// (3) saat Map penuh, eviction FIFO bisa mereset bucket attacker.
// Solusi yang tidak butuh infra tambahan: batas GLOBAL per-endpoint lintas IP.
// Walau attacker rotate IP, total request tetap dibatasi -> kuota Firebase aman.
const globalWindows = new Map() // name -> {count, ts}

function hitGlobal(name, limit, windowMs = 60000) {
  const t = now()
  const w = globalWindows.get(name)
  if (!w || (t - w.ts) >= windowMs) {
    globalWindows.set(name, { count: 1, ts: t })
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 }
  }
  if (w.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (t - w.ts)) / 1000))
    return { ok: false, remaining: 0, retryAfterSec }
  }
  w.count += 1
  return { ok: true, remaining: limit - w.count, retryAfterSec: 0 }
}

function globalSize() { return globalWindows.size }

module.exports = { hit, hitGlobal, reset, size, globalSize, MAX_KEYS }
