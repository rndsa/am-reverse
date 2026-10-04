// lib/mask.js — PII masking helper.
// Tujuan: email user TIDAK PERNAH keluar mentah dari server ke klien / log.
// Bentuk: n••••••@g•••l.com

// [FIX R7] Buang SEMUA karakter di luar allowlist sebelum apa pun.
// Tanpa ini: email `a@x.y<img src=x onerror=...>` lolos validasi `includes('@')`,
// tail domain selamat dari masking, lalu di-render via innerHTML -> STORED XSS.
function sanitize(s) {
  return String(s || '').replace(/[^A-Za-z0-9.\-_+]/g, '')
}

function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return 'u•••@hidden'
  const at = email.lastIndexOf('@')
  const local = sanitize(email.slice(0, at))
  const domain = sanitize(email.slice(at + 1))
  if (!local || !domain) return 'u•••@hidden'
  const l = local.slice(0, 1) + '•'.repeat(Math.max(2, Math.min(6, local.length - 1)))
  const dp = domain.split('.')
  const head = dp[0] || ''
  const dmask = head.slice(0, 1) + '•'.repeat(Math.max(2, Math.min(5, head.length - 1)))
  const tail = dp.slice(1).filter(Boolean).join('.')
  return `${l}@${dmask}${tail ? '.' + tail : ''}`
}

// Sembunyikan email apa pun yang nempel di string bebas (mis. kolom log `Email: x@y.com`)
function maskText(text) {
  if (!text || typeof text !== 'string') return text
  return text.replace(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (m) => maskEmail(m))
}

// Sensor objek session: ganti .email jadi versi masked
function maskSession(s) {
  if (!s || typeof s !== 'object') return s
  const out = { ...s }
  if (out.email) out.email = maskEmail(out.email)
  if (out.details) out.details = maskText(out.details)
  return out
}

// [FIX R22] identifier internal (orderId) jangan tampil mentah di feed publik.
// Tetap dikasih bentuk yang bisa dibedakan (awalan + 4 char terakhir), tapi tidak
// mengungkap nilai asli yang tersimpan di DB / dipakai internal.
function maskOrderId(v) {
  if (!v || typeof v !== 'string') return null
  const s = String(v)
  if (s.length <= 8) return '••••'
  return s.slice(0, 4) + '••••' + s.slice(-2)
}

module.exports = { maskEmail, maskText, maskSession, maskOrderId }
