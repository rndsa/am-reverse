// app/api/websession/route.js — terbitkan token sesi web (pengganti cek Origin/Referer).
// Web UI memanggil ini sekali saat halaman dimuat; akses API tetap wajib API key.
const express = require('express')
const webSession = require('../../../lib/websession')
const { clientIp } = require('../../../lib/security')

const router = express.Router()

// Kuota penerbitan token per IP per hari. Ceiling map wajib (anti memory-leak).
const MAX_KEYS = 20000
const DAILY_LIMIT = 200
const issued = new Map() // ip -> { count, day }

function today() { return new Date().toISOString().slice(0, 10) }

function takeQuota(ip) {
  const d = today()
  const e = issued.get(ip)
  if (!e || e.day !== d) {
    issued.set(ip, { count: 1, day: d })
    if (issued.size > MAX_KEYS) {
      const overflow = issued.size - MAX_KEYS
      let i = 0
      for (const k of issued.keys()) { if (i++ >= overflow) break; issued.delete(k) }
    }
    return { ok: true, remaining: DAILY_LIMIT - 1 }
  }
  if (e.count >= DAILY_LIMIT) return { ok: false, remaining: 0 }
  e.count += 1
  return { ok: true, remaining: DAILY_LIMIT - e.count }
}

// GET /api/websession -> { token }
router.get('/', (req, res) => {
  const ip = clientIp(req)
  const q = takeQuota(ip)
  if (!q.ok) {
    return res.status(429).json({
      success: false,
      error: 'QUOTA_EXCEEDED',
      message: 'Kuota sesi web harian habis. Coba lagi besok.'
    })
  }
  const { token, expiresIn } = webSession.issue(ip)
  // Cookie HttpOnly + SameSite biar aman dari JS halaman
  res.setHeader('Set-Cookie',
    `am_web=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${expiresIn}`)
  res.setHeader('Cache-Control', 'no-store')
  res.json({ success: true, token, expiresIn, remaining: q.remaining })
})

module.exports = router
