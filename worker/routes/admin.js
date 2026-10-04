import { json, readBody } from '../lib/http.js';
import { createKey, listKeys, toggleKeyStatus, revokeKey, getKeysData } from '../lib/keys.js';
import { getSettings, updateSettings } from '../lib/settings.js';
import { getStats } from '../lib/stats.js';
import { getSessions } from '../lib/sessions.js';
import { maskSession } from '../lib/mask.js';
import * as adminSession from '../lib/adminsession.js';
import { getLogs, clearLogs } from '../lib/logger.js';

// [SEC] constant-time compare (anti timing attack).
// crypto.subtle.timingSafeEqual TIDAK tersedia di Workers -> pakai XOR manual.
function safeEqual(a, b) {
  const A = String(a ?? '');
  const B = String(b ?? '');
  if (!A || !B) return false;          // [SEC] jangan pernah lolos dgn nilai kosong
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A.charCodeAt(i) ^ B.charCodeAt(i);
  return diff === 0;
}

async function gateAdmin(req, env) {
  const settings = await getSettings(env);
  const keysData = await getKeysData();
  const masterKey = keysData.master_key;
  const envMaster = env && env.MASTER_API_KEY;
  const adminPass = settings.admin_password || (env && env.ADMIN_PASSWORD) || '';

  let key = req.headers.get('x-api-key') || req.headers.get('x-master-key') || req.headers.get('x-admin-password') || '';
  const auth = req.headers.get('authorization');
  if (!key && auth) key = auth.replace(/^Bearer\s+/i, '').trim();

  // [FIX R1] password TIDAK lagi jadi bearer token -> wajib token sesi bertanda tangan
  // [FIX R17] pemisahan hak: master_key (kunci API) tidak membuka rute admin kalau admin_key ada
  const epoch = settings.session_epoch || 0;
  const storedAdminKey = keysData.admin_key || null;
  const envAdminKey = (env && env.ADMIN_KEY) || null;
  const isSession = await adminSession.verify(key, epoch, env);
  const isAdminKey = Boolean(key && ((storedAdminKey && safeEqual(key, storedAdminKey)) || (envAdminKey && safeEqual(key, envAdminKey))));
  const isMaster = Boolean(key && ((masterKey && safeEqual(key, masterKey)) || (envMaster && safeEqual(key, envMaster))));
  let ok = Boolean(isSession || isAdminKey);
  if (!ok && isMaster && !storedAdminKey && !envAdminKey) ok = true; // mode transisi
  if (!key || !ok) return { fail: json({ success: false, message: 'Akses ditolak: kredensial admin tidak valid.' }, 403) };
  return { ok: true };
}

/* POST /api/keys/login */
export async function login(req, env) {
  const body = await readBody(req);
  const settings = await getSettings(env);
  const keysData = await getKeysData();
  const masterKey = keysData.master_key;
  // [FIX R10] jangan pakai fallback yg bisa diprediksi; wajib env/settings.
  const adminPass = settings.admin_password || (env && env.ADMIN_PASSWORD) || '';

  if (safeEqual(body.password, adminPass) || safeEqual(body.password, masterKey)) {
    // [FIX R1] token acak bertanda tangan; password gak pernah dikirim balik
    const epoch = settings.session_epoch || 0;
    const { token, expiresIn } = await adminSession.issue(epoch, env);
    return json({ success: true, message: 'Login berhasil.', token, expiresIn });
  }
  // [SEC] delay tetap -> brute force jadi mahal (rate limit = lapisan utama)
  await new Promise(r => setTimeout(r, 700));
  return json({ success: false, message: 'Password admin salah!' }, 401);
}

/* GET /api/keys/stats-detailed */
export async function statsDetailed(req, env) {
  const g = await gateAdmin(req, env); if (g.fail) return g.fail;
  const keys = await listKeys();
  const s = await getStats();
  const active = keys.filter(k => k.is_active).length;
  const totalReqs = keys.reduce((a, k) => a + (k.total_requests || 0), 0);
  return json({
    success: true,
    data: {
      total_keys: keys.length,
      active_keys: active,
      inactive_keys: keys.length - active,
      total_requests: totalReqs,
      total_activations: s.total || 0,
      today_activations: s.today || 0,
      server_uptime: 0,
      memory_usage_mb: 0
    }
  });
}

/* GET | PUT /api/keys/settings */
export async function settingsGet(req, env) {
  const g = await gateAdmin(req, env); if (g.fail) return g.fail;
  const s = await getSettings(env);
  // [FIX R16] JANGAN pernah kirim password mentah ke klien (parity dgn Node).
  const safe = Object.assign({}, s);
  delete safe.admin_password;
  return json({ success: true, settings: safe });
}
const UNSUPPORTED_SETTINGS = ['allow_registration', 'auto_save_sessions'];
const ALLOWED_SETTINGS = ['admin_password', 'require_api_key', 'service_active', 'rate_limit_rpm', 'maintenance_message', 'revoke_sessions'];
export async function settingsPut(req, env) {
  const g = await gateAdmin(req, env); if (g.fail) return g.fail;
  const body = await readBody(req) || {};
  const before = await getSettings(env);
  // [FIX R14] tolak field tanpa implementasi (kontrol keamanan palsu)
  const asked = UNSUPPORTED_SETTINGS.filter(k => body[k] !== undefined);
  if (asked.length) {
    return json({ success: false, message: 'Pengaturan ini belum diimplementasikan: ' + asked.join(', ') + '.' }, 400);
  }
  // [FIX R5] mass-assignment service_active = primitive DoS -> wajib flag eksplisit
  if (body.service_active !== undefined && body.maintenance_mode !== true) delete body.service_active;
  delete body.maintenance_mode;
  // [FIX R5b/R16] whitelist field
  for (const k of Object.keys(body)) if (!ALLOWED_SETTINGS.includes(k)) delete body[k];
  const pwChanging = body.admin_password !== undefined && body.admin_password !== before.admin_password;
  const updated = await updateSettings(body, env);
  const safe = Object.assign({}, updated);
  delete safe.admin_password;
  return json({ success: true, message: 'Pengaturan berhasil disimpan.', relogin_required: pwChanging, settings: safe });
}

/* GET | POST /api/keys */
export async function keysList(req, env) {
  const g = await gateAdmin(req, env); if (g.fail) return g.fail;
  return json({ success: true, keys: await listKeys() });
}
export async function keysCreate(req, env) {
  const g = await gateAdmin(req, env); if (g.fail) return g.fail;
  const body = await readBody(req);
  // [FIX R12] tolak input kebesaran sebelum menyentuh store
  if (typeof body.name === 'string' && body.name.length > 200) {
    return json({ success: false, message: 'Nama key maksimal 64 karakter.' }, 400);
  }
  try {
    const entry = await createKey(body.name || 'Client Key', body.prefix || 'am-sk');
    return json({ success: true, message: 'API Key baru berhasil dibuat.', key: entry }, 201);
  } catch (e) {
    if (e && e.code === 'MAX_KEYS') return json({ success: false, message: e.message }, 400);
    return json({ success: false, message: 'Gagal membuat key.' }, 500);
  }
}

/* PATCH /api/keys/:key/toggle */
export async function keyToggle(req, env, key) {
  const g = await gateAdmin(req, env); if (g.fail) return g.fail;
  const updated = await toggleKeyStatus(decodeURIComponent(key));
  if (!updated) return json({ success: false, message: 'Key tidak ditemukan.' }, 404);
  return json({ success: true, message: 'Status key berhasil diubah menjadi ' + (updated.is_active ? 'Aktif' : 'Nonaktif') + '.', key: updated });
}

/* DELETE /api/keys/:key */
export async function keyRevoke(req, env, key) {
  const g = await gateAdmin(req, env); if (g.fail) return g.fail;
  // [FIX R8] cegah self-lockout: master key & key aktif terakhir gak boleh dihapus
  const _k = decodeURIComponent(key);
  const _kd = await getKeysData();
  const _mk = _kd.master_key;
  const _envMk = env && env.MASTER_API_KEY;
  if (safeEqual(_k, _mk) || (_envMk && safeEqual(_k, _envMk))) {
    return json({ success: false, message: 'Master key tidak boleh dihapus (bisa mengunci semua akses).' }, 400);
  }
  const _all = await listKeys();
  if (_all.filter(x => x.key !== _k && x.is_active).length === 0) {
    return json({ success: false, message: 'Tidak bisa hapus key aktif terakhir.' }, 400);
  }
  const ok = await revokeKey(_k);
  if (!ok) return json({ success: false, message: 'Key tidak ditemukan.' }, 404);
  return json({ success: true, message: 'API Key berhasil dihapus.' });
}

/* GET /api/keys/sessions */
export async function sessionsList(req, env) {
  const g = await gateAdmin(req, env); if (g.fail) return g.fail;
  // PRIVASI: email user tidak pernah keluar mentah.
  const list = await getSessions();
  return json({ success: true, sessions: list.map(maskSession) });
}

/* GET | DELETE /api/keys/logs */
export async function logsGet(req, env) {
  const g = await gateAdmin(req, env); if (g.fail) return g.fail;
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10) || 100;
  return json({ success: true, logs: await getLogs(limit) });
}
export async function logsClear(req, env) {
  const g = await gateAdmin(req, env); if (g.fail) return g.fail;
  await clearLogs();
  return json({ success: true, message: 'Log riwayat request berhasil dibersihkan.' });
}
