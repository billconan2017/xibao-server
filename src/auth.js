// 鉴权中间件
import { getDb } from './store.js';

// 从请求中取 session token（Cookie 或 Authorization header）
export function getToken(req) {
  // Authorization: Bearer xxx
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  // Cookie: session=xxx
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)xibao_session=([^;]+)/);
  return m ? m[1] : null;
}

// 校验 session，返回 user 或 null
export function getAuthUser(req) {
  const token = getToken(req);
  if (!token) return null;
  const db = getDb();
  const row = db.prepare(
    `SELECT u.id, u.username, s.expires_at FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`
  ).get(token);
  if (!row) return null;
  if (row.expires_at < (Date.now() / 1000 | 0)) {
    db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  return { id: row.id, username: row.username };
}

// 需要登录的中间件
export function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ code: 401, msg: '未登录' });
    }
    return res.redirect('/login');
  }
  req.user = user;
  next();
}
