const express = require('express')
const auth = require('../../../lib/auth')
const { fromQuery } = require('../../../lib/get2body')
const { friendlyFirebaseError } = require('../../../lib/errors')

const router = express.Router()
const EMAIL_STRICT = /^[^\s<>"'`;()\[\]{},:\\@]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

// POST /api/send-link  { email }
// GET  /api/send-link?email=x@y.com
router.post('/', async (req, res) => {
  const { email } = req.body
  if (!email || !EMAIL_STRICT.test(String(email))) {
    return res.status(400).json({ success: false, message: 'email gak valid.' })
  }
  const em = email.trim().toLowerCase()
  const r = await auth.link(em)
  if (!r.ok) {
    return res.status(400).json({ success: false, message: friendlyFirebaseError(r.why), code: r.why })
  }
  return res.json({ success: true, email: em, message: `link dikirim ke ${em}. cek inbox / spam.` })
})

// GET handler — reuse logic POST via query mapping
const mapQuery = fromQuery({ email: ['email', 'mail'] })
router.get('/', mapQuery, async (req, res) => {
  const { email } = req.body
  if (!email || !EMAIL_STRICT.test(String(email))) {
    return res.status(400).json({ success: false, message: 'email gak valid. Pakai ?email=...' })
  }
  const em = email.trim().toLowerCase()
  const r = await auth.link(em)
  if (!r.ok) {
    return res.status(400).json({ success: false, message: friendlyFirebaseError(r.why), code: r.why })
  }
  return res.json({ success: true, email: em, message: `link dikirim ke ${em}. cek inbox / spam.` })
})

module.exports = router
