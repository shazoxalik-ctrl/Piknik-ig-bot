import { kvGetRaw, kvGetJSON } from './_lib/kv.js';

export default async function handler(req, res) {
  const b64 = await kvGetRaw('settings:audio_b64');
  if (!b64) return res.status(404).send('Audio not configured');
  const meta = await kvGetJSON('settings:audio_meta');
  const buffer = Buffer.from(b64, 'base64');
  res.setHeader('Content-Type', meta?.mimeType || 'audio/mp4');
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).send(buffer);
}
