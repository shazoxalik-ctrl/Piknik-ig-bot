import adminHandler from '../_lib/admin-handler.js';

export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
  return adminHandler(req, res, path);
}
