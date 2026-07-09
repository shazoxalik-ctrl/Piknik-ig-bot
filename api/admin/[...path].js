import adminHandler from '../_lib/admin-handler.js';

export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  const raw = req.query.path ?? req.query['...path'];
  let path;
  if (Array.isArray(raw)) path = raw;
  else if (typeof raw === 'string') path = raw.split('/').filter(Boolean);
  else path = [];
  return adminHandler(req, res, path);
}
