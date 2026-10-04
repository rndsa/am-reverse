const { validateKeyAsync } = require('./keys')
const { getSettings } = require('./settings')
const webSession = require('./websession')
const { clientIp } = require('./security')

// [FIX C1] JANGAN percaya Origin/Referer (header yang dikontrol klien).
// Web UI sekarang pakai TOKEN BERTANDA TANGAN (HMAC), TTL 15 menit, diikat ke IP.
function hasWebToken(req) {
  let tok = req.headers['x-web-session'] || ''
  if (!tok && req.cookies && req.cookies['am_web']) tok = req.cookies['am_web']
  if (!tok) {
    // fallback: cookie mentah tanpa cookie-parser
    const raw = req.headers.cookie || ''
    const m = raw.match(/(?:^|;\s*)am_web=([^;]+)/)
    if (m) tok = decodeURIComponent(m[1])
  }
  return webSession.verify(tok, clientIp(req))
}

async function requireApiKey(req, res, next) {
  const settings = getSettings()

  // 1. Check if service is active
  if (!settings.service_active) {
    return res.status(503).json({
      success: false,
      error: 'SERVICE_OFFLINE',
      message: settings.maintenance_message || 'Layanan sedang dinonaktifkan oleh administrator.'
    })
  }

  // 2. If API key is NOT required globally, allow guest access
  if (!settings.require_api_key) {
    req.apiKey = { key: 'guest', name: 'Guest User', is_active: true }
    return next()
  }

  // Extract API key from headers or query
  let key = req.headers['x-api-key'] || ''
  
  if (!key && req.headers['authorization']) {
    const authHeader = req.headers['authorization']
    if (authHeader.startsWith('Bearer ')) {
      key = authHeader.slice(7).trim()
    } else {
      key = authHeader.trim()
    }
  }

  // [FIX R11] kredensial lewat query param DILARANG (bocor ke log/referrer/history)
  // Sebelumnya: ?api_key= diterima. Sekarang header-only.

  if (!key) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: "API Key wajib disertakan. Kirim lewat header 'x-api-key' atau 'Authorization: Bearer <key>'."
    })
  }

  const valid = await validateKeyAsync(key)
  if (!valid) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_API_KEY',
      message: 'API Key tidak valid atau telah dicabut.'
    })
  }

  req.apiKey = valid
  next()
}

// [FIX C1] Web UI gratis TANPA API key, tapi WAJIB token bertanda tangan.
// Akses API (curl/bot/script) tetap wajib API key.
async function optionalApiKey(req, res, next) {
  if (hasWebToken(req)) {
    req.apiKey = { key: 'webui', name: 'Web UI', is_active: true }
    return next()
  }
  return requireApiKey(req, res, next)
}

module.exports = {
  requireApiKey,
  optionalApiKey
}
