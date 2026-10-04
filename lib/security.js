// lib/security.js — header keamanan + CORS whitelist.
// CORS wildcard `*` diganti whitelist origin yang diketahui.

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://v.axjet.xyz,https://www.v.axjet.xyz,https://am-reverse.ren73265.workers.dev')
  .split(',').map(s => s.trim()).filter(Boolean)

// Origin loopback / dev (localhost, 127.0.0.1, LAN) — buat dev lokal
function isDevOrigin(origin) {
  if (!origin) return false
  try {
    const h = new URL(origin).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.endsWith('.local')
  } catch { return false }
}

function corsOrigin(origin) {
  if (!origin) return null           // same-origin / curl: gak perlu header
  if (ALLOWED_ORIGINS.includes(origin)) return origin
  if (isDevOrigin(origin)) return origin
  return null                        // origin asing: JANGAN echo
}

function corsMiddleware() {
  return (req, res, next) => {
    const origin = req.headers.origin
    const allow = corsOrigin(origin)
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', allow)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-api-key,x-master-key,x-admin-password,x-internal')
      res.setHeader('Access-Control-Max-Age', '86400')
    }
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  }
}

// Header keamanan dasar untuk semua response.
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",  // [FIX CSP] no unsafe-inline: script dipindah ke /assets/*.js + binding via addEventListener
      "style-src 'self' https://fonts.googleapis.com", // [FIX CSP2] no unsafe-inline: CSS di /assets/*.css
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'"
    ].join('; ')
  )
  // Jangan bocorin teknologi
  res.removeHeader('X-Powered-By')
  next()
}

// Halaman admin jangan pernah diindeks mesin pencari.
function noindex(res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
}

// Ambil IP client. Di Vercel, platform meng-overwrite x-forwarded-for.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim()
  return req.socket?.remoteAddress || '127.0.0.1'
}

module.exports = { corsMiddleware, securityHeaders, noindex, clientIp, ALLOWED_ORIGINS, corsOrigin }
