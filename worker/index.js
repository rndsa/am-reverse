/**
 * am-reverse — Cloudflare Worker entry
 * Routes: /api/* (JSON API) + static assets from ./public via ASSETS binding
 */
import { bindKV } from './lib/store.js';
import { addLog } from './lib/logger.js';
import { securityHeaders, rateLimit, rateLimitGlobal, clientIp } from './lib/security.js';
import * as pub from './routes/public.js';
import * as adm from './routes/admin.js';

function sec(origin) { return securityHeaders(origin); }
function preflight(origin) { return new Response(null, { status: 204, headers: sec(origin) }); }
function notFound(origin) {
  return new Response(JSON.stringify({ success: false, message: 'Endpoint tidak ditemukan.' }), {
    status: 404, headers: Object.assign({ 'content-type': 'application/json' }, sec(origin))
  });
}

export default {
  async fetch(request, env, ctx) {
    bindKV(env.AM_DATA || null);

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    const origin = request.headers.get('origin');
    if (method === 'OPTIONS') return preflight(origin);

    // [FIX R6] normalisasi path sebelum rate limit (cegah bypass /api//send-link)
    function normalizePath(p) {
      if (!p) return '/';
      const raw = String(p).split('?')[0].split('#')[0].replace(/\\/g, '/');
      // [FIX R20] berbasis SEGMEN — `replace(/\/+\./)` dulu bisa MENGHASILKAN '//'
      // yang tidak di-collapse -> bucket sendiri -> bypass. Lihat server.js.
      const parts = raw.split('/');
      const out = [];
      for (const seg of parts) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { out.pop(); continue; }
        out.push(seg);
      }
      return ('/' + out.join('/')).toLowerCase();
    }
    const _np = normalizePath(path);

    // [SEC-2] rate limit matrix (samakan dgn server.js)
    const LIMITS = {
      '/api/send-link':   ['send-link',   5,  60000],
      '/api/verify-link': ['verify-link', 10, 60000],
      '/api/reactivate':  ['reactivate',  10, 60000],
      '/api/provision':   ['provision',   10, 60000],
      '/api/verify':      ['verify',      10, 60000],
      '/api/keys/login':  ['admin-login', 8,  300000],
      '/api/websession':  ['websession',  20, 60000]
    };
    // [FIX R3] batas GLOBAL lintas-IP (circuit breaker) — parity dgn server.js
    const GLOBAL_LIMITS = {
      'send-link':   [300, 60000],
      'verify-link': [500, 60000],
      'reactivate':  [500, 60000],
      'provision':   [500, 60000],
      'verify':      [500, 60000],
      'admin-login': [120, 300000],
      'websession':  [1000, 60000]
    };
    const _limKey = Object.keys(LIMITS).find(k => normalizePath(k) === _np);
    if (_limKey) {
      const [name, limit, win] = LIMITS[_limKey];
      const r = rateLimit(`ip:${clientIp(request)}:${name}`, limit, win);
      if (!r.ok) {
        return new Response(JSON.stringify({ success: false, error: 'RATE_LIMITED', message: `Terlalu banyak permintaan. Coba lagi dalam ${r.retryAfterSec} detik.` }), {
          status: 429, headers: Object.assign({ 'content-type': 'application/json', 'retry-after': String(r.retryAfterSec) }, sec(origin))
        });
      }
      const G = GLOBAL_LIMITS[name];
      if (G) {
        const g = rateLimitGlobal(`global:${name}`, G[0], G[1]);
        if (!g.ok) {
          return new Response(JSON.stringify({ success: false, error: 'RATE_LIMITED', message: `Layanan sedang padat. Coba lagi dalam ${g.retryAfterSec} detik.` }), {
            status: 429, headers: Object.assign({ 'content-type': 'application/json', 'retry-after': String(g.retryAfterSec) }, sec(origin))
          });
        }
      }
    }

    /* ---------------- API ---------------- */
    if (path.startsWith('/api/')) {
      const started = Date.now();
      let res;
      try {
        res = await route(path, method, request, env);
      } catch (e) {
        res = new Response(JSON.stringify({ success: false, message: 'Internal error: ' + (e && e.message ? e.message : 'unknown') }), {
          status: 500, headers: Object.assign({ 'content-type': 'application/json' }, sec(origin))
        });
      }

      // async request log (skip polling endpoints)
      const isPoll = path.includes('/api/keys/logs') || path.includes('/api/keys/stats-detailed');
      if (!isPoll && env.AM_DATA) {
        const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
        ctx.waitUntil(addLog({
          ip: ip,
          method: method,
          path: path + (url.search || ''),
          status: res.status,
          duration_ms: Date.now() - started
        }));
      }
      // [SEC] tempel header keamanan ke semua response API
      const withSec = new Response(res.body, res);
      for (const [k, v] of Object.entries(sec(origin))) withSec.headers.set(k, v);
      // [FIX R9] response admin jangan di-cache
      if (_np.startsWith('/api/keys')) {
        withSec.headers.set('cache-control', 'no-store, no-cache, must-revalidate, private');
        withSec.headers.set('pragma', 'no-cache');
      }
      return withSec;
    }

    /* ---------------- hidden admin panel ---------------- */
    // direct access to admin.html is blocked (matches original server behaviour)
    if (path === '/admin.html') {
      return new Response('Not Found', { status: 404 });
    }
    if (path === '/panel-x8k2') {
      return env.ASSETS.fetch(new Request(new URL('/admin.html', url), request));
    }
    if (path === '/docs' || path === '/docs/') {
      return env.ASSETS.fetch(new Request(new URL('/docs.html', url), request));
    }

    /* ---------------- static assets ---------------- */
    if (path === '/' || path === '') {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    }

    return env.ASSETS.fetch(request);
  }
};

async function route(path, method, req, env) {
  // ---- public ----
  if (path === '/api/websession' && method === 'GET') return pub.webSession(req, env);
  if (path === '/api/status' && method === 'GET') return pub.status();
  if (path === '/api/stats' && method === 'GET') return pub.stats(req, env);
  if (path === '/api/send-link' && method === 'POST') return pub.sendLink(req, env);
  if (path === '/api/verify-link' && method === 'POST') return pub.verifyLink(req, env);
  if (path === '/api/verify' && method === 'POST') return pub.verify(req, env);
  if (path === '/api/provision' && method === 'POST') return pub.provision(req, env);
  // legacy: reactivate mounted at root level (POST /api/ with body) — map both sub-paths
  if (path === '/api/reactivate' && method === 'POST') return pub.verify(req, env);

  // ---- admin ----
  if (path === '/api/keys/login' && method === 'POST') return adm.login(req, env);
  if (path === '/api/keys/stats-detailed' && method === 'GET') return adm.statsDetailed(req, env);
  if (path === '/api/keys/settings' && method === 'GET') return adm.settingsGet(req, env);
  if (path === '/api/keys/settings' && method === 'PUT') return adm.settingsPut(req, env);
  if (path === '/api/keys/sessions' && method === 'GET') return adm.sessionsList(req, env);
  if (path === '/api/keys/logs' && method === 'GET') return adm.logsGet(req, env);
  if (path === '/api/keys/logs' && method === 'DELETE') return adm.logsClear(req, env);
  if (path === '/api/keys' && method === 'GET') return adm.keysList(req, env);
  if (path === '/api/keys' && method === 'POST') return adm.keysCreate(req, env);

  const toggle = path.match(/^\/api\/keys\/(.+)\/toggle$/);
  if (toggle && method === 'PATCH') return adm.keyToggle(req, env, toggle[1]);

  const revoke = path.match(/^\/api\/keys\/(.+)$/);
  if (revoke && method === 'DELETE') return adm.keyRevoke(req, env, revoke[1]);

  return notFound(null);
}
