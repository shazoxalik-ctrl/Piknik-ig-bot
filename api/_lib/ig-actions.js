import { kvGetJSON, kvSetJSON, kvHSet, kvHIncrBy, kvSAdd } from './kv.js';

const GRAPH_URL = `https://graph.instagram.com/v21.0/${process.env.IG_USER_ID}/messages`;

async function sendToInstagram(body) {
  const token = process.env.IG_ACCESS_TOKEN;
  const r = await fetch(`${GRAPH_URL}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const resText = await r.text();
  if (!r.ok) console.error('Instagram send error:', r.status, resText);
  return r;
}

export function sendPrivateReplyAudio(commentId, audioUrl) {
  return sendToInstagram({
    recipient: { comment_id: commentId },
    message: { attachment: { type: 'audio', payload: { url: audioUrl, is_reusable: true } } },
  });
}

export function sendDirectAudio(recipientId, audioUrl) {
  return sendToInstagram({
    recipient: { id: recipientId },
    message: { attachment: { type: 'audio', payload: { url: audioUrl, is_reusable: true } } },
  });
}

export async function sendPublicCommentReply(commentId, text) {
  const token = process.env.IG_ACCESS_TOKEN;
  const r = await fetch(
    `https://graph.instagram.com/v21.0/${commentId}/replies?access_token=${encodeURIComponent(token)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) }
  );
  const resText = await r.text();
  if (!r.ok) console.error('Instagram comment reply error:', r.status, resText);
  return r;
}

export function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
}

export async function handleNewComment(value) {
  if (!value?.id || !value?.from?.id) return { skipped: 'missing id' };
  if (value.from.id === process.env.IG_USER_ID) return { skipped: 'own account' };

  const day = todayKey();
  await kvSAdd('stats:days', day);
  await kvHIncrBy(`stats:day:${day}`, 'comments');

  const username = value.from.username || null;

  // Every new comment gets a public reply, even if this user has commented before.
  const messages = (await kvGetJSON('settings:messages')) || {};
  const replyText = messages.commentReplyText || "Assalomu alaykum. Sizga direct'dan javob yubordim! 😊";
  await sendPublicCommentReply(value.id, replyText);

  const stateKey = `ig:${value.from.id}`;
  const existing = await kvGetJSON(stateKey);
  if (existing) return { repliedPublicOnly: true, username };

  // First time this user interacts with us — send the welcome audio DM once.
  const repliedAt = Date.now();
  await kvSetJSON(stateKey, { repliedAt, username });
  await kvHSet('stats:replied', value.from.id, { username, commentText: value.text || '', repliedAt });
  await kvHIncrBy(`stats:day:${day}`, 'replied');

  const audioUrl = process.env.WELCOME_AUDIO_URL;
  if (audioUrl) await sendPrivateReplyAudio(value.id, audioUrl);

  return { replied: true, username };
}

// Called when someone messages us directly (e.g. via Message Requests) without
// ever having commented first. Sends the same welcome audio, once per user.
export async function handleFirstDirectContact(senderId) {
  const stateKey = `ig:${senderId}`;
  const existing = await kvGetJSON(stateKey);
  if (existing) return { skipped: 'already contacted' };

  const day = todayKey();
  await kvSAdd('stats:days', day);
  const repliedAt = Date.now();
  await kvSetJSON(stateKey, { repliedAt, username: null });
  await kvHSet('stats:replied', senderId, { username: null, commentText: '(Direct orqali)', repliedAt });
  await kvHIncrBy(`stats:day:${day}`, 'replied');

  const audioUrl = process.env.WELCOME_AUDIO_URL;
  if (audioUrl) await sendDirectAudio(senderId, audioUrl);

  return { replied: true };
}
