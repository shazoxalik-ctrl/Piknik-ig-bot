import crypto from 'node:crypto';
import { kvHGetAll } from './_lib/kv.js';

export const config = { api: { bodyParser: false } };

function sessionToken(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="uz"><head><meta charset="UTF-8"><title>Kirish — Piknic UZ</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; background: #111; color: #eee; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  form { background: #1c1c1c; padding: 32px; border-radius: 12px; width: 280px; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  input { width: 100%; padding: 10px; margin-bottom: 12px; border-radius: 6px; border: 1px solid #333; background: #0d0d0d; color: #eee; box-sizing: border-box; }
  button { width: 100%; padding: 10px; border-radius: 6px; border: none; background: #4f7dfb; color: white; font-weight: 600; cursor: pointer; }
  .err { color: #ff6b6b; font-size: 13px; margin-bottom: 12px; }
</style></head>
<body>
  <form method="POST" action="/api/dashboard">
    <h1>Dashboard — parol kiriting</h1>
    ${error ? `<div class="err">Parol noto'g'ri</div>` : ''}
    <input type="password" name="password" placeholder="Parol" autofocus>
    <button type="submit">Kirish</button>
  </form>
</body></html>`;
}

function statsPage(replied, leads) {
  const repliedRows = Object.entries(replied)
    .sort((a, b) => (b[1].repliedAt || 0) - (a[1].repliedAt || 0))
    .map(
      ([id, v]) =>
        `<tr><td>${v.username || id}</td><td>${(v.commentText || '').slice(0, 60)}</td><td>${new Date(v.repliedAt).toLocaleString('uz-UZ')}</td></tr>`
    )
    .join('');
  const leadRows = Object.entries(leads)
    .sort((a, b) => (b[1].capturedAt || 0) - (a[1].capturedAt || 0))
    .map(
      ([id, v]) =>
        `<tr><td>${v.username || id}</td><td>${v.phone}</td><td>${new Date(v.capturedAt).toLocaleString('uz-UZ')}</td></tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="uz"><head><meta charset="UTF-8"><title>Dashboard — Piknic UZ</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; background: #111; color: #eee; margin: 0; padding: 32px; }
  h1 { font-size: 22px; }
  .cards { display: flex; gap: 16px; margin-bottom: 32px; }
  .card { background: #1c1c1c; border-radius: 12px; padding: 20px 28px; }
  .card .num { font-size: 32px; font-weight: 700; }
  .card .label { font-size: 13px; color: #999; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #292929; font-size: 14px; }
  th { color: #999; font-weight: 500; }
  h2 { font-size: 16px; color: #ccc; }
</style></head>
<body>
  <h1>Piknic UZ Instagram bot — statistika</h1>
  <div class="cards">
    <div class="card"><div class="num">${Object.keys(replied).length}</div><div class="label">Javob berilgan odamlar</div></div>
    <div class="card"><div class="num">${Object.keys(leads).length}</div><div class="label">Raqam qoldirganlar</div></div>
  </div>
  <h2>Raqam qoldirganlar</h2>
  <table><tr><th>Foydalanuvchi</th><th>Raqam</th><th>Vaqt</th></tr>${leadRows || '<tr><td colspan="3">Hali yo\'q</td></tr>'}</table>
  <h2>Javob berilganlar</h2>
  <table><tr><th>Foydalanuvchi</th><th>Komment</th><th>Vaqt</th></tr>${repliedRows || '<tr><td colspan="3">Hali yo\'q</td></tr>'}</table>
</body></html>`;
}

export default async function handler(req, res) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return res.status(500).send('DASHBOARD_PASSWORD sozlanmagan');

  if (req.method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const submitted = params.get('password') || '';
    if (submitted === password) {
      res.setHeader(
        'Set-Cookie',
        `dash_session=${sessionToken(password)}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`
      );
    } else {
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(loginPage(true));
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const validSession = req.method === 'POST' ? true : cookies.dash_session === sessionToken(password);

  res.setHeader('Content-Type', 'text/html');
  if (!validSession) return res.status(200).send(loginPage(false));

  const [replied, leads] = await Promise.all([kvHGetAll('stats:replied'), kvHGetAll('stats:leads')]);
  return res.status(200).send(statsPage(replied, leads));
}
