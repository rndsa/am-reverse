export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-api-key, authorization',
      'access-control-allow-methods': 'GET, POST, OPTIONS'
    }, extra)
  });
}

export function err(status, code, message) {
  return json({ success: false, error: code, message }, status);
}

export async function readBody(req) {
  try { return await req.json(); } catch (e) { return {}; }
}
