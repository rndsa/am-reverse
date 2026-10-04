/**
 * am-reverse — Cloudflare Worker port (upstream auth)
 * Native fetch replaces axios. Storage via KV adapter (see store.js).
 */

const IDT = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty';
const VFY = 'https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase';
const TOK = 'https://securetoken.googleapis.com/v1/token';

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const dip = () => `${rnd(1,255)}.${rnd(0,255)}.${rnd(0,255)}.${rnd(1,255)}`;
const sp = h => ({
  ...h,
  'x-forwarded-for': dip(), 'x-real-ip': dip(), 'client-ip': dip(),
  'x-client-ip': dip(), 'x-originating-ip': dip(), 'x-cluster-client-ip': dip()
});
const H1 = {
  'content-type': 'application/json',
  'x-android-package': 'com.alightcreative.motion',
  'x-android-cert': 'ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8',
  'user-agent': 'dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)'
};
const H2 = {
  'content-type': 'application/json; charset=utf-8',
  'user-agent': 'okhttp/3.12.1',
  'accept-encoding': 'gzip'
};

async function post(url, body, headers) {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.response = { data }; throw e; }
  return { data };
}
const bad = e => {
  const d = e && e.response && e.response.data;
  return d ? (typeof d === 'object' ? JSON.stringify(d) : String(d)) : ((e && e.message) || 'unknown error');
};

export function code(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/&amp;/g, '&');
  try { s = decodeURIComponent(s) } catch (e) {}
  try {
    const u = new URL(s);
    let c = u.searchParams.get('oobCode');
    if (!c) {
      const n = u.searchParams.get('link') || u.searchParams.get('q') || u.searchParams.get('url');
      if (n) { try { c = new URL(n).searchParams.get('oobCode') } catch (e2) {} }
    }
    if (c) return c.replace(/[^a-zA-Z0-9_-]/g, '');
  } catch (e) {}
  const m = s.match(/oobCode=([a-zA-Z0-9_-]+)/i);
  if (m) return m[1];
  const t = raw.trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(t) && t.indexOf('://') === -1) return t;
  return null;
}

export async function link(email, env) {
  const key = env.FIREBASE_API_KEY;
  try {
    await post(IDT + '/getOobConfirmationCode?key=' + key, {
      requestType: 6, email: email,
      androidInstallApp: true, canHandleCodeInApp: true,
      continueUrl: 'https://alightcreative.com?ui_sid=0366624874&ui_sd=0',
      iosBundleId: 'com.alightcreative.motion',
      androidPackageName: 'com.alightcreative.motion',
      androidMinimumVersion: '585',
      clientType: 'CLIENT_TYPE_ANDROID'
    }, sp(H1));
    return { ok: true };
  } catch (e) { return { ok: false, why: bad(e) }; }
}

export async function auth(email, raw, env) {
  const key = env.FIREBASE_API_KEY;
  const c = code(raw);
  if (!c) return { ok: false, why: 'code gak ada' };
  try {
    const a = await post(IDT + '/emailLinkSignin?key=' + key, {
      email: email, oobCode: c, clientType: 'CLIENT_TYPE_ANDROID'
    }, sp(H1));
    let u = null;
    try {
      const b = await post(IDT + '/getAccountInfo?key=' + key, { idToken: a.data.idToken }, sp(H1));
      u = (b.data && b.data.users && b.data.users[0]) || null;
    } catch (e2) {}
    return {
      ok: true, email: email,
      id: a.data.idToken, ref: a.data.refreshToken,
      uid: a.data.localId, baru: !!a.data.isNewUser, user: u
    };
  } catch (e) { return { ok: false, why: bad(e) }; }
}

export async function pro(id) {
  const o = 'neo-' + hex(6);
  const b = {
    data: {
      productId: 'am.full.sub.annual.19q4',
      token: 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw',
      skuType: 'subs',
      orderId: o
    }
  };
  const h = Object.assign({}, H2, {
    authorization: 'Bearer ' + id,
    'firebase-instance-id-token': 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'
  });
  try {
    const r = await post(VFY, b, sp(h));
    return { ok: true, order: o, r: r.data };
  } catch (e) { return { ok: false, why: bad(e) }; }
}

export async function re(ref, env) {
  try {
    const r = await post(TOK + '?key=' + env.FIREBASE_API_KEY, {
      grant_type: 'refresh_token', refresh_token: ref
    }, H2);
    return { ok: true, id: r.data.id_token, ref: r.data.refresh_token };
  } catch (e) { return { ok: false, why: bad(e) }; }
}

export function hex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
  return s;
}
