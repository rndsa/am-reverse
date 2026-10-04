// worker/lib/adminsession.js — token sesi admin (ESM, WebCrypto).
const TTL_MS = 8 * 60 * 60 * 1000

let _key = null, _secret = ''
async function hmacKey(env) {
  const secret = (env && (env.ADMIN_SESSION_SECRET || env.WEB_SESSION_SECRET || env.MASTER_API_KEY)) || 'am-admin-session-internal-secret'
  if (_key && _secret === secret) return _key
  _key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign'])
  _secret = secret
  return _key
}
function b64url(bytes) {
  let s=''; const b=new Uint8Array(bytes)
  for (let i=0;i<b.length;i++) s+=String.fromCharCode(b[i])
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
async function sign(payload, env) {
  const k = await hmacKey(env)
  return b64url(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(payload)))
}
function ctEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false
  let d = 0
  for (let i=0;i<a.length;i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
function randNonce() {
  const a = new Uint8Array(12); crypto.getRandomValues(a); return b64url(a.buffer)
}
export async function issue(epoch, env) {
  const exp = Date.now() + TTL_MS
  const nonce = randNonce()
  const payload = `${exp}.${epoch||0}.${nonce}`
  return { token: `${payload}.${await sign(payload, env)}`, expiresIn: Math.floor(TTL_MS/1000) }
}
export async function verify(token, expectedEpoch, env) {
  if (!token || typeof token !== 'string') return false
  const p = token.split('.')
  if (p.length !== 4) return false
  const [expStr, epochStr, nonce, sig] = p
  const expect = await sign(`${expStr}.${epochStr}.${nonce}`, env)
  if (!ctEqual(sig, expect)) return false
  const exp = parseInt(expStr, 10)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  const ep = parseInt(epochStr, 10)
  return Number.isFinite(ep) && ep === Number(expectedEpoch || 0)
}
export { TTL_MS }
