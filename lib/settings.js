const fs = require('fs')
const path = require('path')

// Vercel serverless: filesystem read-only kecuali /tmp
const SETTINGS_FILE = process.env.VERCEL
  ? '/tmp/am-data/settings.json'
  : path.join(__dirname, '..', 'data', 'settings.json')

const DEFAULT_SETTINGS = {
  admin_password: process.env.ADMIN_PASSWORD || 'admin-secret-change-me',
  require_api_key: process.env.REQUIRE_API_KEY === 'true' || true,
  service_active: true,
  rate_limit_rpm: 60,
  maintenance_message: 'Layanan sedang dalam pemeliharaan sistem.',
  allow_registration: true,
  auto_save_sessions: true
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
    if (!data.admin_password) data.admin_password = DEFAULT_SETTINGS.admin_password
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
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2))
  return next
}

module.exports = {
  getSettings,
  updateSettings
}
