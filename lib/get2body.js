// Helper: request GET dengan query params di-map ke req.body (alias fleksibel)
// Contoh: POST /api/send-link  header 'x-api-key: am-sk-...'  body {"email":"x@y.com"}
function fromQuery(aliases) {
  // aliases: { bodyKey: [queryAliases...] }
  return function (req, res, next) {
    req.body = req.body || {}
    const q = req.query || {}
    for (const [bodyKey, names] of Object.entries(aliases)) {
      for (const n of names) {
        if (q[n] !== undefined && q[n] !== '') { req.body[bodyKey] = q[n]; break }
      }
    }
    next()
  }
}

module.exports = { fromQuery }
