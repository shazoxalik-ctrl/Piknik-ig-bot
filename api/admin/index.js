import adminHandler from '../_lib/admin-handler.js';

export const config = { api: { bodyParser: false } };

export default function handler(req, res) {
  return adminHandler(req, res, []);
}
