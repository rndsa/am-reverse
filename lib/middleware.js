const { validateKey } = require('./keys')
const { getSettings } = require('./settings')

// Request dari Web UI sendiri (Origin/Referer host yang sama)?
function isSameOrigin(req) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0]
  const sources = [req.headers.origin, req.headers.referer]
  for (const src of sources) {
    if (!src) continue
    try {
      const u = new URL(src)
      if (u.hostname === host) return true
    } catch {}
  }
  return false
}

function requireApiKey(req, res, next) {
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

  if (!key && req.query && req.query.api_key) {
    key = req.query.api_key
  }

  if (!key) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: "API Key wajib disertakan. Kirim via header 'x-api-key: *** 'Authorization: Bearer ***', atau query param '?api_key=...'"
    })
  }

  const valid = validateKey(key)
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

// API key HANYA wajib untuk POST langsung dari luar (postman/bot/script).
// Request dari Web UI sendiri (same-origin) = gratis tanpa key.
function optionalApiKey(req, res, next) {
  if (isSameOrigin(req)) {
    req.apiKey = { key: 'webui', name: 'Web UI', is_active: true }
    return next()
  }
  return requireApiKey(req, res, next)
}

module.exports = {
  requireApiKey,
  optionalApiKey
}
