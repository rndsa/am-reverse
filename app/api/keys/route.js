const express = require('express')
const { createKey, listKeys, toggleKeyStatus, revokeKey, getKeysData } = require('../../../lib/keys')
const { getSettings, updateSettings } = require('../../../lib/settings')
const { getStats } = require('../../../lib/stats')
const { getSessions } = require('../../../lib/sessions')
const { getLogs, clearLogs } = require('../../../lib/logger')

const router = express.Router()

// Middleware checking master key OR admin password
function requireMasterKey(req, res, next) {
  const settings = getSettings()
  const masterKey = getKeysData().master_key
  const envMaster = process.env.MASTER_API_KEY
  const adminPass = settings.admin_password || process.env.ADMIN_PASSWORD || 'admin-secret-change-me'
  
  let key = req.headers['x-api-key'] || req.headers['x-master-key'] || req.headers['x-admin-password'] || ''
  if (!key && req.headers['authorization']) {
    key = req.headers['authorization'].replace(/^Bearer\s+/i, '').trim()
  }
  if (!key && req.query.key) key = req.query.key

  const isValid = (key === masterKey) || 
                  (envMaster && key === envMaster) || 
                  (key === adminPass)

  if (!key || !isValid) {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak: Password admin atau Master Key tidak valid.'
    })
  }
  next()
}

// 0. Login Admin with Password
router.post('/login', (req, res) => {
  const { password } = req.body
  const settings = getSettings()
  const masterKey = getKeysData().master_key
  const adminPass = settings.admin_password || process.env.ADMIN_PASSWORD || 'admin-secret-change-me'

  if (password === adminPass || password === masterKey) {
    return res.json({
      success: true,
      message: 'Login berhasil.',
      token: adminPass
    })
  }

  return res.status(401).json({
    success: false,
    message: 'Password admin salah!'
  })
})

// 1. Dashboard Stats
router.get('/stats-detailed', requireMasterKey, (req, res) => {
  const keys = listKeys()
  const stats = getStats()
  const activeCount = keys.filter(k => k.is_active).length
  const totalReqs = keys.reduce((acc, k) => acc + (k.total_requests || 0), 0)

  res.json({
    success: true,
    data: {
      total_keys: keys.length,
      active_keys: activeCount,
      inactive_keys: keys.length - activeCount,
      total_requests: totalReqs,
      total_activations: stats.totalPremium || 0,
      today_activations: stats.todayPremium || 0,
      server_uptime: Math.round(process.uptime()),
      memory_usage_mb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    }
  })
})

// 2. Settings CRUD
router.get('/settings', requireMasterKey, (req, res) => {
  res.json({
    success: true,
    settings: getSettings()
  })
})

router.put('/settings', requireMasterKey, (req, res) => {
  const updated = updateSettings(req.body)
  res.json({
    success: true,
    message: 'Pengaturan berhasil disimpan.',
    settings: updated
  })
})

// 3. Keys CRUD
router.get('/', requireMasterKey, (req, res) => {
  res.json({
    success: true,
    keys: listKeys()
  })
})

router.post('/', requireMasterKey, (req, res) => {
  const { name = 'Client Key', prefix = 'am-sk' } = req.body
  const newEntry = createKey(name, prefix)
  res.status(201).json({
    success: true,
    message: 'API Key baru berhasil dibuat.',
    key: newEntry
  })
})

router.patch('/:key/toggle', requireMasterKey, (req, res) => {
  const { key } = req.params
  const updated = toggleKeyStatus(key)
  if (!updated) {
    return res.status(404).json({ success: false, message: 'Key tidak ditemukan.' })
  }
  res.json({
    success: true,
    message: `Status key berhasil diubah menjadi ${updated.is_active ? 'Aktif' : 'Nonaktif'}.`,
    key: updated
  })
})

router.delete('/:key', requireMasterKey, (req, res) => {
  const { key } = req.params
  const ok = revokeKey(key)
  if (!ok) {
    return res.status(404).json({ success: false, message: 'Key tidak ditemukan.' })
  }
  res.json({
    success: true,
    message: 'API Key berhasil dihapus.'
  })
})

// 4. Session Logs (Activations)
router.get('/sessions', requireMasterKey, (req, res) => {
  res.json({
    success: true,
    sessions: getSessions()
  })
})

// 5. HTTP Request / System Logs
router.get('/logs', requireMasterKey, (req, res) => {
  const limit = parseInt(req.query.limit) || 100
  const q = req.query.q || ''
  res.json({
    success: true,
    logs: getLogs(limit, q)
  })
})

router.delete('/logs', requireMasterKey, (req, res) => {
  clearLogs()
  res.json({
    success: true,
    message: 'Log riwayat request berhasil dibersihkan.'
  })
})

module.exports = router
