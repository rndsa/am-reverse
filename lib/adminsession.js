// lib/adminsession.js — token sesi admin bertanda tangan.
// [FIX R1] SEBELUMNYA: /api/keys/login mengembalikan PASSWORD MENTAH sebagai token.
// Sekarang: token acak bertanda tangan HMAC, ada expiry, bisa di-revoke (epoch).

const crypto = require('crypto')

const SECRET = process.env.ADMIN_SESSION_SECRET
  || process.env.WEB_SESSION_SECRET
  || process.env.MASTER_API_KEY
  || 'am-admin-session-internal-secret'
const TTL_MS = 8 * 60 * 60 * 1000 // 8 jam

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')
}

/**
 * Terbitkan token admin.
 * @param {number} epoch  penghitung revokasi (dari settings). Naikkan -> semua token lama mati.
 */
function issue(epoch = 0) {
  const exp = Date.now() + TTL_MS
  const nonce = crypto.randomBytes(12).toString('base64url')
  const payload = `${exp}.${epoch}.${nonce}`
  return { token: `${payload}.${sign(payload)}`, expiresIn: Math.floor(TTL_MS / 1000) }
}

/**
 * Verifikasi token admin.
 * @param {string} token
 * @param {number} expectedEpoch  epoch yang berlaku sekarang
 */
function verify(token, expectedEpoch = 0) {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 4) return false
  const [expStr, epochStr, nonce, sig] = parts
  const payload = `${expStr}.${epochStr}.${nonce}`
  const expect = sign(payload)
  // constant-time, panjang disamakan via hash
  const A = crypto.createHash('sha256').update(String(sig)).digest()
  const B = crypto.createHash('sha256').update(String(expect)).digest()
  if (!crypto.timingSafeEqual(A, B)) return false
  const exp = parseInt(expStr, 10)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  const ep = parseInt(epochStr, 10)
  if (!Number.isFinite(ep) || ep !== Number(expectedEpoch || 0)) return false
  return true
}

module.exports = { issue, verify, TTL_MS }
