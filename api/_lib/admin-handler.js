import { kvHGetAll, kvHSet, kvHDel, kvGetJSON, kvSetJSONPersistent, kvSetRaw, kvSMembers } from './kv.js';
import { hashPassword, verifyPassword, signSession, verifySession, parseCookies } from './auth.js';
import { handleNewComment, handleFirstDirectContact } from './ig-actions.js';
import { getLeadOutcomeForUsername } from './amocrm.js';
import {
  listRecentMedia,
  listMediaComments,
  listConversations,
  getConversationMessages,
  deleteComment,
} from './ig-graph.js';

const DEFAULT_REPLY_TEXT = "Assalomu alaykum. Sizga direct'dan javob yubordim! 😊";

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Checks amoCRM outcome for people who left a phone number and haven't been
// checked yet, caching results in crm:leadoutcomes so the dashboard's
// "Sotib oldi" percentage stays fresh without needing a manual button.
async function checkLeadOutcomesBatch({ offset = 0, batchSize = 3, timeBudgetMs = 8000 } = {}) {
  const startedAt = Date.now();
  const leads = await kvHGetAll('stats:leads');
  const entries = Object.entries(leads);
  const outcomes = (await kvGetJSON('crm:leadoutcomes')) || {};
  const unchecked = entries.filter(([id]) => !outcomes[id]);
  const batch = unchecked.slice(offset, offset + batchSize);

  let processed = 0;
  for (const [id, v] of batch) {
    if (Date.now() - startedAt > timeBudgetMs) break;
    processed++;
    const outcome = v?.username ? await getLeadOutcomeForUsername(v.username) : null;
    outcomes[id] = outcome || { outcome: 'topilmadi', price: 0 };
  }
  if (processed > 0) await kvSetJSONPersistent('crm:leadoutcomes', outcomes);

  const nextOffset = offset + processed;
  const hasMore = nextOffset < unchecked.length;
  return { checked: processed, total: unchecked.length, nextOffset, hasMore };
}

async function checkLogin(username, password) {
  if (!username || !password) return false;
  const admins = await kvHGetAll('admin:users');
  if (Object.keys(admins).length === 0) {
    const envUser = process.env.ADMIN_USERNAME;
    const envPass = process.env.ADMIN_PASSWORD;
    if (envUser && envPass && username === envUser && password === envPass) {
      await kvHSet('admin:users', username, { passwordHash: hashPassword(password), createdAt: Date.now() });
      return true;
    }
    return false;
  }
  const record = admins[username];
  if (!record) return false;
  return verifyPassword(password, record.passwordHash);
}

function layout(title, body, active) {
  const nav = [
    ['', 'Statistika'],
    ['users', 'Adminlar'],
    ['settings', 'Sozlamalar'],
    ['backfill', 'Eski xabarlar'],
  ];
  const navHtml = nav
    .map(([path, label]) => `<a href="/api/admin/${path}" class="${active === path ? 'active' : ''}">${label}</a>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="uz"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} — Piknic UZ Admin</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; background: #111; color: #eee; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px 32px; border-bottom: 1px solid #262626; flex-wrap: wrap; gap: 8px; }
  nav a { color: #999; text-decoration: none; margin-right: 20px; font-size: 14px; }
  nav a.active, nav a:hover { color: #fff; }
  main { padding: 32px; max-width: 1000px; }
  .filters { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
  .filters a { color: #999; text-decoration: none; font-size: 13px; padding: 6px 12px; border-radius: 6px; background: #1c1c1c; }
  .filters a.active, .filters a:hover { color: #fff; background: #2a2a2a; }
  .filters form { display: flex; align-items: center; gap: 8px; max-width: none; margin: 0; }
  .filters input { width: auto; margin: 0; padding: 6px 10px; }
  .filters button { padding: 6px 14px; font-size: 13px; }
  .cards { display: flex; gap: 12px; margin-bottom: 32px; flex-wrap: nowrap; overflow-x: auto; }
  .card { background: #1c1c1c; border-radius: 12px; padding: 16px 18px; flex: 1 1 0; min-width: 130px; white-space: nowrap; }
  .card .num { font-size: 32px; font-weight: 700; }
  .card .label { font-size: 13px; color: #999; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #292929; font-size: 14px; }
  th { color: #999; font-weight: 500; }
  h2 { font-size: 16px; color: #ccc; }
  input, textarea { width: 100%; padding: 10px; margin-bottom: 12px; border-radius: 6px; border: 1px solid #333; background: #0d0d0d; color: #eee; box-sizing: border-box; font-family: inherit; }
  button { padding: 10px 18px; border-radius: 6px; border: none; background: #4f7dfb; color: white; font-weight: 600; cursor: pointer; }
  button.danger { background: #d9534f; padding: 6px 12px; font-size: 13px; }
  form { max-width: 420px; margin-bottom: 32px; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #262626; max-width: 420px; }
  a.logout { cursor: pointer; }
</style></head>
<body>
  <header>
    <strong>Piknic UZ — Admin</strong>
    <nav>${navHtml}<a class="logout" onclick="logout()">Chiqish</a></nav>
  </header>
  <main>${body}</main>
  <script>
    async function postJSON(url, data) {
      const r = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      return { ok: r.ok, ...(await r.json().catch(() => ({}))) };
    }
    async function logout() {
      await fetch('/api/admin/logout', { method: 'POST' });
      location.href = '/api/admin';
    }
  </script>
</body></html>`;
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="uz"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kirish — Piknic UZ Admin</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; background: #111; color: #eee; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  form { background: #1c1c1c; padding: 32px; border-radius: 12px; width: 300px; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  input { width: 100%; padding: 10px; margin-bottom: 12px; border-radius: 6px; border: 1px solid #333; background: #0d0d0d; color: #eee; box-sizing: border-box; }
  button { width: 100%; padding: 10px; border-radius: 6px; border: none; background: #4f7dfb; color: white; font-weight: 600; cursor: pointer; }
  .err { color: #ff6b6b; font-size: 13px; margin-bottom: 12px; }
</style></head>
<body>
  <form id="f">
    <h1>Admin panel — kirish</h1>
    ${error ? `<div class="err">Login yoki parol noto'g'ri</div>` : ''}
    <input type="text" id="username" placeholder="Login" autofocus>
    <input type="password" id="password" placeholder="Parol">
    <button type="submit">Kirish</button>
  </form>
  <script>
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const r = await fetch('/api/admin/login', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username: document.getElementById('username').value, password: document.getElementById('password').value })
      });
      if (r.ok) location.href = '/api/admin';
      else location.href = '/api/admin?error=1';
    };
  </script>
</body></html>`;
}

export default async function adminHandler(req, res, path) {
  res.setHeader('Cache-Control', 'no-store');
  const cookies = parseCookies(req.headers.cookie);
  const currentUser = verifySession(cookies.admin_session);

  if (req.method === 'POST' && path[0] === 'login') {
    const { username, password } = await readJsonBody(req);
    const ok = await checkLogin(username, password);
    if (!ok) return res.status(401).json({ error: 'invalid' });
    res.setHeader('Set-Cookie', `admin_session=${signSession(username)}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST' && path[0] === 'logout') {
    res.setHeader('Set-Cookie', 'admin_session=; HttpOnly; Path=/; Max-Age=0');
    return res.status(200).json({ ok: true });
  }

  if (!currentUser) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(loginPage(req.query.error === '1'));
  }

  if (req.method === 'POST' && path[0] === 'useradd') {
    const { username, password } = await readJsonBody(req);
    if (!username || !password || password.length < 4) return res.status(400).json({ error: 'invalid' });
    await kvHSet('admin:users', username, { passwordHash: hashPassword(password), createdAt: Date.now() });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST' && path[0] === 'userdelete') {
    const { username } = await readJsonBody(req);
    const all = await kvHGetAll('admin:users');
    if (Object.keys(all).length <= 1) return res.status(400).json({ error: 'last admin' });
    await kvHDel('admin:users', username);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST' && path[0] === 'settingsmessage') {
    const { commentReplyText } = await readJsonBody(req);
    if (!commentReplyText) return res.status(400).json({ error: 'invalid' });
    await kvSetJSONPersistent('settings:messages', { commentReplyText });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST' && path[0] === 'settingsaudio') {
    const { dataUrl } = await readJsonBody(req);
    const match = /^data:(.+);base64,(.+)$/.exec(dataUrl || '');
    if (!match) return res.status(400).json({ error: 'invalid file' });
    await kvSetRaw('settings:audio_b64', match[2]);
    await kvSetJSONPersistent('settings:audio_meta', { mimeType: match[1], updatedAt: Date.now() });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST' && path[0] === 'backfillcomments') {
    try {
      const MAX_MEDIA_PER_RUN = 4;
      const offset = Number((await readJsonBody(req)).offset) || 0;
      const allMedia = await listRecentMedia(30);
      const media = allMedia.slice(offset, offset + MAX_MEDIA_PER_RUN);
      let totalComments = 0;
      let repliedCount = 0;
      for (const m of media) {
        const comments = await listMediaComments(m.id);
        for (const c of comments) {
          totalComments++;
          const result = await handleNewComment({ id: c.id, text: c.text, from: c.from });
          if (result.replied) repliedCount++;
        }
      }
      const nextOffset = offset + media.length;
      const hasMore = nextOffset < allMedia.length;
      return res.status(200).json({
        ok: true,
        mediaChecked: media.length,
        totalComments,
        repliedCount,
        hasMore,
        nextOffset,
        totalMedia: allMedia.length,
      });
    } catch (e) {
      console.error('backfill comments error', e);
      return res.status(500).json({ error: String(e) });
    }
  }

  if (req.method === 'POST' && path[0] === 'backfilldms') {
    try {
      const conversations = await listConversations(50);
      const unanswered = [];
      for (const conv of conversations) {
        const msgs = await getConversationMessages(conv.id, 3);
        if (!msgs.length) continue;
        const last = msgs[0];
        if (last.from?.id && last.from.id !== process.env.IG_USER_ID) {
          unanswered.push({
            conversationId: conv.id,
            senderId: last.from.id,
            username: last.from.username || last.from.id,
            lastMessage: last.message || '',
            time: last.created_time || '',
          });
        }
      }
      return res.status(200).json({ ok: true, checked: conversations.length, unanswered });
    } catch (e) {
      console.error('backfill dms error', e);
      return res.status(500).json({ error: String(e) });
    }
  }

  if (req.method === 'POST' && path[0] === 'backfilldmsreply') {
    // Pages through ALL Instagram conversations (not just the most recent 50),
    // sending the one-time welcome audio to anyone we haven't contacted yet.
    try {
      const reqBody = await readJsonBody(req);
      const TIME_BUDGET_MS = 20000;
      const startedAt = Date.now();
      let cursor = reqBody.cursor || null;
      let checked = 0;
      let sentCount = 0;
      let hasMore = false;
      let nextCursor = null;

      while (true) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          hasMore = true;
          nextCursor = cursor;
          break;
        }
        const { conversations, nextCursor: fetchedCursor } = await listConversations(50, cursor);
        if (conversations.length === 0) {
          hasMore = false;
          break;
        }
        for (const conv of conversations) {
          if (Date.now() - startedAt > TIME_BUDGET_MS) {
            hasMore = true;
            nextCursor = cursor;
            break;
          }
          const msgs = await getConversationMessages(conv.id, 3);
          if (!msgs.length) continue;
          const last = msgs[0];
          if (last.from?.id && last.from.id !== process.env.IG_USER_ID) {
            checked++;
            const result = await handleFirstDirectContact(last.from.id, last.from.username || null);
            if (result.replied) sentCount++;
          }
        }
        if (hasMore) break;
        if (!fetchedCursor) {
          hasMore = false;
          break;
        }
        cursor = fetchedCursor;
      }

      return res.status(200).json({ ok: true, checked, sentCount, hasMore, nextCursor });
    } catch (e) {
      console.error('backfill dms reply error', e);
      return res.status(500).json({ error: String(e) });
    }
  }

  if (req.method === 'POST' && path[0] === 'checkleadoutcomes') {
    // For everyone who left a phone number, checks their current amoCRM lead
    // outcome (won/in-progress/lost) across all pipelines and caches it, so the
    // dashboard can show what share of leads actually convert to a sale.
    try {
      const reqBody = await readJsonBody(req);
      const offset = Number(reqBody.offset) || 0;
      const result = await checkLeadOutcomesBatch({ offset, batchSize: 5, timeBudgetMs: 20000 });
      return res.status(200).json({ ok: true, ...result });
    } catch (e) {
      console.error('checkleadoutcomes error', e);
      return res.status(500).json({ error: String(e) });
    }
  }

  if (req.method === 'POST' && path[0] === 'listmediadates') {
    try {
      const body = await readJsonBody(req);
      const days = Number(body.days) || 14;
      const allMedia = await listRecentMedia(days);
      return res.status(200).json({
        ok: true,
        media: allMedia.map((m, i) => ({ offset: i, id: m.id, timestamp: m.timestamp, caption: (m.caption || '').slice(0, 40) })),
      });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }

  if (req.method === 'POST' && path[0] === 'fixwrongreplies') {
    // Deletes every reply the bot itself has ever posted (correct or wrong text alike).
    // We no longer try to detect/repair old replies — going forward only brand new
    // incoming comments get a single reply each (see handleNewComment's per-comment guard).
    try {
      const body = await readJsonBody(req);
      const MAX_MEDIA_PER_RUN = 1;
      const TIME_BUDGET_MS = 20000; // bail out well before Vercel's own function timeout
      const startedAt = Date.now();
      const offset = Number(body.offset) || 0;
      const allMedia = await listRecentMedia(30);
      const media = allMedia.slice(offset, offset + MAX_MEDIA_PER_RUN);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      async function deleteWithRetry(id) {
        let result = await deleteComment(id);
        if (!result.ok && result.rateLimited) {
          await sleep(4000);
          result = await deleteComment(id);
        }
        return result;
      }

      let scanned = 0;
      let fixedCount = 0;
      let rateLimitedStop = false;
      let timeBudgetStop = false;
      for (const m of media) {
        if (rateLimitedStop || timeBudgetStop) break;
        const comments = await listMediaComments(m.id);
        const ownReplies = comments.filter((c) => c.from?.id === process.env.IG_USER_ID && c.parentId);

        for (const c of ownReplies) {
          if (rateLimitedStop) break;
          if (Date.now() - startedAt > TIME_BUDGET_MS) {
            timeBudgetStop = true;
            break;
          }
          scanned++;
          const result = await deleteWithRetry(c.id);
          if (result.ok) {
            fixedCount++;
            await sleep(800);
          } else if (result.rateLimited) {
            rateLimitedStop = true;
          }
        }
      }
      const stayOnSameMedia = rateLimitedStop || timeBudgetStop;
      const nextOffset = stayOnSameMedia ? offset : offset + media.length;
      const hasMore = stayOnSameMedia ? true : nextOffset < allMedia.length;
      return res.status(200).json({
        ok: true,
        mediaChecked: media.length,
        scanned,
        fixedCount,
        hasMore,
        nextOffset,
        totalMedia: allMedia.length,
        rateLimited: rateLimitedStop,
      });
    } catch (e) {
      console.error('fixwrongreplies error', e);
      return res.status(500).json({ error: String(e) });
    }
  }

  if (req.method === 'POST' && path[0] === 'backfilloldcomments') {
    // Runs old (last N days) comments through the exact same handleNewComment
    // path live traffic uses — same qualifying-comment filter, same
    // per-comment idempotency guard, same one-time audio DM, same CRM sync.
    try {
      const body = await readJsonBody(req);
      const days = Number(body.days) || 14;
      const includeAll = !!body.includeAll; // one-time backlog catch-up: reply to every comment, not just qualifying ones
      const MAX_MEDIA_PER_RUN = 1;
      const TIME_BUDGET_MS = 20000;
      const startedAt = Date.now();
      const offset = Number(body.offset) || 0;
      const allMedia = await listRecentMedia(days);
      const media = allMedia.slice(offset, offset + MAX_MEDIA_PER_RUN);

      let scanned = 0;
      let repliedCount = 0;
      let timeBudgetStop = false;
      for (const m of media) {
        if (timeBudgetStop) break;
        const comments = await listMediaComments(m.id);
        for (const c of comments) {
          if (Date.now() - startedAt > TIME_BUDGET_MS) {
            timeBudgetStop = true;
            break;
          }
          scanned++;
          const result = await handleNewComment({ id: c.id, text: c.text, from: c.from }, { skipQualifyFilter: includeAll });
          if (result.replied || result.repliedPublicOnly) repliedCount++;
        }
      }
      const nextOffset = timeBudgetStop ? offset : offset + media.length;
      const hasMore = timeBudgetStop ? true : nextOffset < allMedia.length;
      return res.status(200).json({
        ok: true,
        mediaChecked: media.length,
        scanned,
        repliedCount,
        hasMore,
        nextOffset,
        totalMedia: allMedia.length,
      });
    } catch (e) {
      console.error('backfilloldcomments error', e);
      return res.status(500).json({ error: String(e) });
    }
  }

  res.setHeader('Content-Type', 'text/html');

  if (path[0] === 'users') {
    const admins = await kvHGetAll('admin:users');
    const rows = Object.keys(admins)
      .map(
        (u) =>
          `<div class="row"><span>${u}</span>${
            Object.keys(admins).length > 1 ? `<button class="danger" onclick="del('${u}')">O'chirish</button>` : ''
          }</div>`
      )
      .join('');
    const body = `
      <h2>Adminlar</h2>
      ${rows || '<p>Hali yo\'q</p>'}
      <h2>Yangi admin qo'shish</h2>
      <form id="addf">
        <input type="text" id="nu" placeholder="Login">
        <input type="password" id="np" placeholder="Parol (kamida 4 belgi)">
        <button type="submit">Qo'shish</button>
      </form>
      <script>
        async function del(u) {
          if (!confirm("O'chirilsinmi: " + u + "?")) return;
          const r = await postJSON('/api/admin/userdelete', { username: u });
          if (r.ok) location.reload(); else alert('Xatolik: oxirgi adminni o\\'chirib bo\\'lmaydi');
        }
        document.getElementById('addf').onsubmit = async (e) => {
          e.preventDefault();
          const r = await postJSON('/api/admin/useradd', { username: document.getElementById('nu').value, password: document.getElementById('np').value });
          if (r.ok) location.reload(); else alert('Xatolik');
        };
      </script>`;
    return res.status(200).send(layout('Adminlar', body, 'users'));
  }

  if (path[0] === 'settings') {
    const messages = (await kvGetJSON('settings:messages')) || {};
    const body = `
      <h2>Kommentga ochiq javob matni</h2>
      <form id="msgf">
        <textarea id="msg" rows="3">${messages.commentReplyText || DEFAULT_REPLY_TEXT}</textarea>
        <button type="submit">Saqlash</button>
      </form>
      <h2>Ovozli xabar</h2>
      <p style="color:#999;font-size:14px">Yangi audio fayl yuklang (mp3, m4a yoki wav) — avtomatik almashtiriladi.</p>
      <form id="audiof">
        <input type="file" id="audio" accept="audio/*">
        <button type="submit">Yuklash</button>
      </form>
      <script>
        document.getElementById('msgf').onsubmit = async (e) => {
          e.preventDefault();
          const r = await postJSON('/api/admin/settingsmessage', { commentReplyText: document.getElementById('msg').value });
          if (r.ok) alert('Saqlandi'); else alert('Xatolik');
        };
        document.getElementById('audiof').onsubmit = async (e) => {
          e.preventDefault();
          const file = document.getElementById('audio').files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async () => {
            const r = await postJSON('/api/admin/settingsaudio', { dataUrl: reader.result });
            if (r.ok) alert('Yuklandi'); else alert('Xatolik');
          };
          reader.readAsDataURL(file);
        };
      </script>`;
    return res.status(200).send(layout('Sozlamalar', body, 'settings'));
  }

  if (path[0] === 'backfill') {
    const body = `
      <h2>Eski javobsiz komentlarga javob berish</h2>
      <p style="color:#999;font-size:14px">Oxirgi 14 kunlik postlardagi hali javob berilmagan komentlarga ochiq javob va (birinchi marta bo'lsa) ovozli xabar yuboradi. Har bir komentga va har bir odamga faqat bir marta javob beriladi.</p>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:14px;color:#ccc;">
        <input type="checkbox" id="includeAllChk" style="width:auto;margin:0;">
        Hammasiga javob ber (reaksiya/aloqasi yo'q komentlar ham) — belgilanmasa faqat narx/"+" ga javob beriladi
      </label>
      <button id="btnBackfillComments">Eski komentlarga javob berish</button>
      <div id="resBackfillComments" style="margin-top:16px;"></div>

      <h2 style="margin-top:40px;">Eski javoblarni o'chirish</h2>
      <p style="color:#999;font-size:14px">Botning eski postlarga yozgan BARCHA javoblarini (to'g'ri va noto'g'rilarini ham) o'chirib tashlaydi. Eski kommentlarga qayta yozilmaydi — faqat yangi kelgan kommentlarga birgina javob beriladi.</p>
      <button id="btnFix">Eski javoblarni o'chirish</button>
      <div id="resFix" style="margin-top:16px;"></div>

      <h2 style="margin-top:40px;">Javobsiz DM'larni topish</h2>
      <p style="color:#999;font-size:14px">Suhbatlarni tekshirib (shu jumladan "Message Requests" bo'limidagilar ham), oxirgi xabar mijozdan bo'lib, hali javob berilmaganlarini ro'yxat qiladi.</p>
      <button id="btnDms">DM'larni tekshirish</button>
      <button id="btnDmsReply" style="display:none;margin-left:10px;">Ularga ovozli xabar yuborish</button>
      <div id="resDms" style="margin-top:16px;"></div>

      <script>
        document.getElementById('btnBackfillComments').onclick = async () => {
          const btn = document.getElementById('btnBackfillComments');
          const resEl = document.getElementById('resBackfillComments');
          btn.disabled = true;
          let offset = 0, totalMedia = 0, scanned = 0, repliedCount = 0, mediaDone = 0;
          try {
            while (true) {
              btn.textContent = 'Tekshirilmoqda... (' + mediaDone + (totalMedia ? '/' + totalMedia : '') + ' post)';
              const includeAll = document.getElementById('includeAllChk').checked;
              const r = await postJSON('/api/admin/backfilloldcomments', { offset, days: 14, includeAll });
              if (!r.ok) {
                resEl.innerHTML = '<p style="color:#ff6b6b">Xatolik: ' + (r.error || 'nomalum') + '</p>';
                break;
              }
              totalMedia = r.totalMedia; scanned += r.scanned; repliedCount += r.repliedCount; mediaDone += r.mediaChecked;
              resEl.innerHTML = '<p>' + mediaDone + '/' + totalMedia + ' ta post tekshirildi, ' + scanned + ' ta komment ko\\'rildi, ' + repliedCount + ' tasiga javob berildi.</p>';
              if (!r.hasMore) break;
              offset = r.nextOffset;
            }
          } finally {
            btn.disabled = false; btn.textContent = 'Eski komentlarga javob berish';
          }
        };
        document.getElementById('btnFix').onclick = async () => {
          const btn = document.getElementById('btnFix');
          const resEl = document.getElementById('resFix');
          btn.disabled = true;
          let offset = 0, totalMedia = 0, scanned = 0, fixedCount = 0, mediaDone = 0;
          try {
            while (true) {
              btn.textContent = 'O\\'chirilmoqda... (' + mediaDone + (totalMedia ? '/' + totalMedia : '') + ' post)';
              const r = await postJSON('/api/admin/fixwrongreplies', { offset });
              if (!r.ok) {
                resEl.innerHTML = '<p style="color:#ff6b6b">Xatolik: ' + (r.error || 'nomalum') + '</p>';
                break;
              }
              totalMedia = r.totalMedia; scanned += r.scanned; fixedCount += r.fixedCount; mediaDone += r.mediaChecked;
              resEl.innerHTML = '<p>' + mediaDone + '/' + totalMedia + ' ta post tekshirildi, ' + scanned + ' ta eski javob topildi, ' + fixedCount + ' tasi o\\'chirildi.</p>';
              if (!r.hasMore) break;
              offset = r.nextOffset;
            }
          } finally {
            btn.disabled = false; btn.textContent = 'Eski javoblarni o\\'chirish';
          }
        };
        document.getElementById('btnDms').onclick = async () => {
          const btn = document.getElementById('btnDms');
          btn.disabled = true; btn.textContent = 'Tekshirilmoqda...';
          const r = await postJSON('/api/admin/backfilldms', {});
          btn.disabled = false; btn.textContent = 'DM\\'larni tekshirish';
          if (!r.ok) {
            document.getElementById('resDms').innerHTML = '<p style="color:#ff6b6b">Xatolik: ' + (r.error || 'nomalum') + '</p>';
            return;
          }
          const rows = (r.unanswered || []).map(function(u) {
            return '<tr><td>' + u.username + '</td><td>' + (u.lastMessage || '').slice(0,80) + '</td><td>' + new Date(u.time).toLocaleString('uz-UZ') + '</td></tr>';
          }).join('');
          document.getElementById('resDms').innerHTML =
            '<p>' + r.checked + ' ta suhbat tekshirildi, ' + (r.unanswered || []).length + ' tasi javobsiz.</p>' +
            '<table><tr><th>Foydalanuvchi</th><th>Oxirgi xabar</th><th>Vaqt</th></tr>' + (rows || '<tr><td colspan="3">Yo\\'q</td></tr>') + '</table>';
          document.getElementById('btnDmsReply').style.display = (r.unanswered || []).length ? 'inline-block' : 'none';
        };
        document.getElementById('btnDmsReply').onclick = async () => {
          const btn = document.getElementById('btnDmsReply');
          btn.disabled = true;
          let cursor = null, totalChecked = 0, totalSent = 0;
          try {
            while (true) {
              btn.textContent = 'Yuborilmoqda... (' + totalChecked + ' tekshirildi, ' + totalSent + ' yuborildi)';
              const r = await postJSON('/api/admin/backfilldmsreply', { cursor });
              if (!r.ok) { alert('Xatolik: ' + (r.error || 'nomalum')); break; }
              totalChecked += r.checked; totalSent += r.sentCount;
              if (!r.hasMore) break;
              cursor = r.nextCursor;
            }
          } finally {
            btn.disabled = false; btn.textContent = 'Ularga ovozli xabar yuborish';
          }
          alert(totalChecked + ' ta suhbat tekshirildi, ' + totalSent + ' kishiga yangi ovozli xabar yuborildi.');
          document.getElementById('btnDms').click();
        };
      </script>`;
    return res.status(200).send(layout('Eski xabarlar', body, 'backfill'));
  }

  const [replied, leads, days] = await Promise.all([
    kvHGetAll('stats:replied'),
    kvHGetAll('stats:leads'),
    kvSMembers('stats:days'),
  ]);
  // Quietly check a handful of not-yet-checked leads on every dashboard load
  // (small batch so it doesn't noticeably slow the page down).
  await checkLeadOutcomesBatch({ batchSize: 3, timeBudgetMs: 6000 }).catch(() => {});
  const leadOutcomes = (await kvGetJSON('crm:leadoutcomes')) || {};

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
  const from = req.query.from || '0000-00-00';
  const to = req.query.to || todayStr;

  const sortedDays = days.filter((d) => d >= from && d <= to).sort().reverse();
  const dayStats = await Promise.all(sortedDays.map((day) => kvHGetAll(`stats:day:${day}`)));

  let totalComments = 0, totalReplied = 0, totalLeads = 0, totalDmReplied = 0;
  const dayRows = sortedDays
    .map((day, i) => {
      const s = dayStats[i] || {};
      const comments = Number(s.comments) || 0;
      const repliedCount = Number(s.replied) || 0;
      const leadsCount = Number(s.leads) || 0;
      const dmRepliedCount = Number(s.dmReplied) || 0;
      totalComments += comments;
      totalReplied += repliedCount;
      totalLeads += leadsCount;
      totalDmReplied += dmRepliedCount;
      const replyRate = comments > 0 ? ((repliedCount / comments) * 100).toFixed(0) : '0';
      const dmReplyRate = repliedCount > 0 ? ((dmRepliedCount / repliedCount) * 100).toFixed(0) : '0';
      const convRate = repliedCount > 0 ? ((leadsCount / repliedCount) * 100).toFixed(0) : '0';
      return `<tr>
        <td>${day}</td>
        <td>${comments}</td>
        <td>${repliedCount}</td>
        <td>${replyRate}%</td>
        <td>${dmRepliedCount}</td>
        <td>${dmReplyRate}%</td>
        <td>${leadsCount}</td>
        <td>${convRate}%</td>
      </tr>`;
    })
    .join('');

  const overallReplyRate = totalComments > 0 ? ((totalReplied / totalComments) * 100).toFixed(0) : '0';
  const overallDmReplyRate = totalReplied > 0 ? ((totalDmReplied / totalReplied) * 100).toFixed(0) : '0';
  const overallConvRate = totalReplied > 0 ? ((totalLeads / totalReplied) * 100).toFixed(0) : '0';

  const repliedRows = Object.entries(replied)
    .sort((a, b) => (b[1].repliedAt || 0) - (a[1].repliedAt || 0))
    .map(
      ([id, v]) =>
        `<tr><td>${v.username || id}</td><td>${(v.commentText || '').slice(0, 60)}</td><td>${new Date(v.repliedAt).toLocaleString('uz-UZ')}</td></tr>`
    )
    .join('');
  const OUTCOME_LABELS = { sotib_oldi: 'Sotib oldi ✅', jarayonda: 'Jarayonda', yopilgan: 'Yopilgan', topilmadi: "CRM'da topilmadi" };
  // Old cache entries were plain strings; normalize everything to {outcome, price}.
  function normalizeOutcome(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') return { outcome: raw, price: 0 };
    return raw;
  }
  const leadEntries = Object.entries(leads);
  const normalizedOutcomes = {};
  for (const [id] of leadEntries) normalizedOutcomes[id] = normalizeOutcome(leadOutcomes[id]);
  const wonCount = leadEntries.filter(([id]) => normalizedOutcomes[id]?.outcome === 'sotib_oldi').length;
  const checkedCount = leadEntries.filter(([id]) => normalizedOutcomes[id]).length;
  const wonRate = checkedCount > 0 ? ((wonCount / checkedCount) * 100).toFixed(0) : '0';
  const totalSalesAmount = leadEntries.reduce((sum, [id]) => sum + (normalizedOutcomes[id]?.price || 0), 0);
  const leadRows = leadEntries
    .sort((a, b) => (b[1].capturedAt || 0) - (a[1].capturedAt || 0))
    .map(([id, v]) => {
      const o = normalizedOutcomes[id];
      const label = o ? (OUTCOME_LABELS[o.outcome] || o.outcome) : 'Tekshirilmagan';
      const priceStr = o?.price ? ' (' + o.price.toLocaleString('uz-UZ') + " so'm)" : '';
      return `<tr><td>${v.username || id}</td><td>${v.phone}</td><td>${new Date(v.capturedAt).toLocaleString('uz-UZ')}</td><td>${label}${priceStr}</td></tr>`;
    })
    .join('');

  function isoDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
  }

  const body = `
    <div class="filters">
      <a href="/api/admin?from=${todayStr}&to=${todayStr}" class="${from === todayStr && to === todayStr ? 'active' : ''}">Bugun</a>
      <a href="/api/admin?from=${isoDaysAgo(6)}&to=${todayStr}" class="${from === isoDaysAgo(6) && to === todayStr ? 'active' : ''}">Oxirgi 7 kun</a>
      <a href="/api/admin?from=${isoDaysAgo(29)}&to=${todayStr}" class="${from === isoDaysAgo(29) && to === todayStr ? 'active' : ''}">Oxirgi 30 kun</a>
      <a href="/api/admin?from=0000-00-00&to=${todayStr}" class="${from === '0000-00-00' ? 'active' : ''}">Barchasi</a>
      <form id="rangef">
        <input type="date" id="fromInput" value="${from === '0000-00-00' ? '' : from}">
        <span>—</span>
        <input type="date" id="toInput" value="${to}">
        <button type="submit">Ko'rish</button>
      </form>
    </div>
    <div class="cards">
      <div class="card"><div class="num">${totalComments}</div><div class="label">Jami kommentlar</div></div>
      <div class="card"><div class="num">${totalReplied}</div><div class="label">Javob berilgan (${overallReplyRate}%)</div></div>
      <div class="card"><div class="num">${totalDmReplied}</div><div class="label">Direktga javob berdi (${overallDmReplyRate}%)</div></div>
      <div class="card"><div class="num">${totalLeads}</div><div class="label">Raqam qoldirgan (${overallConvRate}%)</div></div>
      <div class="card"><div class="num">${wonCount}</div><div class="label">Sotib oldi (${wonRate}% tekshirilganlardan)</div></div>
      <div class="card"><div class="num">${totalSalesAmount.toLocaleString('uz-UZ')}</div><div class="label">Jami savdo summasi (so'm)</div></div>
    </div>
    <h2>Kunlik statistika</h2>
    <p style="color:#999;font-size:14px">"Direktga javob berdi" — ovozli xabar yuborilgandan keyin o'sha kishi Direct orqali javob yozganlar (raqam qoldirganlar ham shu songa kiradi).</p>
    <table>
      <tr><th>Sana</th><th>Kommentlar</th><th>Javob berildi</th><th>Javob %</th><th>Direktga javob berdi</th><th>Direkt javob %</th><th>Raqam qoldirdi</th><th>Konversiya %</th></tr>
      ${dayRows || '<tr><td colspan="8">Hali yo\'q</td></tr>'}
    </table>
    <h2>Raqam qoldirganlar (batafsil)</h2>
    <p style="color:#999;font-size:14px">"CRM holati" — AmoCRM'dagi joriy bosqichi (istalgan pipeline bo'yicha). Har safar sahifa ochilganda avtomatik ozgina yangilanib boradi.</p>
    <table><tr><th>Foydalanuvchi</th><th>Raqam</th><th>Vaqt</th><th>CRM holati</th></tr>${leadRows || '<tr><td colspan="4">Hali yo\'q</td></tr>'}</table>
    <h2>Javob berilganlar (batafsil)</h2>
    <table><tr><th>Foydalanuvchi</th><th>Komment</th><th>Vaqt</th></tr>${repliedRows || '<tr><td colspan="3">Hali yo\'q</td></tr>'}</table>
    <script>
      document.getElementById('rangef').onsubmit = (e) => {
        e.preventDefault();
        const f = document.getElementById('fromInput').value || '0000-00-00';
        const t = document.getElementById('toInput').value;
        location.href = '/api/admin?from=' + f + '&to=' + t;
      };
    </script>`;
  return res.status(200).send(layout('Statistika', body, ''));
}
