const fs = require('fs')
const path = require('path')

// Vercel serverless: filesystem read-only kecuali /tmp
const DATA_DIR = process.env.VERCEL
  ? '/tmp/am-data'
  : path.join(__dirname, '..', 'data')
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json')

function getSessions() {
  const dir = path.dirname(SESSIONS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  if (!fs.existsSync(SESSIONS_FILE)) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify([], null, 2))
    return []
  }
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'))
  } catch {
    return []
  }
}

function saveSession(session) {
  const list = getSessions()
  list.unshift({
    ...session,
    saved_at: new Date().toISOString()
  })
  // Keep last 100 sessions
  const trimmed = list.slice(0, 100)
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(trimmed, null, 2))
}

module.exports = {
  getSessions,
  saveSession
}
