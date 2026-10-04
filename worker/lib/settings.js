import { kvGet, kvPut, SETTINGS_FILE } from './store.js';

function defaults(env) {
  return {
    admin_password: (env && env.ADMIN_PASSWORD) || '',
    require_api_key: true,
    service_active: true,
    rate_limit_rpm: 60,
    maintenance_message: 'Layanan sedang dalam pemeliharaan sistem.',
    session_epoch: 0
    // [FIX R14] allow_registration/auto_save_sessions dihapus: tidak ada implementasinya
  };
}

export async function getSettings(env) {
  const D = defaults(env);
  const data = await kvGet(SETTINGS_FILE, null);
  if (!data) { await kvPut(SETTINGS_FILE, D); return Object.assign({}, D); }
  if (!data.admin_password) data.admin_password = D.admin_password;
  return Object.assign({}, D, data);
}

export async function updateSettings(updates, env) {
  const D = defaults(env);
  const cur = await getSettings(env);
  const next = Object.assign({}, cur);
  Object.keys(D).forEach(k => { if (updates[k] !== undefined) next[k] = updates[k]; });
  // [FIX R1 parity] ganti password ATAU minta revoke -> naikkan epoch (matikan token lama)
  const pwChanged = updates.admin_password !== undefined && updates.admin_password !== cur.admin_password;
  if (pwChanged || updates.revoke_sessions === true) {
    next.session_epoch = (cur.session_epoch || 0) + 1;
  }
  delete next.revoke_sessions;
  await kvPut(SETTINGS_FILE, next);
  return next;
}
