const $ = i => document.getElementById(i)

/* ---------- THEME (auto ikut device, bisa ganti manual) ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t)
  const l = document.getElementById('tmLight'), d = document.getElementById('tmDark')
  if (l && d) {
    l.className = t === 'light' ? 'on' : ''
    d.className = t === 'dark' ? 'on' : ''
  }
}
function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function setTheme(t) {
  localStorage.setItem('am_theme', t)
  applyTheme(t)
}
// init: pakai preferensi user kalau ada, kalau nggak ikut device
const savedTheme = localStorage.getItem('am_theme')
applyTheme(savedTheme || systemTheme())
// kalau user belum pernah pilih manual, ikuti perubahan tema device realtime
if (!savedTheme && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('am_theme')) applyTheme(e.matches ? 'dark' : 'light')
  })
}

// [SEC] Token sesi web: halaman ambil sekali, dipakai buat semua call API.
// Pengganti cek Origin/Referer yang bisa dipalsukan.
let AM_WEB_TOKEN = null
let AM_TOKEN_PROMISE = null
async function amToken() {
  if (AM_WEB_TOKEN) return AM_WEB_TOKEN
  if (!AM_TOKEN_PROMISE) {
    AM_TOKEN_PROMISE = fetch('/api/websession')
      .then(r => r.json())
      .then(j => { AM_WEB_TOKEN = j && j.success ? j.token : null; return AM_WEB_TOKEN })
      .catch(() => null)
  }
  return AM_TOKEN_PROMISE
}
// fetch API dgn token sesi; kalau token expired (401), ambil ulang sekali.
async function apiFetch(url, opts) {
  const o = Object.assign({ credentials: 'same-origin' }, opts || {})
  const t = await amToken()
  o.headers = Object.assign({}, o.headers || {})
  if (t) o.headers['x-web-session'] = t
  let r = await fetch(url, o)
  if (r.status === 401) {
    AM_WEB_TOKEN = null; AM_TOKEN_PROMISE = null
    const t2 = await amToken()
    if (t2) { o.headers['x-web-session'] = t2; r = await fetch(url, o) }
  }
  return r
}

async function refreshStats() {
  try {
    const r = await apiFetch('/api/stats')
    const j = await r.json()
    $('st-total').textContent = Number(j.total || 0).toLocaleString('id-ID')
    $('st-today').textContent = Number(j.today || 0).toLocaleString('id-ID')
  } catch (e) {}
}
refreshStats()

function timeAgo(iso) {
  if (!iso) return ''
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return s + ' detik lalu'
  if (s < 3600) return Math.floor(s / 60) + ' menit lalu'
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu'
  return Math.floor(s / 86400) + ' hari lalu'
}

function fmtTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).replace(/\./g, ':')
  } catch { return '' }
}

let lastFeedFirst = null
// [FIX R7] escape sebelum innerHTML — feed berisi data dari server
const ESC = (v) => String(v == null ? '' : v)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#039;')
async function refreshActivity() {
  const box = $('logfeed')
  if (!box) return
  try {
    const r = await apiFetch('/api/activity?limit=10')
    const j = await r.json()
    const feed = j.feed || []
    if (!feed.length) {
      box.innerHTML = '<div class="logitem"><span class="t">belum ada aktivasi — jadi yang pertama wkwk</span></div>'
      return
    }
    box.innerHTML = feed.map(item => {
      const ok = (item.status || '').toUpperCase() === 'ACTIVE'
      const badge = ok ? '<span class="badge b-ok">PREMIUM AKTIF</span>' : '<span class="badge b-fail">GAGAL</span>'
      const wkt = fmtTime(item.time)
      const rel = timeAgo(item.time)
      return `<div class="logitem">${badge}<span class="em">${ESC(item.email)}</span><br><span class="t">diaktifkan: ${wkt}${rel ? ' (' + rel + ')' : ''}${item.validUntil ? ' · aktif s.d. ' + ESC(item.validUntil) : ''}</span></div>`
    }).join('')
  } catch (e) {}
}
refreshActivity()
setInterval(refreshActivity, 10000)
setInterval(refreshStats, 10000)

const step = n => {
  for (let i = 1; i <= 3; i++) {
    $('p' + i).classList.toggle('hide', i !== n)
    $('n' + i).className = i < n ? 'done' : (i === n ? 'on' : '')
  }
}
const say = (id, txt, ok) => {
  const m = $(id)
  m.textContent = txt
  m.className = 'msg ' + (ok ? 'ok' : 'err')
}
const busy = (b, on, t) => { b.disabled = on; if (t) b.textContent = t }

$('b1').onclick = async () => {
  const em = $('em').value.trim()
  if (!em.includes('@')) return say('m1', 'email gak valid', 0)
  const b = $('b1'); busy(b, true, 'mengirim...')
  try {
    const r = await apiFetch('/api/send-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: em })
    })
    const j = await r.json()
    if (j.success) {
      say('m1', 'link terkirim, cek email', 1)
      $('w-em').textContent = em
      setTimeout(() => step(2), 700)
    } else {
      say('m1', j.message || 'gagal', 0)
    }
  } catch {
    say('m1', 'server gak nyambung', 0)
  }
  busy(b, false); b.textContent = 'kirim link \u2192'
}

$('b2').onclick = () => step(1)

$('b3').onclick = async () => {
  const raw = $('lk').value.trim()
  if (!raw) return say('m2', 'link kosong', 0)
  const b = $('b3'); busy(b, true, 'verifikasi...')
  try {
    const r = await apiFetch('/api/verify-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: $('w-em').textContent, magicLink: raw })
    })
    const j = await r.json()
    if (j.success) {
      const d = j.data
      $('r-em').textContent = d.email
      $('r-uid').textContent = d.uid
      $('r-ord').textContent = d.orderId || '-'
      $('r-tok').textContent = d.idToken
      window.__tok = d.idToken
      step(3)
    } else {
      say('m2', j.message || 'gagal', 0)
    }
  } catch {
    say('m2', 'server gak nyambung', 0)
  }
  busy(b, false); b.textContent = 'verifikasi \u2192'
}

$('b4').onclick = () => { navigator.clipboard.writeText(window.__tok || ''); $('b4').textContent = 'copied' }
$('b5').onclick = () => { $('lk').value = ''; step(1) }

/* [FIX CSP] bind event via JS — CSP tanpa 'unsafe-inline' */
document.getElementById('tmLight').addEventListener('click', () => setTheme('light'));
document.getElementById('tmDark').addEventListener('click', () => setTheme('dark'));
