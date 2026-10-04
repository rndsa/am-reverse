const fs = require('fs')
const path = require('path')

// Vercel serverless: filesystem read-only kecuali /tmp
const SETTINGS_FILE = process.env.VERCEL
  ? '/tmp/am-data/settings.json'
  : path.join(__dirname, '..', 'data', 'settings.json')

const DEFAULT_SETTINGS = {
  // [FIX R1] JANGAN hardcode password di source. Wajib dari env.
  admin_password: process.env.ADMIN_PASSWORD || '',
  // [FIX R1] naikkan nilai ini -> SEMUA token admin lama langsung mati (revoke massal)
  session_epoch: 0,
  require_api_key: true,
  service_active: true,
  rate_limit_rpm: 60,
  maintenance_message: 'Layanan sedang dalam pemeliharaan sistem.'
  // [FIX R14] allow_registration & auto_save_sessions DIHAPUS: tidak ada implementasinya
  // di mana pun -> dulu hanya bikin admin mengira punya kontrol yang sebenarnya tidak ada.
}

function initSettings() {
  const dir = path.dirname(SETTINGS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2))
    return { ...DEFAULT_SETTINGS }
  }

  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    // Ensure admin_password exists
    if (!data.admin_password) data.admin_password = DEFAULT_SETTINGS.admin_password || process.env.ADMIN_PASSWORD || ''
    return { ...DEFAULT_SETTINGS, ...data }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function getSettings() {
  return initSettings()
}

function updateSettings(updates) {
  const cur = getSettings()
  const next = { ...cur }
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (updates[k] !== undefined) {
      next[k] = updates[k]
    }
  }
  // [FIX R1] ganti password -> otomatis naikkan epoch -> SEMUA token admin lama mati.
  // Juga kalau caller eksplisit minta revoke.
  // CATATAN: revoke_sessions TIDAK ikut di-whitelist ke dalam `next` (bukan setting tersimpan),
  // hanya memicu kenaikan epoch di bawah.
  const pwChanged = updates.admin_password !== undefined && updates.admin_password !== cur.admin_password
  const wantRevoke = updates.revoke_sessions === true
  if (pwChanged || wantRevoke) {
    next.session_epoch = (cur.session_epoch || 0) + 1
  }
  delete next.revoke_sessions
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2))
  return next
}

module.exports = {
  getSettings,
  updateSettings
}
