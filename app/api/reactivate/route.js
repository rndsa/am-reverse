const express = require('express')
const { fromQuery } = require('../../../lib/get2body')
const auth = require('../../../lib/auth')
const { friendlyFirebaseError } = require('../../../lib/errors')
const { incrementStats, getStats } = require('../../../lib/stats')
const { saveSession } = require('../../../lib/sessions')

const router = express.Router()
const EMAIL_STRICT = /^[^\s<>"'`;()\[\]{},:\\@]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

// Struktur moduler ala ampremtools (ForgeMotion):
//   POST /api/verify   -> { email, rawLink }  -> verifikasi magic link, balas idToken
//   POST /api/provision -> { email, idToken } -> aktivasi premium pakai token

// TAHAP 1: verifikasi magic link
router.post('/verify', async (req, res) => {
  // fleksibel: terima rawLink / magicLink / link — isinya sama
  const { email } = req.body
  const rawLink = req.body.rawLink || req.body.magicLink || req.body.link
  if (!email || !EMAIL_STRICT.test(String(email))) {
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
// HYBRID: jalur utama dulu (expiry ~1 Sept 2027), kalau gagal → fallback cadangan
router.post('/provision', async (req, res) => {
  const { email, idToken } = req.body
  if (!idToken || !String(idToken).trim()) {
    return res.status(400).json({ success: false, message: 'idToken wajib diisi (dari tahap verify).' })
  }

  const em = email ? String(email).trim().toLowerCase() : null
  const tok = String(idToken).trim()

  // 1) coba jalur utama dulu
  let premium = await auth.dhansApply(tok, em)
  let engine = 'standard'

  // 2) fallback: purchase token annual kita
  if (!premium.ok) {
    premium = await auth.pro(tok)
    engine = 'annual'
  }

  const stats = premium.ok ? await incrementStats() : getStats()
  const now = new Date()

  if (!premium.ok) {
    return res.status(400).json({
      success: false,
      message: 'Aktivasi premium gagal: ' + friendlyFirebaseError(premium.why),
      code: premium.why
    })
  }

  // expiry dari server kalau ada, kalau gak ada pakai lokal now+1thn
  let validUntilTs = premium.expiry || null
  if (!validUntilTs) {
    const until = new Date()
    until.setFullYear(until.getFullYear() + 1)
    validUntilTs = until.getTime()
  }
  const validUntilDate = new Date(validUntilTs)

  // catat sesi sukses
  try {
    await saveSession({
      email: em || '(tanpa email)',
      uid: null,
      orderId: premium.order || null,
      status: 'ACTIVE',
      engine,
      validUntil: new Date(validUntilTs).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
      key_used: req.apiKey?.name || 'Unknown'
    })
  } catch {}

  return res.json({
    success: true,
    message: 'premium berhasil diaktifkan.',
    data: {
      email: em || null,
      engine,
      status: 'ACTIVE',
      membershipStatus: 'PREMIUM_ACTIVE',
      planName: 'Alight Motion Pro / Member',
      subscriptionType: engine === 'standard' ? 'Yearly VIP License' : 'Yearly VIP License',
      orderId: premium.order || null,
      expiryTimeMillis: validUntilTs,
      premiumResponse: premium.r || null,
      activatedAt: now.toISOString(),
      validUntil: validUntilDate.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
      validUntilTimestamp: validUntilTs,
      stats
    }
  })
})

// ===== GET handlers (query param version) =====
// GET /api/verify?email=x@y.com&rawLink=https://... (alias: magicLink, link, code)
const mapVerify = fromQuery({
  email: ['email', 'mail'],
  rawLink: ['rawLink', 'magicLink', 'link', 'url', 'code']
})

router.get('/verify', mapVerify, async (req, res) => {
  const { email } = req.body
  const rawLink = req.body.rawLink
  if (!email || !EMAIL_STRICT.test(String(email))) {
    return res.status(400).json({ success: false, message: 'email wajib. Pakai ?email=...&rawLink=...' })
  }
  if (!rawLink || !String(rawLink).trim()) {
    return res.status(400).json({ success: false, message: 'rawLink wajib. Pakai ?rawLink=... (alias: magicLink / link / code).' })
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

// GET /api/provision?email=x@y.com&idToken=...
const mapProvision = fromQuery({
  email: ['email', 'mail'],
  idToken: ['idToken', 'token', 'id_token']
})

router.get('/provision', mapProvision, async (req, res) => {
  const { email, idToken } = req.body
  if (!idToken || !String(idToken).trim()) {
    return res.status(400).json({ success: false, message: 'idToken wajib. Pakai ?idToken=... (dari tahap verify).' })
  }
  const em = email ? String(email).trim().toLowerCase() : null
  const tok = String(idToken).trim()

  let premium = await auth.dhansApply(tok, em)
  let engine = 'standard'
  if (!premium.ok) {
    premium = await auth.pro(tok)
    engine = 'annual'
  }
  const stats = premium.ok ? await incrementStats() : getStats()
  const now = new Date()

  if (!premium.ok) {
    return res.status(400).json({
      success: false,
      message: 'Aktivasi premium gagal: ' + friendlyFirebaseError(premium.why),
      code: premium.why
    })
  }

  let validUntilTs = premium.expiry || null
  if (!validUntilTs) {
    const until = new Date()
    until.setFullYear(until.getFullYear() + 1)
    validUntilTs = until.getTime()
  }
  const validUntilDate = new Date(validUntilTs)

  try {
    await saveSession({
      email: em || '(tanpa email)',
      uid: null,
      orderId: premium.order || null,
      status: 'ACTIVE',
      engine,
      validUntil: new Date(validUntilTs).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
      key_used: req.apiKey?.name || 'Unknown'
    })
  } catch {}

  return res.json({
    success: true,
    message: 'premium berhasil diaktifkan.',
    data: {
      email: em || null,
      engine,
      status: 'ACTIVE',
      membershipStatus: 'PREMIUM_ACTIVE',
      planName: 'Alight Motion Pro / Member',
      subscriptionType: engine === 'standard' ? 'Yearly VIP License' : 'Yearly VIP License',
      orderId: premium.order || null,
      expiryTimeMillis: validUntilTs,
      premiumResponse: premium.r || null,
      activatedAt: now.toISOString(),
      validUntil: validUntilDate.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
      validUntilTimestamp: validUntilTs,
      stats
    }
  })
})

// GET /api/reactivate?refreshToken=...
const mapReact = fromQuery({ refreshToken: ['refreshToken', 'refresh_token', 'refresh'] })

router.get('/', mapReact, async (req, res) => {
  const { refreshToken } = req.body
  if (!refreshToken || !String(refreshToken).trim()) {
    return res.status(400).json({ success: false, message: 'refreshToken wajib. Pakai ?refreshToken=...' })
  }
  const r = await auth.re(String(refreshToken).trim())
  if (!r.ok) {
    return res.status(400).json({ success: false, message: friendlyFirebaseError(r.why), code: r.why })
  }
  const premium = await auth.dhansApply(r.id, null)
  let engine = 'standard'
  if (!premium.ok) {
    await auth.pro(r.id)
    engine = 'annual'
  }
  const stats = premium.ok ? await incrementStats() : getStats()
  return res.json({
    success: true,
    message: 'Token berhasil di-refresh dan premium diperpanjang.',
    data: {
      engine,
      status: 'ACTIVE',
      idToken: r.id,
      refreshToken: r.ref,
      stats
    }
  })
})

module.exports = router
