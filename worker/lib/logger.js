import { kvGet, kvPut, LOGS_FILE } from './store.js';
import { maskText } from './mask.js';

// [FIX R11b] scrub kredensial dari path/details
function scrubSecrets(s) {
  if (!s) return s;
  return String(s)
    .replace(/([?&](?:key|api_key|token|password|secret|admin_password)=)[^&#]*/gi, '$1[REDACTED]')
    .replace(/am-sk-[A-Za-z0-9]+/g, 'am-sk-[REDACTED]')
    .replace(/\b\d{13}\.[0-9]+\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, '[TOKEN-REDACTED]')
    // [FIX R19] PII: email di query jangan disimpan mentah
    .replace(/([?&](?:email|mail|e|to)=)([^&#]*)/gi, '$1[EMAIL-REDACTED]');
}
const MAX_LOGS = 500;

export async function addLog(entry) {
  let logs = await kvGet(LOGS_FILE, []);
  if (!Array.isArray(logs)) logs = [];
  const e = Object.assign({}, entry);
  if (e.details) e.details = maskText(e.details);
  if (e.path) e.path = scrubSecrets(e.path);
  logs.unshift(Object.assign({ ts: new Date().toISOString() }, e));
  if (logs.length > MAX_LOGS) logs = logs.slice(0, MAX_LOGS);
  await kvPut(LOGS_FILE, logs);
  return true;
}

export async function getLogs(limit) {
  const logs = await kvGet(LOGS_FILE, []);
  if (!Array.isArray(logs)) return [];
  const out = limit ? logs.slice(0, limit) : logs;
  return out.map(l => (l.details ? Object.assign({}, l, { details: maskText(l.details) }) : l));
}

export async function clearLogs() { await kvPut(LOGS_FILE, []); return true; }
