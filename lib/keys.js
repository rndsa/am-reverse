const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Vercel serverless: filesystem read-only kecuali /tmp
const DATA_DIR = process.env.VERCEL
  ? '/tmp/am-data'
  : path.join(__dirname, '..', 'data')
const KEYS_FILE = path.join(DATA_DIR, 'apikeys.json')

function initKeysFile() {
  const dir = path.dirname(KEYS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  
  if (!fs.existsSync(KEYS_FILE)) {
    const defaultKey = 'am-sk-' + crypto.randomBytes(16).toString('hex')
    const initialData = {
      master_key: defaultKey,
      keys: [
        {
          key: defaultKey,
          name: 'Default Master Key',
          created_at: new Date().toISOString(),
          last_used_at: null,
          total_requests: 0,
          is_active: true
        }
      ]
    }
    fs.writeFileSync(KEYS_FILE, JSON.stringify(initialData, null, 2))
    return initialData
  }

  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'))
  } catch {
    return { master_key: '', keys: [] }
  }
}

function getKeysData() {
  return initKeysFile()
}

function saveKeysData(data) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2))
}

function validateKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null
  const k = rawKey.trim()
  const data = getKeysData()
  
  // Check env MASTER_API_KEY
  const envMaster = process.env.MASTER_API_KEY
  if (envMaster && k === envMaster.trim()) {
    return { key: envMaster, name: 'Env Master Key', is_active: true, is_master: true }
  }

  const found = data.keys.find(item => item.key === k && item.is_active)
  if (found) {
    found.total_requests = (found.total_requests || 0) + 1
    found.last_used_at = new Date().toISOString()
    saveKeysData(data)
    return found
  }
  return null
}

function createKey(name = 'Client Key', prefix = 'am-sk') {
  const data = getKeysData()
  const cleanPrefix = (prefix || 'am-sk').trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'am-sk'
  const newKey = `${cleanPrefix}-${crypto.randomBytes(16).toString('hex')}`
  const entry = {
    key: newKey,
    name: (name || 'Client Key').trim(),
    created_at: new Date().toISOString(),
    last_used_at: null,
    total_requests: 0,
    is_active: true
  }
  data.keys.push(entry)
  saveKeysData(data)
  return entry
}

function listKeys() {
  const data = getKeysData()
  return data.keys.map(k => ({
    name: k.name,
    key_masked: k.key.slice(0, 8) + '••••••••' + k.key.slice(-4),
    key: k.key,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    total_requests: k.total_requests || 0,
    is_active: k.is_active
  }))
}

function toggleKeyStatus(keyToToggle) {
  const data = getKeysData()
  const idx = data.keys.findIndex(k => k.key === keyToToggle)
  if (idx !== -1) {
    data.keys[idx].is_active = !data.keys[idx].is_active
    saveKeysData(data)
    return data.keys[idx]
  }
  return null
}

function revokeKey(keyToRevoke) {
  const data = getKeysData()
  const idx = data.keys.findIndex(k => k.key === keyToRevoke)
  if (idx !== -1) {
    data.keys.splice(idx, 1)
    saveKeysData(data)
    return true
  }
  return false
}

module.exports = {
  initKeysFile,
  getKeysData,
  validateKey,
  createKey,
  listKeys,
  toggleKeyStatus,
  revokeKey
}
