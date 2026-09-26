const express = require('express')
const path = require('path')
const apiRoutes = require('./app/api/route')
const { initKeysFile } = require('./lib/keys')
const { addLog } = require('./lib/logger')

const app = express()
const PORT = process.env.PORT || 3300

// Initialize API keys on start
const keysData = initKeysFile()

// Vercel handles this itself
if (!process.env.VERCEL) {
  app.set('trust proxy', true)
}

app.use(require('cors')())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

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
      if (req.body.email) details = `Email: ${req.body.email}`
      else if (req.body.name) details = `Key Name: ${req.body.name}`
    }

    addLog({
      ip,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: duration,
      api_key_name: req.apiKey?.name || 'Client',
      details
    })
  })

  next()
})

app.use('/api', apiRoutes)

// Local dev: express.static + listen sendiri.
// Vercel: routing static & serverless ditangani Vercel build (routes di vercel.json)
if (!process.env.VERCEL) {
  // Blokir akses langsung ke file admin via static (letakkan SEBELUM express.static)
  app.get('/admin.html', (req, res) => res.status(404).send('Not Found'))

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
    res.sendFile(path.join(__dirname, 'public', 'admin.html'))
  })

  // Fallback for root
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
  })

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[am-reverse] Server aktif di port ${PORT}`)
    console.log(`[am-reverse] Master API Key: ${keysData.master_key}`)
  })
} else {
  // ============ VERCEL SERVERLESS MODE ============
  const publicDir = path.join(__dirname, 'public')

  // Blokir akses langsung ke file admin
  app.get('/admin.html', (req, res) => res.status(404).send('Not Found'))

  // Static assets (css/js jika ada) — html disajikan manual
  app.use(express.static(publicDir, { index: false }))

  app.get('/panel-x8k2', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'))
  })

  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })

  // catch-all -> index (biar gak 404 di subpath)
  app.use((req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })

  module.exports = app
}
