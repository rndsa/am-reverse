import { validateKey } from './keys.js';
import { getSettings } from './settings.js';
import { err } from './http.js';
import { verify as verifyWebSession } from './websession.js';
import { clientIp } from './security.js';

// [FIX C1] Web UI gratis tanpa key, tapi WAJIB token bertanda tangan (bukan Origin/Referer).
async function hasWebToken(req, env) {
  let tok = req.headers.get('x-web-session') || '';
  if (!tok) {
    const raw = req.headers.get('cookie') || '';
    const m = raw.match(/(?:^|;\s*)am_web=([^;]+)/);
    if (m) { try { tok = decodeURIComponent(m[1]); } catch { tok = m[1]; } }
  }
  if (!tok) return false;
  return verifyWebSession(tok, clientIp(req), env);
}

export async function requireApiKey(req, env) {
  const settings = await getSettings(env);

  if (!settings.service_active) {
    return { fail: err(503, 'SERVICE_OFFLINE', settings.maintenance_message || 'Layanan sedang dinonaktifkan oleh administrator.') };
  }

  if (!settings.require_api_key) {
    return { apiKey: { key: 'guest', name: 'Guest User', is_active: true } };
  }

  let key = req.headers.get('x-api-key') || '';
  const auth = req.headers.get('authorization');
  if (!key && auth) key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();

  if (!key) {
    return { fail: err(401, 'UNAUTHORIZED', "API Key wajib disertakan. Kirim via header 'x-api-key' atau 'Authorization: Bearer'.") };
  }

  const valid = await validateKey(key, env);
  if (!valid) return { fail: err(401, 'INVALID_API_KEY', 'API Key tidak valid atau telah dicabut.') };

  return { apiKey: valid };
}

// [FIX C1] ganti cek Origin/Referer yang spoofable.
export async function optionalApiKey(req, env) {
  if (await hasWebToken(req, env)) return { apiKey: { key: 'webui', name: 'Web UI', is_active: true } };
  return requireApiKey(req, env);
}
