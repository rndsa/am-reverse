const express = require('express')
const auth = require('../../../lib/auth')
const { friendlyFirebaseError } = require('../../../lib/errors')
const { incrementStats, getStats } = require('../../../lib/stats')
const { saveSession } = require('../../../lib/sessions')

const router = express.Router()

// Struktur moduler ala ampremtools (ForgeMotion):
//   POST /api/verify   -> { email, rawLink }  -> verifikasi magic link, balas idToken
//   POST /api/provision -> { email, idToken } -> aktivasi premium pakai token

// TAHAP 1: verifikasi magic link
router.post('/verify', async (req, res) => {
  // fleksibel: terima rawLink / magicLink / link — isinya sama
  const { email } = req.body
  const rawLink = req.body.rawLink || req.body.magicLink || req.body.link
  if (!email || !String(email).includes('@')) {
    return res.status(400).json({ success: false, message: 'email wajib diisi.' })
  }
  if (!rawLink || !String(rawLink).trim()) {
    return res.status(400).json({ success: false, message: 'rawLink (magic link dari email) wajib diisi (rawLink / magicLink / link).' })
  }

  const em = String(email).trim().toLowerCase()
  const v = await auth.auth(em, String(rawLink).trim())
  if (!v.ok) {
    return res.status(400).json({ success: false, message: friendlyFirebaseError(v.why), code: v.why })
  }

  return res.json({
    success: true,
    message: 'magic link valid, token berhasil didapat.',
    data: {
      email: v.user?.email || em,
      uid: v.uid,
      isNewUser: !!v.baru,
      idToken: v.id,
      refreshToken: v.ref,
      profile: v.user || null
    }
  })
})

// TAHAP 2: provision premium pakai idToken
router.post('/provision', async (req, res) => {
  const { email, idToken } = req.body
  if (!idToken || !String(idToken).trim()) {
    return res.status(400).json({ success: false, message: 'idToken wajib diisi (dari tahap verify).' })
  }

  const em = email ? String(email).trim().toLowerCase() : null
  const premium = await auth.pro(String(idToken).trim())
  const stats = premium.ok ? incrementStats() : getStats()

  const now = new Date()
  const until = new Date()
  until.setFullYear(until.getFullYear() + 1)

  if (!premium.ok) {
    return res.status(400).json({
      success: false,
      message: 'Aktivasi premium gagal: ' + friendlyFirebaseError(premium.why),
      code: premium.why
    })
  }

  // catat sesi sukses
  try {
    saveSession({
      email: em || '(tanpa email)',
      uid: null,
      orderId: premium.order || null,
      status: 'ACTIVE',
      key_used: req.apiKey?.name || 'Unknown'
    })
  } catch {}

  return res.json({
    success: true,
    message: 'premium berhasil diaktifkan.',
    data: {
      email: em || null,
      status: 'ACTIVE',
      membershipStatus: 'PREMIUM_ACTIVE',
      planName: 'Alight Motion Pro / Member',
      subscriptionType: 'Yearly VIP License',
      orderId: premium.order || null,
      premiumResponse: premium.r || null,
      activatedAt: now.toISOString(),
      validUntil: until.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
      validUntilTimestamp: until.getTime(),
      stats
    }
  })
})

module.exports = router
