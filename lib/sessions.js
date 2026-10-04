const fs = require('fs')
const path = require('path')

// Vercel serverless: /tmp ephemeral. Sessions persisten via Edge Config.
const DATA_DIR = process.env.VERCEL ? '/tmp/am-data' : path.join(__dirname, '..', 'data')
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json')
const MAX_SESSIONS = 100

const EC_ID = process.env.EDGE_CONFIG_ID || ''
const EC_TEAM = process.env.VERCEL_TEAM_ID || ''
const EC_TOKEN = process.env.VERCEL_API_TOKEN || ''

async function ecReadSessions() {
  if (!EC_ID || !EC_TOKEN) return null
  try {
    const url = `https://api.vercel.com/v1/edge-config/${EC_ID}/item/sessions_live${EC_TEAM ? `?teamId=${EC_TEAM}` : ''}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${EC_TOKEN}` } })
    if (!r.ok) return null
    const d = await r.json()
    const v = Array.isArray(d) ? d[0] : (d.value || null)
    return Array.isArray(v) ? v : null
  } catch { return null }
}

async function ecWriteSessions(list) {
  if (!EC_ID || !EC_TOKEN) return
  try {
    const url = `https://api.vercel.com/v1/edge-config/${EC_ID}/items${EC_TEAM ? `?teamId=${EC_TEAM}` : ''}`
    await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${EC_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ operation: 'upsert', key: 'sessions_live', value: list }] })
    })
  } catch (e) { console.error('[sessions] EC write error:', e.message) }
}

function readFile() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const list = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'))
      if (Array.isArray(list)) return list
    }
  } catch {}
  return null
}

function writeFile(list) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(list, null, 2))
  } catch {}
}

// getSessions async: file → EC → EC sessions_seed (test history) → env seed → kosong
async function getSessions() {
  let list = readFile()
  if (list && list.length) return list

  const ec = await ecReadSessions()
  if (ec && ec.length) {
    writeFile(ec)
    return ec
  }

  // seed awal: EC sessions_seed (riwayat test dgn waktu)
  if (EC_ID && EC_TOKEN) {
    try {
      const url = `https://api.vercel.com/v1/edge-config/${EC_ID}/item/sessions_seed${EC_TEAM ? `?teamId=${EC_TEAM}` : ''}`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${EC_TOKEN}` } })
      if (r.ok) {
        const d = await r.json()
        const v = Array.isArray(d) ? d[0] : (d.value || null)
        if (Array.isArray(v) && v.length) {
          writeFile(v)
          return v
        }
      }
    } catch {}
  }

  const raw = process.env.API_SESSIONS_SEED
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) {
        writeFile(parsed)
        return parsed
      }
    } catch {}
  }

  writeFile([])
  return []
}

// getSessionsSync (untuk route sync lama): file saja
function getSessionsSync() {
  return readFile() || []
}

async function saveSession(session) {
  let list = readFile()
  if (!list) list = await getSessions()  // bootstrap dari EC
  const entry = {
    ...session,
    saved_at: session.saved_at || new Date().toISOString()
  }
  list.unshift(entry)
  list = list.slice(0, MAX_SESSIONS)
  writeFile(list)
  await ecWriteSessions(list)
}

module.exports = { getSessions, getSessionsSync, saveSession }
