import { kvGet, kvPut, SESSIONS_FILE } from './store.js';
const MAX_SESSIONS = 200;

export async function getSessions() {
  const s = await kvGet(SESSIONS_FILE, []);
  return Array.isArray(s) ? s : [];
}

export async function addSession(sess) {
  let s = await getSessions();
  s.unshift(Object.assign({ created_at: new Date().toISOString() }, sess));
  if (s.length > MAX_SESSIONS) s = s.slice(0, MAX_SESSIONS);
  await kvPut(SESSIONS_FILE, s);
  return true;
}

export async function clearSessions() { await kvPut(SESSIONS_FILE, []); return true; }
