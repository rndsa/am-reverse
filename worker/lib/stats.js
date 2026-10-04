import { kvGet, kvPut, STATS_FILE } from './store.js';

function today() { return new Date().toISOString().split('T')[0]; }

export async function loadStats() {
  const D = { totalPremium: 0, todayPremium: 0, lastDate: today() };
  const data = await kvGet(STATS_FILE, null);
  if (!data) { await kvPut(STATS_FILE, D); return Object.assign({}, D); }
  if (data.lastDate !== today()) { data.todayPremium = 0; data.lastDate = today(); await kvPut(STATS_FILE, data); }
  return data;
}

export async function getStats() {
  const c = await loadStats();
  return { total: c.totalPremium || 0, today: c.todayPremium || 0 };
}

export async function incrementStats() {
  const c = await loadStats();
  c.totalPremium = (c.totalPremium || 0) + 1;
  c.todayPremium = (c.todayPremium || 0) + 1;
  c.lastDate = today();
  await kvPut(STATS_FILE, c);
  return { total: c.totalPremium, today: c.todayPremium };
}
