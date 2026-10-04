const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Vercel serverless: filesystem read-only kecuali /tmp (EPHEMERAL!)
// Source of truth keys = Vercel Edge Config (shared antar instance & cold start).
// File /tmp hanya cache agar read cepat; setiap perubahan di-push ke Edge Config.
const DATA_DIR = process.env.VERCEL
  ? '/tmp/am-data'
  : path.join(__dirname, '..', 'data')
const KEYS_FILE = path.join(DATA_DIR, 'apikeys.json')

const EC_ID = process.env.EDGE_CONFIG_ID || ''
const EC_TEAM = process.env.VERCEL_TEAM_ID || ''
const EC_TOKEN = process.env.VERCEL_API_TOKEN || ''

// SAFE WRITE: baca EC TERBARU dulu (bukan cache file), merge by key value, baru tulis.
// Mencegah instance serverless stale menimpa data instance lain (race condition).
// [FIX R17] kunci ADMIN terpisah dari master_key (kunci API).
// Tujuan: kebocoran kunci API tidak otomatis memberi akses admin penuh.
// Sumber: env ADMIN_KEY, atau data tersimpan, atau item Edge Config `admin_key`.
function currentAdminKey() {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY
  try {
    const c = getKeysDataSync()
    if (c && c.admin_key) return c.admin_key
  } catch {}
  return null
}

async function ecWrite(keys, masterKey) {
  if (!EC_ID || !EC_TOKEN) return
  try {
    let merged = Array.isArray(keys) ? [...keys] : []
    try {
      const cur = await ecRead()
      if (cur && cur.length) {
        const localSet = new Set(keys.map(k => k.key))
        // keys yang ada di EC tapi GAK ada di local → pertahankan (kecuali sengaja dihapus —
        // revokeKey kirim flag lewat localList full-merge, di bawah)
        for (const k of cur) {
          if (!localSet.has(k.key) && !keys.__deleted?.includes(k.key)) merged.push(k)
        }
      }
    } catch {}
    const url = `https://api.vercel.com/v1/edge-config/${EC_ID}/items${EC_TEAM ? `?teamId=${EC_TEAM}` : ''}`
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${EC_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: (() => {
        const items = [
          { operation: 'upsert', key: 'keys', value: merged },
          { operation: 'upsert', key: 'master_key', value: masterKey }
        ]
        // [FIX R17] ikutkan admin_key kalau ada (pemisahan hak admin vs API)
        const ak = currentAdminKey()
        if (ak) items.push({ operation: 'upsert', key: 'admin_key', value: ak })
        return items
      })() })
    })
    if (!r.ok) console.error('[keys] edge-config write failed:', r.status)
  } catch (e) {
    console.error('[keys] edge-config write error:', e.message)
  }
}

// [FIX R17] baca satu item Edge Config (dipakai untuk admin_key)
async function ecReadItem(name) {
  if (!EC_ID) return null
  try {
    const url = `https://api.vercel.com/v1/edge-config/${EC_ID}/item/${name}${EC_TEAM ? `?teamId=${EC_TEAM}` : ''}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${EC_TOKEN}` } })
    if (!r.ok) return null
    const data = await r.json()
    const v = (data && typeof data === 'object' && 'value' in data) ? data.value : data
    return typeof v === 'string' && v ? v : null
  } catch { return null }
}

async function ecRead() {
  if (!EC_ID) return null
  try {
    const url = `https://api.vercel.com/v1/edge-config/${EC_ID}/item/keys${EC_TEAM ? `?teamId=${EC_TEAM}` : ''}`
    const r = await fetch(url, { headers: { Authorization: `Bearer ${EC_TOKEN}` } })
    if (!r.ok) return null
    const data = await r.json()
    // response bentuk { value: [...] } atau array langsung
    const arr = Array.isArray(data) ? data : (data.value || null)
    if (Array.isArray(arr) && arr.length) return arr
    return null
  } catch {
    return null
  }
}

async function initKeysFile() {
  const dir = path.dirname(KEYS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  if (!fs.existsSync(KEYS_FILE)) {
    const envMaster = process.env.MASTER_API_KEY
    const defaultKey = envMaster || 'am-sk-' + crypto.randomBytes(16).toString('hex')
    let seedKeys = []
    const seedRaw = process.env.API_KEYS_SEED
    if (seedRaw) {
      try {
        const parsed = JSON.parse(seedRaw)
        if (Array.isArray(parsed)) {
          seedKeys = parsed.map(item => ({
            key: String(item.key || '').trim(),
            name: String(item.name || 'Client'),
            created_at: item.created_at || new Date().toISOString(),
            last_used_at: null,
            total_requests: 0,
            is_active: item.is_active !== false
          })).filter(item => item.key)
        }
      } catch {}
    }
    const keys = [{ key: defaultKey, name: 'Default Master Key', created_at: new Date().toISOString(), last_used_at: null, total_requests: 0, is_active: true }]
    for (const sk of seedKeys) if (!keys.find(x => x.key === sk.key)) keys.push(sk)
    const initialData = { master_key: defaultKey, keys }
    fs.writeFileSync(KEYS_FILE, JSON.stringify(initialData, null, 2))
    return initialData
  }

  try {
    const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'))
    if (Array.isArray(data.keys) && data.keys.length === 0 && process.env.API_KEYS_SEED) {
      try {
        const parsed = JSON.parse(process.env.API_KEYS_SEED)
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const key = String(item.key || '').trim()
            if (key && !data.keys.find(x => x.key === key)) {
              data.keys.push({ key, name: String(item.name || 'Client'), created_at: item.created_at || new Date().toISOString(), last_used_at: null, total_requests: 0, is_active: item.is_active !== false })
            }
          }
          if (data.keys.length) fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2))
        }
      } catch {}
    }
    return data
  } catch {
    return { master_key: process.env.MASTER_API_KEY || '', keys: [] }
  }
}

// read dengan fallback Edge Config — dipakai validateKey & list
async function getKeysData() {
  // 1. coba Edge Config (source of truth di Vercel) — hasilnya ditulis ke file cache
  const ec = await ecRead()
  if (ec) {
    const cached = getKeysDataSync()
    const masterKey = cached.master_key || process.env.MASTER_API_KEY || ''
    // [FIX R17] ambil admin_key dari EC juga (kalau ada)
    const adminKey = cached.admin_key || await ecReadItem('admin_key') || process.env.ADMIN_KEY || null
    const merged = { master_key: masterKey, keys: ec }
    if (adminKey) merged.admin_key = adminKey
    saveKeysData(merged)
    return merged
  }
  // 2. fallback: file cache / env seed
  return getKeysDataSync()
}

function getKeysDataSync() {
  // versi sync — baca file cache langsung; kalau belum ada, bikin dari env seed
  const dir = path.dirname(KEYS_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(KEYS_FILE)) {
    const envMaster = process.env.MASTER_API_KEY
    const defaultKey = envMaster || 'am-sk-' + crypto.randomBytes(16).toString('hex')
    let seedKeys = []
    const seedRaw = process.env.API_KEYS_SEED
    if (seedRaw) {
      try {
        const parsed = JSON.parse(seedRaw)
        if (Array.isArray(parsed)) {
          seedKeys = parsed.map(item => ({
            key: String(item.key || '').trim(),
            name: String(item.name || 'Client'),
            created_at: item.created_at || new Date().toISOString(),
            last_used_at: null,
            total_requests: 0,
            is_active: item.is_active !== false
          })).filter(item => item.key)
        }
      } catch {}
    }
    const keys = [{ key: defaultKey, name: 'Default Master Key', created_at: new Date().toISOString(), last_used_at: null, total_requests: 0, is_active: true }]
    for (const sk of seedKeys) if (!keys.find(x => x.key === sk.key)) keys.push(sk)
    const initialData = { master_key: defaultKey, keys }
    fs.writeFileSync(KEYS_FILE, JSON.stringify(initialData, null, 2))
    return initialData
  }
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'))
  } catch {
    return { master_key: process.env.MASTER_API_KEY || '', keys: [] }
  }
}

function saveKeysData(data) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2))
}

function validateKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null
  const k = rawKey.trim()
  const data = getKeysDataSync()

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

// versi async: kalau gak ketemu di cache, refresh dari Edge Config lalu cek lagi
async function validateKeyAsync(rawKey) {
  let found = validateKey(rawKey)
  if (found) return found
  // refresh cache dari EC (source of truth) lalu coba sekali lagi
  try {
    await getKeysData()
    found = validateKey(rawKey)
  } catch {}
  return found
}

// [FIX R12] Edge Config (Hobby) = 8KB total. ~130 byte/key -> 50 key = ~6.5KB (aman).
const MAX_KEYS = 50

async function createKey(name, keyId) {
  await getKeysData()          // refresh dari EC dulu — hindari race antar instance
  const data = getKeysDataSync()
  // keyId dari panel = custom prefix (mis. 'bansos') → key jadi 'bansos-<16hex>'.
  // Kalau kosong → default 'am-sk-<16hex>'. Prefix dibersihin: huruf/angka/-/_ saja, max 16.
  let pref = String(keyId || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16)
  if (pref.length < 2) pref = 'am-sk'
  const keyVal = pref + '-' + crypto.randomBytes(16).toString('hex')
  // [FIX R12] batasi jumlah key: Edge Config Hobby max 8KB. Tanpa cap, admin
  // (atau bug) bisa bikin state melebihi limit -> SEMUA write EC gagal (state mati).
  if (data.keys.length >= MAX_KEYS) {
    const err = new Error(`Batas maksimum ${MAX_KEYS} API key tercapai.`)
    err.code = 'MAX_KEYS'
    throw err
  }
  const newKey = {
    key: keyVal,
    // [FIX R12] name dibatasi 64 char; CRLF/control char dibuang (cegah log/UI injection)
    name: String(name || 'Unnamed').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 64) || 'Unnamed',
    created_at: new Date().toISOString(),
    last_used_at: null,
    total_requests: 0,
    is_active: true
  }
  data.keys.push(newKey)
  saveKeysData(data)
  await ecWrite(data.keys, data.master_key)
  return newKey
}

async function listKeysAsync() {
  await getKeysData()          // EC-first refresh cache
  return listKeys()
}

function listKeys() {
  const data = getKeysDataSync()
  return data.keys.map(k => ({
    ...k,
    key_masked: k.key.slice(0, 9) + '••••••••' + k.key.slice(-4)
  }))
}

async function toggleKeyStatus(keyToToggle) {
  await getKeysData()
  const data = getKeysDataSync()
  const found = data.keys.find(k => k.key === keyToToggle)
  if (found) {
    found.is_active = !found.is_active
    saveKeysData(data)
    await ecWrite(data.keys, data.master_key)
    return found
  }
  return null
}

async function revokeKey(keyToRevoke) {
  await getKeysData()
  const data = getKeysDataSync()
  const idx = data.keys.findIndex(k => k.key === keyToRevoke)
  if (idx !== -1) {
    data.keys.splice(idx, 1)
    saveKeysData(data)
    // tandai yang dihapus supaya ecWrite (merge) gak nge-restore-nya dari EC
    data.keys.__deleted = [keyToRevoke]
    await ecWrite(data.keys, data.master_key)
    return true
  }
  return false
}

module.exports = {
  initKeysFile,
  getKeysData,
  getKeysDataSync,
  validateKey,
  validateKeyAsync,
  createKey,
  listKeys,
  listKeysAsync,
  toggleKeyStatus,
  revokeKey
}
