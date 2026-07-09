const IG_USER_ID = process.env.IG_USER_ID;

function token() {
  return process.env.IG_ACCESS_TOKEN;
}

export async function listRecentMedia(sinceDays = 30, limit = 50) {
  const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const url = `https://graph.instagram.com/v21.0/${IG_USER_ID}/media?fields=id,timestamp,caption&limit=${limit}&access_token=${encodeURIComponent(token())}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) {
    console.error('listRecentMedia error', JSON.stringify(data));
    return [];
  }
  const items = data.data || [];
  return items.filter((m) => new Date(m.timestamp).getTime() >= since);
}

export async function listMediaComments(mediaId) {
  const url = `https://graph.instagram.com/v21.0/${mediaId}/comments?fields=id,text,timestamp,username,from&limit=100&access_token=${encodeURIComponent(token())}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) {
    console.error('listMediaComments error', JSON.stringify(data));
    return [];
  }
  return (data.data || []).map((c) => ({
    id: c.id,
    text: c.text,
    from: c.from || { id: c.from_id || c.id, username: c.username },
  }));
}

export async function listConversations(limit = 50) {
  const url = `https://graph.instagram.com/v21.0/${IG_USER_ID}/conversations?platform=instagram&limit=${limit}&access_token=${encodeURIComponent(token())}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) {
    console.error('listConversations error', JSON.stringify(data));
    return [];
  }
  return data.data || [];
}

export async function getConversationMessages(conversationId, limit = 3) {
  const url = `https://graph.instagram.com/v21.0/${conversationId}/messages?fields=id,from,to,message,created_time&limit=${limit}&access_token=${encodeURIComponent(token())}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) {
    console.error('getConversationMessages error', JSON.stringify(data));
    return [];
  }
  return data.data || [];
}
