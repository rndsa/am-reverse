const express = require('express')
const auth = require('../../../lib/auth')
const { friendlyFirebaseError } = require('../../../lib/errors')
const { incrementStats, getStats } = require('../../../lib/stats')
const { saveSession } = require('../../../lib/sessions')

const router = express.Router()


// GET /api/verify-link?email=x@y.com&magicLink=https://... (alias: rawLink, link, url)
const { fromQuery } = require('../../../lib/get2body')
const mapQuery = fromQuery({
  email: ['email', 'mail'],
  magicLink: ['magicLink', 'rawLink', 'link', 'url', 'code']
})

function renderResult(v, premium, engine, validUntilTs, em, stats) {
  const now = new Date()
  const validUntilDate = new Date(validUntilTs)
  return {
    success: true,
    message: premium.ok ? 'verifikasi berhasil, premium aktif.' : 'login berhasil, aktivasi premium gagal.',
    data: {
      stats: stats,
      uid: v.uid,
      email: v.user?.email || em,
      emailVerified: v.user?.emailVerified ?? true,
      displayName: v.user?.displayName || null,
      photoUrl: v.user?.photoUrl || null,
      createdAt: v.user?.createdAt ? new Date(Number(v.user.createdAt)).toISOString() : null,
      lastLoginAt: v.user?.lastLoginAt ? new Date(Number(v.user.lastLoginAt)).toISOString() : now.toISOString(),
      isNewUser: v.baru,
      status: premium.ok ? 'ACTIVE' : 'INACTIVE',
      membershipStatus: premium.ok ? 'PREMIUM_ACTIVE' : 'LOGIN_ONLY',
      planName: 'Alight Motion Pro / Member',
      subscriptionType: engine === 'standard' ? 'Yearly VIP License' : 'Yearly VIP License',
      engine,
      orderId: premium.order || null,
      expiryTimeMillis: validUntilTs,
      activatedAt: now.toISOString(),
      validUntil: validUntilDate.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
      validUntilTimestamp: validUntilTs,
      tokenType: 'Bearer',
      idToken: v.id,
      refreshToken: v.ref,
      premiumResponse: premium.ok ? premium.r : null,
      premiumError: premium.ok ? null : premium.why,
      profile: v.user || null
    }
  }
}

router.post('/', async (req, res) => {
  // fleksibel: terima magicLink / rawLink / link — isinya sama
  const { email } = req.body
  const magicLink = req.body.magicLink || req.body.rawLink || req.body.link
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: 'email wajib diisi.' })
  }
  if (!magicLink || !magicLink.trim()) {
    return res.status(400).json({ success: false, message: 'link dari email wajib diisi (magicLink / rawLink / link).' })
  }

  const em = email.trim().toLowerCase()
  const v = await auth.auth(em, magicLink.trim())
  if (!v.ok) {
    return res.status(400).json({ success: false, message: friendlyFirebaseError(v.why), code: v.why })
  }

  // HYBRID: jalur utama dulu, fallback cadangan
  let premium = await auth.dhansApply(v.id, em)
  let engine = 'standard'
  if (!premium.ok) {
    premium = await auth.pro(v.id)
    engine = 'annual'
  }
  const stats = premium.ok ? await incrementStats() : getStats()

  let validUntilTs = premium.expiry || null
  if (!validUntilTs) {
    const until = new Date()
    until.setFullYear(until.getFullYear() + 1)
    validUntilTs = until.getTime()
  }

  try {
    await saveSession({
      email: em,
      uid: v.uid,
      orderId: premium.order || null,
      status: premium.ok ? 'ACTIVE' : 'FAILED',
      engine,
      validUntil: new Date(validUntilTs).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
      key_used: req.apiKey?.name || 'Unknown'
    })
  } catch (e) {}

  return res.json(renderResult(v, premium, engine, validUntilTs, em, stats))
})

// GET handler — sama seperti POST tapi input dari query params
router.get('/', mapQuery, async (req, res) => {
  const { email } = req.body
  const magicLink = req.body.magicLink
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: 'email wajib. Pakai ?email=...&magicLink=...' })
  }
  if (!magicLink || !magicLink.trim()) {
    return res.status(400).json({ success: false, message: 'magicLink wajib. Pakai ?magicLink=... (alias: rawLink / link / url).' })
  }

  const em = email.trim().toLowerCase()
  const v = await auth.auth(em, magicLink.trim())
  if (!v.ok) {
    return res.status(400).json({ success: false, message: friendlyFirebaseError(v.why), code: v.why })
  }

  // HYBRID: jalur utama dulu, fallback cadangan
  let premium = await auth.dhansApply(v.id, em)
  let engine = 'standard'
  if (!premium.ok) {
    premium = await auth.pro(v.id)
    engine = 'annual'
  }
  const stats = premium.ok ? await incrementStats() : getStats()

  let validUntilTs = premium.expiry || null
  if (!validUntilTs) {
    const until = new Date()
    until.setFullYear(until.getFullYear() + 1)
    validUntilTs = until.getTime()
  }

  try {
    await saveSession({
      email: em,
      uid: v.uid,
      orderId: premium.order || null,
      status: premium.ok ? 'ACTIVE' : 'FAILED',
      engine,
      validUntil: new Date(validUntilTs).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
      key_used: req.apiKey?.name || 'Unknown'
    })
  } catch (e) {}

  return res.json(renderResult(v, premium, engine, validUntilTs, em, stats))
})

module.exports = router

