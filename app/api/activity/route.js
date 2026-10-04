const express = require('express')
const { getSessions } = require('../../../lib/sessions')
const { maskEmail, maskOrderId } = require('../../../lib/mask')

const router = express.Router()


// GET /api/activity — feed aktivasi live (publik). Email HANYA versi ter-sensor.
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 10)
    const sessions = await getSessions()
    const sorted = [...sessions].sort((a, b) => new Date(b.saved_at || 0) - new Date(a.saved_at || 0))
    const feed = sorted.slice(0, limit).map(s => ({
      email: maskEmail(s.email),
      status: s.status || 'ACTIVE',
      engine: s.engine || 'standard',
      orderCode: maskOrderId(s.orderId || s.orderCode || null),  // [FIX R22] jangan bocorin identifier internal
      validUntil: s.validUntil || null,
      time: s.saved_at || null
    }))
    res.json({ success: true, total: sessions.length, feed })
  } catch (e) {
    res.json({ success: true, total: 0, feed: [] })
  }
})

module.exports = router
