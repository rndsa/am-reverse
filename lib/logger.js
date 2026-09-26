const fs = require('fs')
const path = require('path')

// Vercel serverless: filesystem read-only kecuali /tmp
const DATA_DIR = process.env.VERCEL
  ? '/tmp/am-data'
  : path.join(__dirname, '..', 'data')
const LOGS_FILE = path.join(DATA_DIR, 'logs.json')
const MAX_LOGS = 300

let memoryLogs = []

function initLogger() {
  const dir = path.dirname(LOGS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  if (fs.existsSync(LOGS_FILE)) {
    try {
      memoryLogs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'))
      if (!Array.isArray(memoryLogs)) memoryLogs = []
    } catch {
      memoryLogs = []
    }
  }
}

function saveLogs() {
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(memoryLogs.slice(0, MAX_LOGS), null, 2))
  } catch (e) {
    console.error('Failed to save logs:', e.message)
  }
}

function addLog(entry) {
  const logItem = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    timestamp: new Date().toISOString(),
    ip: entry.ip || '127.0.0.1',
    method: entry.method || 'GET',
    path: entry.path || '/',
    status: entry.status || 200,
    duration_ms: entry.duration_ms || 0,
    api_key_name: entry.api_key_name || 'Public/None',
    details: entry.details || '',
    error: entry.error || null
  }

  memoryLogs.unshift(logItem)
  if (memoryLogs.length > MAX_LOGS) {
    memoryLogs = memoryLogs.slice(0, MAX_LOGS)
  }

  // Debounce/write save
  saveLogs()
  return logItem
}

function getLogs(limit = 100, query = '') {
  let list = memoryLogs
  if (query) {
    const q = query.toLowerCase()
    list = list.filter(l => 
      l.path.toLowerCase().includes(q) ||
      l.method.toLowerCase().includes(q) ||
      (l.ip && l.ip.includes(q)) ||
      (l.details && l.details.toLowerCase().includes(q)) ||
      (l.api_key_name && l.api_key_name.toLowerCase().includes(q))
    )
  }
  return list.slice(0, limit)
}

function clearLogs() {
  memoryLogs = []
  saveLogs()
  return true
}

initLogger()

module.exports = {
  addLog,
  getLogs,
  clearLogs
}
