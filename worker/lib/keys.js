import { kvGet, kvPut, KEYS_FILE } from './store.js';
import { hex } from './auth.js';

async function initKeysFile() {
  let data = await kvGet(KEYS_FILE, null);
  if (!data) {
    const defaultKey = 'am-sk-' + hex(16);
    data = {
      master_key: defaultKey,
      keys: [{
        key: defaultKey,
        name: 'Default Master Key',
        created_at: new Date().toISOString(),
        last_used_at: null,
        total_requests: 0,
        is_active: true
      }]
    };
    await kvPut(KEYS_FILE, data);
  }
  return data;
}

export async function getKeysData() { return initKeysFile(); }
export async function saveKeysData(data) { return kvPut(KEYS_FILE, data); }

export async function validateKey(rawKey, env) {
  if (!rawKey || typeof rawKey !== 'string') return null;
  const k = rawKey.trim();
  const data = await initKeysFile();

  const envMaster = env && env.MASTER_API_KEY;
  if (envMaster && k === envMaster.trim()) {
    return { key: envMaster, name: 'Env Master Key', is_active: true, is_master: true };
  }
  const found = (data.keys || []).find(it => it.key === k && it.is_active);
  if (found) {
    found.total_requests = (found.total_requests || 0) + 1;
    found.last_used_at = new Date().toISOString();
    await saveKeysData(data);
    return found;
  }
  return null;
}

// [FIX R12] Edge Config (Hobby) = 8KB total -> batasi jumlah key & panjang name.
export const MAX_KEYS = 50;

export async function createKey(name, prefix) {
  const data = await initKeysFile();
  const clean = ((prefix || 'am-sk') + '').trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'am-sk';
  const newKey = clean + '-' + hex(16);
  if ((data.keys || []).length >= MAX_KEYS) {
    const err = new Error(`Batas maksimum ${MAX_KEYS} API key tercapai.`);
    err.code = 'MAX_KEYS';
    throw err;
  }
  const entry = {
    key: newKey,
    // [FIX R12] batasi 64 char + buang control char (cegah log/UI injection)
    name: ((name || 'Client Key') + '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 64) || 'Client Key',
    created_at: new Date().toISOString(),
    last_used_at: null,
    total_requests: 0,
    is_active: true
  };
  data.keys.push(entry);
  await saveKeysData(data);
  return entry;
}

export async function listKeys() {
  const data = await initKeysFile();
  return (data.keys || []).map(k => ({
    name: k.name,
    key_masked: k.key.slice(0, 8) + '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + k.key.slice(-4),
    key: k.key,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    total_requests: k.total_requests || 0,
    is_active: k.is_active
  }));
}

export async function toggleKeyStatus(keyToToggle) {
  const data = await initKeysFile();
  const it = (data.keys || []).find(k => k.key === keyToToggle);
  if (!it) return null;
  it.is_active = !it.is_active;
  await saveKeysData(data);
  return it;
}

export async function revokeKey(keyToRevoke) {
  const data = await initKeysFile();
  const before = (data.keys || []).length;
  data.keys = (data.keys || []).filter(k => k.key !== keyToRevoke);
  await saveKeysData(data);
  return data.keys.length < before;
}
