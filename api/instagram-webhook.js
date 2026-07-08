import crypto from 'node:crypto';
import { kvGetJSON, kvSetJSON } from './_lib/kv.js';
import { runConversation } from './_lib/claude.js';
import { createAmoLead, notifyTelegram } from './_lib/amocrm.js';

export const config = { api: { bodyParser: false } };

const GRAPH_URL = `https://graph.instagram.com/v21.0/${process.env.IG_USER_ID}/messages`;

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function verifySignature(rawBody, signatureHeader) {
  const appSecret = process.env.IG_APP_SECRET;
  if (!appSecret) return true; // signature check skipped if not configured
  if (!signatureHeader) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendToInstagram(body) {
  const token = process.env.IG_ACCESS_TOKEN;
  const r = await fetch(`${GRAPH_URL}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text();
    console.error('Instagram send error:', errText);
  }
  return r;
}

function sendPrivateReply(commentId, text) {
  return sendToInstagram({ recipient: { comment_id: commentId }, message: { text } });
}

function sendDirectMessage(recipientId, text) {
  return sendToInstagram({ recipient: { id: recipientId }, message: { text } });
}

function normalizePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits : null;
}

async function handleComment(value) {
  if (!value?.id || !value?.from?.id) return;
  const stateKey = `ig:${value.from.id}`;
  const existing = await kvGetJSON(stateKey);
  if (existing) return; // already engaged with this user, avoid re-greeting on every comment

  await kvSetJSON(stateKey, { history: [], commentText: value.text || '', mediaId: value.media?.id || null });

  const opener =
    "Salom! 👋 Videodagi mahsulot haqida savollaringiz bo'lsa shu yerga yozing — narxi va tafsilotlarini albatta aytib beraman 😊";
  await sendPrivateReply(value.id, opener);
}

async function handleMessagingEvent(event) {
  const senderId = event.sender?.id;
  const message = event.message;
  if (!senderId || !message || message.is_echo) return;

  const text = message.text;
  if (!text) {
    await sendDirectMessage(senderId, "Iltimos, savolingizni matn ko'rinishida yozing 🙂");
    return;
  }

  const stateKey = `ig:${senderId}`;
  const state = (await kvGetJSON(stateKey)) || { history: [] };

  if (state.leadCaptured) {
    await sendDirectMessage(senderId, "Rahmat! Ma'lumotlaringiz qabul qilindi, tez orada operatorimiz siz bilan bog'lanadi 📞");
    return;
  }

  const history = [...state.history, { role: 'user', content: text }];
  const { reply, lead, assistantContent } = await runConversation(history);
  history.push({ role: 'assistant', content: assistantContent });

  if (lead) {
    const phone = normalizePhone(lead.phone);
    if (phone && lead.name) {
      await createAmoLead({
        name: lead.name,
        phone,
        leadName: `${lead.product || 'Mahsulot'}${lead.price ? ' — ' + lead.price : ''} (Instagram)`,
        price: lead.price,
        sourceName: 'Instagram DM',
      });
      await notifyTelegram(
        `📸 Instagram DM orqali yangi lead!\n\n👤 Ism: ${lead.name}\n📞 Telefon: ${phone}\n📦 Mahsulot: ${lead.product || '-'}`
      );
      state.leadCaptured = true;
    }
  }

  state.history = history;
  await kvSetJSON(stateKey, state);

  if (reply) await sendDirectMessage(senderId, reply);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.IG_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await readRawBody(req);
  if (!verifySignature(rawBody, req.headers['x-hub-signature-256'])) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  if (body.object === 'instagram') {
    try {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'comments') await handleComment(change.value);
        }
        for (const event of entry.messaging || []) {
          await handleMessagingEvent(event);
        }
      }
    } catch (e) {
      // Vercel function must still ack 200 so Meta doesn't retry-storm the webhook
      console.error('Instagram webhook processing error:', e);
    }
  }

  return res.status(200).json({ received: true });
}
