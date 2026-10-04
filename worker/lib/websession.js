// worker/lib/websession.js — versi ESM untuk Cloudflare Worker.
// Token sesi web bertanda tangan (HMAC-SHA256 via WebCrypto), TTL 15 menit, diikat IP.

const TTL_MS = 15 * 60 * 1000

let cachedKey = null
let cachedSecret = ''

async function hmacKey(env) {
  const secret = (env && (env.WEB_SESSION_SECRET || env.MASTER_API_KEY)) || 'am-web-session-internal-secret'
  if (cachedKey && cachedSecret === secret) return cachedKey
  cachedKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  cachedSecret = secret
  return cachedKey
}

function b64url(bytes) {
  let s = ''
  const b = new Uint8Array(bytes)
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sign(payload, env) {
  const key = await hmacKey(env)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return b64url(sig)
}

function encodeIp(ip) {
  const s = String(ip)
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeIp(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/')
  const pad = s + '='.repeat((4 - (s.length % 4)) % 4)
  return decodeURIComponent(escape(atob(pad)))
}

/** Terbitkan token buat 1 IP. */
export async function issue(ip, env) {
  const exp = Date.now() + TTL_MS
  const payload = `${exp}.${encodeIp(ip)}`
  const sig = await sign(payload, env)
  return { token: `${payload}.${sig}`, expiresIn: Math.floor(TTL_MS / 1000) }
}

/** Verifikasi token: signature valid + belum expired + IP cocok. */
export async function verify(token, ip, env) {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [expStr, ipB64, sig] = parts
  const expect = await sign(`${expStr}.${ipB64}`, env)
  // constant-time compare
  if (sig.length !== expect.length || !sig.length) return false
  let diff = 0
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i)
  if (diff !== 0) return false
  const exp = parseInt(expStr, 10)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  let tokIp = ''
  try { tokIp = decodeIp(ipB64) } catch { return false }
  return tokIp === String(ip)
}

export { TTL_MS }
