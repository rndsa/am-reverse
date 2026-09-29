const { validateKey } = require('./keys')
const { getSettings } = require('./settings')

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

  // Extract API key strictly from headers (x-api-key or Authorization Bearer)
  let key = req.headers['x-api-key'] || ''
  
  if (!key && req.headers['authorization']) {
    const authHeader = req.headers['authorization']
    if (authHeader.startsWith('Bearer ')) {
      key = authHeader.slice(7).trim()
    } else {
      key = authHeader.trim()
    }
  }

  if (!key) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: "API Key wajib disertakan. Kirim via header 'x-api-key: <key>' atau 'Authorization: Bearer <key>'."
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

// API key enforcement
function optionalApiKey(req, res, next) {
  return requireApiKey(req, res, next)
}

module.exports = {
  requireApiKey,
  optionalApiKey
}
