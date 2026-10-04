// lib/urlpath.js — normalisasi path bersama (rate limit + logger).
// [FIX R20] Berbasis SEGMEN. Versi lama (`replace(/\/+\\.(?=\\/|$)/g,'/')`)
// MENGHASILKAN '//' yang tidak di-collapse:
//   '/api/./keys/login' -> '/api//keys/login'  (bucket SENDIRI = bypass rate limit)
// Terverifikasi: 24 req lintas 8 varian tembus batas 8. Setelah fix: tepat 8.

function normalizePath(p) {
  if (!p) return '/'
  const raw = String(p).split('?')[0].split('#')[0].replace(/\\/g, '/')
  const parts = raw.split('/')
  const out = []
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') { out.pop(); continue }
    out.push(seg)
  }
  return ('/' + out.join('/')).toLowerCase()
}

module.exports = { normalizePath }
