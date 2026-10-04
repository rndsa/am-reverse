import { json, readBody } from '../lib/http.js';
import { link, auth, pro } from '../lib/auth.js';
import { friendlyFirebaseError } from '../lib/errors.js';
import { incrementStats, getStats } from '../lib/stats.js';
import { addSession } from '../lib/sessions.js';
import { requireApiKey, optionalApiKey } from '../lib/middleware.js';
import { issue as issueWeb } from '../lib/websession.js';
import { clientIp } from '../lib/security.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* GET /api/websession — terbitkan token sesi web (pengganti cek Origin/Referer) */
export async function webSession(req, env) {
  const ip = clientIp(req);
  const q = takeQuota(ip);
  if (!q.ok) {
    return json({ success: false, error: 'QUOTA_EXCEEDED', message: 'Kuota sesi web harian habis.' }, 429);
  }
  const { token, expiresIn } = await issueWeb(ip, env);
  return json({ success: true, token, expiresIn, remaining: q.remaining }, 200, {
    'set-cookie': `am_web=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${expiresIn}`,
    'cache-control': 'no-store'
  });
}

// kuota penerbitan token per IP per hari (ceiling map wajib)
const MAX_QK = 20000, DAILY_LIMIT = 200;
const _issued = new Map();
function _today() { return new Date().toISOString().slice(0, 10); }
function takeQuota(ip) {
  const d = _today(); const e = _issued.get(ip);
  if (!e || e.day !== d) {
    _issued.set(ip, { count: 1, day: d });
    if (_issued.size > MAX_QK) { const o = _issued.size - MAX_QK; let i = 0; for (const k of _issued.keys()) { if (i++ >= o) break; _issued.delete(k); } }
    return { ok: true, remaining: DAILY_LIMIT - 1 };
  }
  if (e.count >= DAILY_LIMIT) return { ok: false, remaining: 0 };
  e.count += 1;
  return { ok: true, remaining: DAILY_LIMIT - e.count };
}

/* POST /api/send-link */
export async function sendLink(req, env) {
  const gate = await optionalApiKey(req, env);   // [FIX R22b] parity dgn node (web token = web doang)
  if (gate.fail) return gate.fail;

  const body = await readBody(req);
  const email = body.email;
  if (!email || !EMAIL_RE.test(String(email))) {
    return json({ success: false, message: 'email gak valid.' }, 400);
  }
  const em = String(email).trim().toLowerCase();
  const r = await link(em, env);
  if (!r.ok) return json({ success: false, message: friendlyFirebaseError(r.why), code: r.why }, 400);
  return json({ success: true, email: em, message: 'link dikirim ke ' + em + '. cek inbox / spam.' });
}

/* POST /api/verify-link */
export async function verifyLink(req, env) {
  const gate = await optionalApiKey(req, env);   // [FIX R22b] parity dgn node
  if (gate.fail) return gate.fail;

  const body = await readBody(req);
  const email = body.email;
  const magicLink = body.magicLink || body.rawLink || body.link;
  if (!email || String(email).indexOf('@') === -1) {
    return json({ success: false, message: 'email wajib diisi.' }, 400);
  }
  if (!magicLink || !String(magicLink).trim()) {
    return json({ success: false, message: 'link dari email wajib diisi (magicLink / rawLink / link).' }, 400);
  }

  const em = String(email).trim().toLowerCase();
  const v = await auth(em, String(magicLink).trim(), env);
  if (!v.ok) return json({ success: false, message: friendlyFirebaseError(v.why), code: v.why }, 400);

  const premium = await pro(v.id);
  const stats = premium.ok ? await incrementStats() : await getStats();

  const now = new Date();
  const until = new Date();
  until.setFullYear(until.getFullYear() + 1);

  try {
    await addSession({
      email: em, uid: v.uid, orderId: premium.order || null,
      status: premium.ok ? 'ACTIVE' : 'FAILED',
      key_used: (gate.apiKey && gate.apiKey.name) || 'Unknown'
    });
  } catch (e) {}

  return json({
    success: true,
    message: premium.ok ? 'verifikasi berhasil, premium aktif.' : 'login berhasil, aktivasi premium gagal.',
    data: {
      stats: stats,
      uid: v.uid,
      email: (v.user && v.user.email) || em,
      emailVerified: v.user ? (v.user.emailVerified !== undefined ? v.user.emailVerified : true) : true,
      displayName: (v.user && v.user.displayName) || null,
      photoUrl: (v.user && v.user.photoUrl) || null,
      createdAt: v.user && v.user.createdAt ? new Date(Number(v.user.createdAt)).toISOString() : null,
      lastLoginAt: v.user && v.user.lastLoginAt ? new Date(Number(v.user.lastLoginAt)).toISOString() : now.toISOString(),
      isNewUser: v.baru,
      status: premium.ok ? 'ACTIVE' : 'INACTIVE',
      membershipStatus: premium.ok ? 'PREMIUM_ACTIVE' : 'LOGIN_ONLY',
      planName: 'Alight Motion Pro / Member',
      subscriptionType: 'Yearly VIP License',
      orderId: premium.order || null,
      activatedAt: now.toISOString(),
      validUntil: until.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
      validUntilTimestamp: until.getTime(),
      tokenType: 'Bearer',
      idToken: v.id,
      refreshToken: v.ref,
      premiumResponse: premium.ok ? premium.r : null,
      premiumError: premium.ok ? null : premium.why,
      profile: v.user || null
    }
  });
}

/* POST /api/verify  (stage 1) */
export async function verify(req, env) {
  const gate = await optionalApiKey(req, env);   // [FIX R22b] parity dgn node
  if (gate.fail) return gate.fail;

  const body = await readBody(req);
  const email = body.email;
  const rawLink = body.rawLink || body.magicLink || body.link;
  if (!email || String(email).indexOf('@') === -1) {
    return json({ success: false, message: 'email wajib diisi.' }, 400);
  }
  if (!rawLink || !String(rawLink).trim()) {
    return json({ success: false, message: 'rawLink (magic link dari email) wajib diisi (rawLink / magicLink / link).' }, 400);
  }

  const em = String(email).trim().toLowerCase();
  const v = await auth(em, String(rawLink).trim(), env);
  if (!v.ok) return json({ success: false, message: friendlyFirebaseError(v.why), code: v.why }, 400);

  return json({
    success: true,
    message: 'magic link valid, token berhasil didapat.',
    data: {
      email: (v.user && v.user.email) || em,
      uid: v.uid,
      isNewUser: !!v.baru,
      idToken: v.id,
      refreshToken: v.ref,
      profile: v.user || null
    }
  });
}

/* POST /api/provision  (stage 2) */
export async function provision(req, env) {
  const gate = await optionalApiKey(req, env);   // [FIX R22b] parity dgn node
  if (gate.fail) return gate.fail;

  const body = await readBody(req);
  const email = body.email;
  const idToken = body.idToken;
  if (!idToken || !String(idToken).trim()) {
    return json({ success: false, message: 'idToken wajib diisi (dari tahap verify).' }, 400);
  }

  const em = email ? String(email).trim().toLowerCase() : null;
  const premium = await pro(String(idToken).trim());
  const stats = premium.ok ? await incrementStats() : await getStats();

  const now = new Date();
  const until = new Date();
  until.setFullYear(until.getFullYear() + 1);

  if (!premium.ok) {
    return json({ success: false, message: 'Aktivasi premium gagal: ' + friendlyFirebaseError(premium.why), code: premium.why }, 400);
  }

  try {
    await addSession({
      email: em || '(tanpa email)', uid: null, orderId: premium.order || null,
      status: 'ACTIVE', key_used: (gate.apiKey && gate.apiKey.name) || 'Unknown'
    });
  } catch (e) {}

  return json({
    success: true,
    message: 'premium berhasil diaktifkan.',
    data: {
      email: em || null,
      status: 'ACTIVE',
      membershipStatus: 'PREMIUM_ACTIVE',
      planName: 'Alight Motion Pro / Member',
      subscriptionType: 'Yearly VIP License',
      orderId: premium.order || null,
      premiumResponse: premium.r || null,
      activatedAt: now.toISOString(),
      validUntil: until.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
      validUntilTimestamp: until.getTime(),
      stats: stats
    }
  });
}

/* GET /api/stats */
export async function stats(req, env) {
  const s = await getStats();
  return json({ success: true, total: s.total, today: s.today, timestamp: new Date().toISOString() });
}

/* GET /api/status */
export async function status() {
  return json({ status: 'online', timestamp: new Date().toISOString() });
}
