const express = require('express')
const { createKey, listKeysAsync, listKeys, toggleKeyStatus, revokeKey, getKeysData, getKeysDataSync } = require('../../../lib/keys')
const { getSettings, updateSettings } = require('../../../lib/settings')
const { getStats, getStatsAsync } = require('../../../lib/stats')
const { getSessions } = require('../../../lib/sessions')
const { getLogs, clearLogs } = require('../../../lib/logger')

const router = express.Router()
const { maskSession } = require('../../../lib/mask')
const adminSession = require('../../../lib/adminsession')
const crypto = require('crypto')

// [SEC] bandingkan string tanpa bocorin waktu (anti timing attack)
function safeEqual(a, b) {
  const A = Buffer.from(String(a ?? ''))
  const B = Buffer.from(String(b ?? ''))
  if (!A.length || !B.length) return false // [SEC] nilai kosong = selalu gagal
  if (A.length !== B.length) return false
  return crypto.timingSafeEqual(A, B)
}

// [SEC] master key & password internal: dukung env var, jangan hardcode di repo publik
// [FIX R10] JANGAN hardcode password di source. Wajib dari env (settings.json / ADMIN_PASSWORD).
const INTERNAL_PASS = process.env.ADMIN_PASSWORD || ''
const INTERNAL_MASTER = process.env.MASTER_API_KEY || null

// Middleware checking master key OR admin password
function requireMasterKey(req, res, next) {
  const settings = getSettings()
  const masterKey = getKeysDataSync().master_key
  const envMaster = process.env.MASTER_API_KEY || INTERNAL_MASTER
  const adminPass = settings.admin_password || INTERNAL_PASS
  
  let key = req.headers['x-api-key'] || req.headers['x-master-key'] || req.headers['x-admin-password'] || ''
  if (!key && req.headers['authorization']) {
    key = req.headers['authorization'].replace(/^Bearer\s+/i, '').trim()
  }
  // [FIX R11] JANGAN terima kredensial dari query param.
  // Terverifikasi: ?key=<token> masuk ke access log server mentah
  // (juga bocor ke Referer, browser history, proxy log). Header only.

  // [FIX R1] password TIDAK lagi diterima sebagai bearer token.
  // [FIX R17] PEMISAHAN HAK: master_key (kunci API) TIDAK boleh membuka rute admin.
  //   - ADMIN_KEY (env) atau admin_key tersimpan  -> admin penuh
  //   - token sesi bertanda tangan (login)        -> admin penuh
  //   - master_key                                -> DITOLAK di sini (hanya untuk API)
  // Selama ADMIN_KEY belum di-set, perilaku lama dipertahankan agar tidak lockout,
  // tapi ada peringatan di log supaya segera diisi.
  const storedAdminKey = getKeysDataSync().admin_key
  const envAdminKey = process.env.ADMIN_KEY || null
  const epoch = settings.session_epoch || 0

  const isSession = adminSession.verify(key, epoch)
  const isAdminKey = key && ((storedAdminKey && safeEqual(key, storedAdminKey)) ||
                             (envAdminKey && safeEqual(key, envAdminKey)))
  const isMaster = key && (safeEqual(key, masterKey) || (envMaster && safeEqual(key, envMaster)))

  let isValid = Boolean(isSession || isAdminKey)
  if (!isValid && isMaster && !storedAdminKey && !envAdminKey) {
    // mode transisi: belum ada admin_key -> master key masih boleh (dgn peringatan)
    isValid = true
    if (!requireMasterKey._warned) {
      requireMasterKey._warned = true
      console.warn('[SEC][R17] ADMIN_KEY/admin_key belum di-set — master_key masih bisa akses admin. Set ADMIN_KEY untuk memisahkan hak.')
    }
  }

  if (!key || !isValid) {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak: kredensial admin tidak valid.'
    })
  }
  next()
}

// 0. Login Admin with Password
router.post('/login', (req, res) => {
  const { password } = req.body
  const settings = getSettings()
  const masterKey = getKeysDataSync().master_key
  const adminPass = settings.admin_password || INTERNAL_PASS

  if (safeEqual(password, adminPass) || safeEqual(password, masterKey)) {
    // [FIX R1] token acak bertanda tangan + expiry; password TIDAK pernah dikirim balik.
    const epoch = settings.session_epoch || 0
    const { token, expiresIn } = adminSession.issue(epoch)
    return res.json({
      success: true,
      message: 'Login berhasil.',
      token,
      expiresIn
    })
  }

  // [SEC] delay tetap -> brute-force jadi mahal (rate limit = lapisan utama)
  setTimeout(() => {
    res.status(401).json({
      success: false,
      message: 'Password admin salah!'
    })
  }, 700)
})

// 0b. [FIX R1] Revoke SEMUA token admin (naikkan session_epoch)
router.post('/logout-all', requireMasterKey, (req, res) => {
  const cur = getSettings()
  const nextEpoch = (cur.session_epoch || 0) + 1
  updateSettings({ session_epoch: nextEpoch })
  return res.json({
    success: true,
    message: 'Semua sesi admin dicabut. Login ulang diperlukan.',
    session_epoch: nextEpoch
  })
})

// 1. Dashboard Stats
router.get('/stats-detailed', requireMasterKey, async (req, res) => {
  const keys = await listKeysAsync()
  const stats = await getStatsAsync()
  const activeCount = keys.filter(k => k.is_active).length
  const totalReqs = keys.reduce((acc, k) => acc + (k.total_requests || 0), 0)

  res.json({
    success: true,
    data: {
      total_keys: keys.length,
      active_keys: activeCount,
      inactive_keys: keys.length - activeCount,
      total_requests: totalReqs,
      total_activations: stats.total || 0,
      today_activations: stats.today || 0,
      server_uptime: Math.round(process.uptime()),
      memory_usage_mb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    }
  })
})

// 2. Settings CRUD
router.get('/settings', requireMasterKey, (req, res) => {
  // [FIX R1] JANGAN kirim password admin ke klien.
  const s = { ...getSettings() }
  delete s.admin_password
  res.json({
    success: true,
    settings: s
  })
})

router.put('/settings', requireMasterKey, (req, res) => {
  const before = getSettings()
  // [FIX R5] Mass-assignment pada `service_active` = primitive DoS:
  // satu PUT dgn body nyasar/CSRF-style bisa mematikan layanan untuk SEMUA user.
  // (Diverifikasi: admin TIDAK terkunci saat service mati, jadi bukan lockout —
  //  murni pencegahan pemadaman gak-sengaja.) Wajib flag eksplisit `maintenance_mode`.
  if (req.body && req.body.service_active !== undefined && req.body.maintenance_mode !== true) {
    delete req.body.service_active
  }
  delete req.body.maintenance_mode
  // [FIX R14] field yang TIDAK punya implementasi = kontrol keamanan palsu.
  // Sebelumnya admin bisa "revoke_sessions" dan dapat pesan "berhasil", padahal
  // tidak terjadi apa pun. Sekarang ditolak eksplisit.
  // (revoke_sessions TIDAK termasuk: itu benar-benar menaikkan session_epoch)
  const UNSUPPORTED = ['allow_registration','auto_save_sessions']
  const asked = UNSUPPORTED.filter(k => req.body && req.body[k] !== undefined)
  if (asked.length) {
    return res.status(400).json({
      success: false,
      message: `Pengaturan ini belum diimplementasikan: ${asked.join(', ')}.`
    })
  }
  // [FIX R5b] whitelist field — jangan biarkan caller nulis field internal sembarangan
  const ALLOWED = ['admin_password','require_api_key','service_active','rate_limit_rpm','maintenance_message','revoke_sessions']
  for (const k of Object.keys(req.body || {})) {
    if (!ALLOWED.includes(k)) delete req.body[k]
  }
  const pwChanging = req.body && req.body.admin_password !== undefined
                       && req.body.admin_password !== before.admin_password
  const updated = updateSettings(req.body)
  // [FIX R1] JANGAN balikin password mentah ke klien.
  const safe = { ...updated }
  delete safe.admin_password
  res.json({
    success: true,
    message: 'Pengaturan berhasil disimpan.',
    // kalau password diganti -> token admin lama mati, wajib login ulang
    relogin_required: pwChanging,
    settings: safe
  })
})

// 3. Keys CRUD
router.get('/', requireMasterKey, async (req, res) => {
  // pastikan cache file sinkron dengan Edge Config sebelum list
  await getKeysData()
  res.json({
    success: true,
    keys: listKeys()
  })
})

router.post('/', requireMasterKey, async (req, res) => {
  const { name = 'Client Key', prefix = 'am-sk' } = req.body
  // [FIX R12] tolak input kebesaran sebelum menyentuh store
  if (typeof name === 'string' && name.length > 200) {
    return res.status(400).json({ success: false, message: 'Nama key maksimal 64 karakter.' })
  }
  let newEntry
  try {
    newEntry = await createKey(name, prefix)
  } catch (e) {
    if (e && e.code === 'MAX_KEYS') {
      return res.status(400).json({ success: false, message: e.message })
    }
    return res.status(500).json({ success: false, message: 'Gagal membuat key.' })
  }
  res.status(201).json({
    success: true,
    message: 'API Key baru berhasil dibuat.',
    key: newEntry
  })
})

router.patch('/:key/toggle', requireMasterKey, async (req, res) => {
  const { key } = req.params
  // [FIX R8] jangan biarkan menonaktifkan key aktif terakhir / master key
  const _mk2 = getKeysDataSync().master_key
  if (safeEqual(key, _mk2)) {
    return res.status(400).json({ success: false, message: 'Master key tidak bisa dinonaktifkan.' })
  }
  const _all2 = await listKeysAsync()
  if (_all2.filter(k => k.key !== key && k.is_active).length === 0) {
    return res.status(400).json({ success: false, message: 'Tidak bisa menonaktifkan key aktif terakhir.' })
  }
  const updated = await toggleKeyStatus(key)
  if (!updated) {
    return res.status(404).json({ success: false, message: 'Key tidak ditemukan.' })
  }
  res.json({
    success: true,
    message: `Status key berhasil diubah menjadi ${updated.is_active ? 'Aktif' : 'Nonaktif'}.`,
    key: updated
  })
})

router.delete('/:key', requireMasterKey, async (req, res) => {
  const { key } = req.params
  // [FIX R8] cegah self-lockout: master key & key aktif terakhir gak boleh dihapus.
  const _mk = getKeysDataSync().master_key
  const _envMk = process.env.MASTER_API_KEY
  if (safeEqual(key, _mk) || (_envMk ? safeEqual(key, _envMk) : false)) {
    return res.status(400).json({ success: false, message: 'Master key tidak boleh dihapus (bisa mengunci semua akses).' })
  }
  const _all = await listKeysAsync()
  if (_all.filter(k => k.key !== key && k.is_active).length === 0) {
    return res.status(400).json({ success: false, message: 'Tidak bisa hapus key aktif terakhir (bisa mengunci semua akses).' })
  }
  const ok = await revokeKey(key)
  if (!ok) {
    return res.status(404).json({ success: false, message: 'Key tidak ditemukan.' })
  }
  res.json({
    success: true,
    message: 'API Key berhasil dihapus.'
  })
})

// 4. Session Logs (Activations)
router.get('/sessions', requireMasterKey, async (req, res) => {
  // PRIVASI: email user TIDAK PERNAH dikirim mentah ke klien.
  const list = await getSessions()
  res.json({
    success: true,
    sessions: list.map(maskSession)
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
