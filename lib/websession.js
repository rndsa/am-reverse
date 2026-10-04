// lib/websession.js — token sesi web bertanda tangan (HMAC), umur pendek, diikat ke IP.
// Ganti cek Origin/Referer (spoofable) buat gerbang "web UI gratis tanpa key".
// Catatan jujur: curl tetap bisa ambil token (browser vs script gak bisa dibedain total);
// yang bikin abuse mahal = TTL pendek + ikat IP + rate limit penerbitan + kuota harian.

const crypto = require('crypto')

const SECRET = process.env.WEB_SESSION_SECRET
  || process.env.MASTER_API_KEY
  || 'am-web-session-internal-secret' // fallback stabil; set env di prod
const TTL_MS = 15 * 60 * 1000 // 15 menit

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}

/** Terbitkan token buat 1 IP. */
function issue(ip) {
  const exp = Date.now() + TTL_MS
  const payload = `${exp}.${Buffer.from(String(ip)).toString('base64url')}`
  return { token: `${payload}.${sign(payload)}`, expiresIn: Math.floor(TTL_MS / 1000) }
}

/** Verifikasi token: signature valid + belum expired + IP cocok. */
function verify(token, ip) {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [expStr, ipB64, sig] = parts
  const payload = `${expStr}.${ipB64}`
  const expect = sign(payload)
  // [SEC] constant-time TANPA bocorin panjang: hash dulu biar selalu sama panjang
  const A = crypto.createHash('sha256').update(String(sig)).digest()
  const B = crypto.createHash('sha256').update(String(expect)).digest()
  if (!crypto.timingSafeEqual(A, B)) return false
  const exp = parseInt(expStr, 10)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  let tokIp = ''
  try { tokIp = Buffer.from(ipB64, 'base64url').toString() } catch { return false }
  return tokIp === String(ip)
}

module.exports = { issue, verify, TTL_MS }
