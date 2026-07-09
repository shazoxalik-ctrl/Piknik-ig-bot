const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvCommand(command) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  return data.result;
}

export async function kvGetJSON(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const raw = await kvCommand(['GET', key]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function kvSetJSON(key, value, ttlSeconds = 60 * 60 * 24 * 3) {
  if (!KV_URL || !KV_TOKEN) return;
  await kvCommand(['SET', key, JSON.stringify(value), 'EX', String(ttlSeconds)]);
}

export async function kvHSet(key, field, value) {
  if (!KV_URL || !KV_TOKEN) return;
  await kvCommand(['HSET', key, field, JSON.stringify(value)]);
}

export async function kvHGetAll(key) {
  if (!KV_URL || !KV_TOKEN) return {};
  const flat = await kvCommand(['HGETALL', key]);
  if (!Array.isArray(flat)) return {};
  const out = {};
  for (let i = 0; i < flat.length; i += 2) {
    try { out[flat[i]] = JSON.parse(flat[i + 1]); } catch { out[flat[i]] = flat[i + 1]; }
  }
  return out;
}

export async function kvHDel(key, field) {
  if (!KV_URL || !KV_TOKEN) return;
  await kvCommand(['HDEL', key, field]);
}

export async function kvSetJSONPersistent(key, value) {
  if (!KV_URL || !KV_TOKEN) return;
  await kvCommand(['SET', key, JSON.stringify(value)]);
}

export async function kvSetRaw(key, value) {
  if (!KV_URL || !KV_TOKEN) return;
  await kvCommand(['SET', key, value]);
}

export async function kvGetRaw(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  return await kvCommand(['GET', key]);
}
