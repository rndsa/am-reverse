/**
 * Storage adapter: Cloudflare KV (binding AM_DATA) with in-memory fallback.
 * All app data lives under discrete keys so it works on Workers (no fs).
 */
const mem = new Map();
let KV = null;
export function bindKV(kv) { KV = kv || null; }

export async function kvGet(key, fallback) {
  try {
    if (KV) {
      const v = await KV.get(key, 'text');
      if (v !== null && v !== undefined) {
        try { return JSON.parse(v); } catch (e) { return fallback; }
      }
      return fallback;
    }
    return mem.has(key) ? JSON.parse(JSON.stringify(mem.get(key))) : fallback;
  } catch (e) { return fallback; }
}

export async function kvPut(key, val) {
  try {
    if (KV) { await KV.put(key, JSON.stringify(val)); return true; }
    mem.set(key, JSON.parse(JSON.stringify(val)));
    return true;
  } catch (e) { return false; }
}

export const KEYS_FILE = 'apikeys';
export const LOGS_FILE = 'logs';
export const SESSIONS_FILE = 'sessions';
export const SETTINGS_FILE = 'settings';
export const STATS_FILE = 'stats';
