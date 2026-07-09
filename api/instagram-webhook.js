import crypto from 'node:crypto';
import { kvGetJSON, kvSetJSON } from './_lib/kv.js';

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
  const resText = await r.text();
  if (!r.ok) {
    console.error('Instagram send error:', r.status, resText);
  } else {
    console.log('Instagram send ok:', resText);
  }
  return r;
}

function sendPrivateReplyAudio(commentId, audioUrl) {
  return sendToInstagram({
    recipient: { comment_id: commentId },
    message: { attachment: { type: 'audio', payload: { url: audioUrl, is_reusable: true } } },
  });
}

async function sendPublicCommentReply(commentId, text) {
  const token = process.env.IG_ACCESS_TOKEN;
  const r = await fetch(
    `https://graph.instagram.com/v21.0/${commentId}/replies?access_token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    }
  );
  const resText = await r.text();
  if (!r.ok) {
    console.error('Instagram comment reply error:', r.status, resText);
  } else {
    console.log('Instagram comment reply ok:', resText);
  }
  return r;
}

async function handleComment(value) {
  console.log('handleComment received:', JSON.stringify(value));
  if (!value?.id || !value?.from?.id) {
    console.log('handleComment skipped: missing id or from.id');
    return;
  }
  if (value.from.id === process.env.IG_USER_ID) {
    console.log('handleComment skipped: comment authored by our own account');
    return;
  }
  const stateKey = `ig:${value.from.id}`;
  const existing = await kvGetJSON(stateKey);
  if (existing) return; // already engaged with this user, avoid re-greeting on every comment

  await kvSetJSON(stateKey, { repliedAt: Date.now() });

  await sendPublicCommentReply(value.id, "Assalomu alaykum. Sizga direct'dan javob yubordim! 😊");

  const audioUrl = process.env.WELCOME_AUDIO_URL;
  if (audioUrl) await sendPrivateReplyAudio(value.id, audioUrl);
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

  console.log('Webhook body:', JSON.stringify(body));

  if (body.object === 'instagram') {
    try {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          console.log('Change field:', change.field);
          if (change.field === 'comments') await handleComment(change.value);
        }
      }
    } catch (e) {
      // Vercel function must still ack 200 so Meta doesn't retry-storm the webhook
      console.error('Instagram webhook processing error:', e);
    }
  }

  return res.status(200).json({ received: true });
}
