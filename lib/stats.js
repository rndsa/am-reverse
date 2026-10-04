// Stats persisten via Vercel Edge Config — /tmp hilang tiap cold start, EC gak.
const fs = require('fs');
const path = require('path');

const dataDir = process.env.VERCEL ? '/tmp/am-data' : path.join(__dirname, '..', 'data');
const statsFile = path.join(dataDir, 'stats.json');

const EC_ID = process.env.EDGE_CONFIG_ID || '';
const EC_TEAM = process.env.VERCEL_TEAM_ID || '';
const EC_TOKEN = process.env.VERCEL_API_TOKEN || '';

const BASE_TOTAL = parseInt(process.env.STATS_TOTAL_BASE || '295', 10);
const BASE_TODAY = parseInt(process.env.STATS_TODAY_BASE || '0', 10);

if (!fs.existsSync(dataDir)) {
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
}

function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

// ---- Edge Config helpers ----
async function ecReadStats() {
  if (!EC_ID || !EC_TOKEN) return null;
  try {
    const url = `https://api.vercel.com/v1/edge-config/${EC_ID}/item/stats${EC_TEAM ? `?teamId=${EC_TEAM}` : ''}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${EC_TOKEN}` } });
    if (!r.ok) return null;
    const d = await r.json();
    const v = Array.isArray(d) ? d[0] : (d.value || null);
    return v && typeof v === 'object' && v.totalPremium != null ? v : null;
  } catch { return null; }
}

async function ecWriteStats(statsObj) {
  if (!EC_ID || !EC_TOKEN) return;
  try {
    const url = `https://api.vercel.com/v1/edge-config/${EC_ID}/items${EC_TEAM ? `?teamId=${EC_TEAM}` : ''}`;
    await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${EC_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ operation: 'upsert', key: 'stats', value: statsObj }] })
    });
  } catch (e) { console.error('[stats] EC write error:', e.message); }
}

// ---- File cache (untuk sync read) ----
function loadFile() {
  try {
    if (fs.existsSync(statsFile)) return JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  } catch {}
  return null;
}

function saveFile(statsObj) {
  try { fs.writeFileSync(statsFile, JSON.stringify(statsObj, null, 2), 'utf8'); } catch {}
}

// Sync read: file cache → kalau gak ada, seed baseline (tanpa menunggu EC — dipakai
// increment yang nanti akan tulis balik file + EC)
function currentStats() {
  const today = getTodayDateString();
  let s = loadFile();
  if (!s) {
    s = { totalPremium: BASE_TOTAL, todayPremium: BASE_TODAY, lastDate: today };
  }
  if (s.lastDate !== today) {
    s.todayPremium = 0;
    s.lastDate = today;
    saveFile(s);
  }
  return s;
}

// Async refresh dari EC → tulis file cache. Dipanggil sebelum GET (biar tampilan konsisten).
async function refreshFromEC() {
  const ec = await ecReadStats();
  const file = loadFile();
  if (ec) {
    // pakai yang LEBIH BESAR antara EC dan file (EC kadang telat; file bisa lebih baru)
    const today = getTodayDateString();
    const merged = {
      totalPremium: Math.max(ec.totalPremium || 0, file?.totalPremium || 0),
      todayPremium: (ec.lastDate === today ? (ec.todayPremium || 0) : 0) ,
      lastDate: today
    };
    // hari ini: gabung — kalau file lastDate hari ini, ambil max
    if (file && file.lastDate === today) {
      merged.todayPremium = Math.max(merged.todayPremium, file.todayPremium || 0);
    }
    saveFile(merged);
    return merged;
  }
  return currentStats();
}

function saveStats(statsObj) {
  saveFile(statsObj);
  ecWriteStats(statsObj);
}

function getStats() {
  const current = currentStats();
  return {
    total: current.totalPremium || 0,
    today: current.todayPremium || 0
  };
}

function getStatsAsync() {
  return refreshFromEC().then(current => ({
    total: current.totalPremium || 0,
    today: current.todayPremium || 0
  }));
}

async function incrementStats() {
  // WAJIB refresh dari Edge Config dulu — file cache bisa stale (cold start = baseline)
  let current = await refreshFromEC();
  current.totalPremium = (current.totalPremium || 0) + 1;
  current.todayPremium = (current.todayPremium || 0) + 1;
  current.lastDate = getTodayDateString();
  saveFile(current);
  await ecWriteStats(current);
  return {
    total: current.totalPremium,
    today: current.todayPremium
  };
}

module.exports = { getStats, getStatsAsync, incrementStats };
