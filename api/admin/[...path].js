import adminHandler from '../_lib/admin-handler.js';

export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  console.log('admin catch-all debug:', req.method, req.url, JSON.stringify(req.query), JSON.stringify(path));
  return adminHandler(req, res, path);
}
