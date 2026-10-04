const express = require('express')
const path = require('path')
const apiRoutes = require('./app/api/route')
const { initKeysFile } = require('./lib/keys')
const { addLog } = require('./lib/logger')
const { maskText } = require('./lib/mask')
const { corsMiddleware, securityHeaders, noindex, clientIp } = require('./lib/security')
const rl = require('./lib/ratelimit')

const app = express()
app.disable('x-powered-by') // [SEC] jangan bocorin teknologi
const PORT = process.env.PORT || 3300

// Initialize API keys on start
const keysData = initKeysFile()

// [SEC] trust proxy EKSPLISIT. `true` = percaya seluruh XFF = bisa di-spoof.
// Vercel meng-overwrite XFF sendiri (verified: spoof tercatat sbg IP asli) -> aman.
// Self-hosted: atur TRUST_PROXY ke jumlah hop reverse-proxy kamu (mis. 1).
if (!process.env.VERCEL) {
  const tp = process.env.TRUST_PROXY
  if (tp === undefined || tp === '' || tp === 'false' || tp === '0') {
    app.set('trust proxy', false)
  } else if (tp === 'true') {
    console.error('[SEC] TRUST_PROXY=true ditolak (XFF bisa di-spoof). Pakai jumlah hop, mis. TRUST_PROXY=1')
    app.set('trust proxy', 1)
  } else if (/^\d+$/.test(tp)) {
    app.set('trust proxy', parseInt(tp, 10))
  } else {
    app.set('trust proxy', tp.split(',').map(s => s.trim()).filter(Boolean))
  }
}

// [SEC] header keamanan di SEMUA response (termasuk error)
app.use(securityHeaders)

// [SEC-3] CORS whitelist (sebelumnya wildcard `*`)
app.use(corsMiddleware())

// [SEC] body limit keras + tolak JSON rusak (413/400, bukan 500)
app.use(express.json({ limit: '100kb' }))
app.use(express.urlencoded({ extended: true, limit: '100kb' }))

// [SEC] error handler body-parser: 413 buat kelewat besar, 400 buat malformed
app.use((err, req, res, next) => {
  if (!err) return next()
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ success: false, error: 'PAYLOAD_TOO_LARGE', message: 'Body terlalu besar (maks 100kb).' })
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ success: false, error: 'BAD_JSON', message: 'Format JSON tidak valid.' })
  }
  return next(err)
})

// Automatic Request Logger
app.use((req, res, next) => {
  // Skip polling logs to avoid cluttering
  if (!req.path.startsWith('/api') || req.path.includes('/api/keys/logs') || req.path.includes('/api/keys/stats-detailed')) {
    return next()
  }

  const start = Date.now()
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1'

  res.on('finish', () => {
    const duration = Date.now() - start
    let details = ''
    if (req.body && typeof req.body === 'object') {
      if (req.body.email) details = maskText(`Email: ${req.body.email}`)
      else if (req.body.name) details = `Key Name: ${req.body.name}`
    }

    addLog({
      ip,
      method: req.method,
      // [FIX R11b] scrub kredensial dari path yang dicatat (jangan simpan token/key)
      path: scrubSecrets(req.originalUrl || req.url),
      status: res.statusCode,
      duration_ms: duration,
      api_key_name: req.apiKey?.name || 'Client',
      details
    })
  })

  next()
})

// [SEC-2] Rate limit per endpoint. Semua endpoint punya efek (outbound atau auth).
// [FIX R2] SEBELUMNYA cuma send-link + login; verify-link/reactivate/provision
//         juga punya efek outbound (axios ke Firebase) -> sekarang dibatasi juga.
const LIMITS = [
  ['/api/send-link',      'send-link',      5,   60_000],  // kirim email
  ['/api/verify-link',    'verify-link',    10,  60_000],  // verifikasi magic link
  ['/api/reactivate',     'reactivate',     10,  60_000],  // aktivasi premium
  ['/api/provision',      'provision',      10,  60_000],  // aktivasi premium (alias)
  ['/api/verify',         'verify',         10,  60_000],  // verifikasi (alias)
  ['/api/keys/login',     'admin-login',    8,   300_000], // anti brute-force
  ['/api/websession',     'websession',     20,  60_000],  // terbit token sesi web
]
// [FIX R11b] bersihkan kredensial dari string apa pun sebelum dicatat.
function scrubSecrets(s) {
  if (!s) return s
  return String(s)
    .replace(/([?&](?:key|api_key|token|password|secret|admin_password)=)[^&#]*/gi, '$1[REDACTED]')
    .replace(/am-sk-[A-Za-z0-9]+/g, 'am-sk-[REDACTED]')
    .replace(/\b\d{13}\.[0-9]+\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, '[TOKEN-REDACTED]')
    // [FIX R19] PII: email di query/path (mis. ?email=... pada GET) jangan disimpan mentah
    .replace(/([?&](?:email|mail|e|to)=)([^&#]*)/gi, '$1[EMAIL-REDACTED]')
}

// [FIX R6/R20] normalisasi path bersama (lihat lib/urlpath.js)
const { normalizePath } = require('./lib/urlpath')

// [FIX R3] batas GLOBAL lintas-IP per endpoint (circuit breaker).
// Limiter per-IP saja bisa dilewati dengan rotasi IP; dan di serverless tiap
// instance punya Map sendiri. Batas global membatasi TOTAL outbound request
// sehingga kuota Firebase/layanan hulu tetap aman walau IP dirotasi.
// Angka dipilih longgar (>=25x pemakaian normal) supaya tidak mengganggu user asli.
const GLOBAL_LIMITS = {
  'send-link':     { limit: 300,  win: 60_000 },   // kirim email
  'verify-link':   { limit: 500,  win: 60_000 },   // verifikasi magic link
  'reactivate':    { limit: 500,  win: 60_000 },
  'provision':     { limit: 500,  win: 60_000 },
  'verify':        { limit: 500,  win: 60_000 },
  'admin-login':   { limit: 120,  win: 300_000 },  // anti brute-force lintas IP
  'websession':    { limit: 1000, win: 60_000 },   // terbit token sesi
}

for (const [path, name, limit, win] of LIMITS) {
  app.use((req, res, next) => {
    // hanya pasang kalau path (setelah normalisasi) cocok
    if (normalizePath(req.path) !== normalizePath(path)) return next()

    // 1) batas per-IP
    const r = rl.hit(`ip:${clientIp(req)}:${name}`, limit, win)
    res.setHeader('X-RateLimit-Limit', String(limit))
    res.setHeader('X-RateLimit-Remaining', String(r.remaining))
    if (!r.ok) {
      res.setHeader('Retry-After', String(r.retryAfterSec))
      return res.status(429).json({ success: false, error: 'RATE_LIMITED', message: `Terlalu banyak permintaan. Coba lagi dalam ${r.retryAfterSec} detik.` })
    }

    // 2) [FIX R3] batas GLOBAL lintas-IP (tahan rotasi IP)
    const G = GLOBAL_LIMITS[name]
    if (G) {
      const g = rl.hitGlobal(`global:${name}`, G.limit, G.win)
      if (!g.ok) {
        res.setHeader('Retry-After', String(g.retryAfterSec))
        return res.status(429).json({ success: false, error: 'RATE_LIMITED', message: `Layanan sedang padat. Coba lagi dalam ${g.retryAfterSec} detik.` })
      }
    }
    next()
  })
}

// [FIX R9] response admin jangan pernah di-cache (CDN/browser/proxy)
app.use('/api/keys', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.setHeader('Pragma', 'no-cache')
  next()
})

app.use('/api', apiRoutes)

// Local dev: express.static + listen sendiri.
// Vercel: routing static & serverless ditangani Vercel build (routes di vercel.json)
if (!process.env.VERCEL) {
  // Blokir akses langsung ke file admin & docs mentah (letakkan SEBELUM express.static)
  app.get('/admin.html', (req, res) => res.status(404).send('Not Found'))
  app.get('/API_DOCS.md', (req, res) => res.status(404).send('Not Found'))

  app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate')
      }
    },
    index: 'index.html'
  }))

  // Admin panel TERSEMBUNYI: gak ada link dari mana pun, cuma bisa dibuka
  // lewat path rahasia /panel-x8k2
  app.get('/panel-x8k2', (req, res) => {
    noindex(res)
    res.sendFile(path.join(__dirname, 'public', 'admin.html'))
  })

  app.get('/docs', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'docs.html'))
  })

  // Fallback for root
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  })

  // catch-all 404 (parity dgn mode Vercel)
  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' })
    }
    res.status(404).type('text/plain').send('404 — Not Found')
  })

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[am-reverse] Server aktif di port ${PORT}`)
    // [FIX R18] JANGAN cetak master key mentah ke log. Di Vercel log disimpan &
    // bisa dibaca dari dashboard (juga bisa mengalir ke log drain pihak ketiga).
    const _mk = String(keysData.master_key || '')
    console.log(`[am-reverse] Master API Key: ${_mk ? _mk.slice(0, 7) + '\u2022'.repeat(6) + _mk.slice(-4) : '(kosong)'}`)
  })
} else {
  // ============ VERCEL SERVERLESS MODE ============
  const publicDir = path.join(__dirname, 'public')

  // Blokir akses langsung ke file admin & docs mentah
  app.get('/admin.html', (req, res) => res.status(404).send('Not Found'))
  app.get('/API_DOCS.md', (req, res) => res.status(404).send('Not Found'))

  // Static assets (css/js jika ada) — html disajikan manual
  app.use(express.static(publicDir, { index: false }))

  app.get('/panel-x8k2', (req, res) => {
    noindex(res)
    res.sendFile(path.join(publicDir, 'admin.html'))
  })

  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })

  app.get('/docs', (req, res) => {
    res.sendFile(path.join(publicDir, 'docs.html'))
  })

  // catch-all -> 404 (SEBELUMNYA balas index.html ke semua path:
  // menyamarkan file sensitif & bikin monitoring 404 mustahil)
  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' })
    }
    res.status(404).type('text/plain').send('404 — Not Found')
  })

  module.exports = app
}
