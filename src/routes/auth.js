// 认证路由：登录/登出/改密码
import express from 'express';
import { getDb, verifyPassword, hashPassword, createSession } from '../store.js';
import { requireAuth } from '../auth.js';

const router = express.Router();

// 登录
router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ code: 1, msg: '用户名和密码不能为空' });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ code: 1, msg: '用户名或密码错误' });
  }

  const session = createSession(user.id);
  // 通过 Cookie 下发 session（前端 fetch 也会用）
  res.cookie('xibao_session', session.token, {
    httpOnly: true,
    maxAge: 7 * 24 * 3600 * 1000,
    sameSite: 'lax',
  });
  res.json({ code: 0, data: { token: session.token, username: user.username } });
});

// 登出
router.post('/auth/logout', (req, res) => {
  const db = getDb();
  const token = req.body?.token || (req.headers.cookie || '').match(/xibao_session=([^;]+)/)?.[1];
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.clearCookie('xibao_session');
  res.json({ code: 0, msg: '已退出' });
});

// 当前用户信息
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ code: 0, data: { id: req.user.id, username: req.user.username } });
});

// 修改密码
router.post('/auth/password', requireAuth, (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) {
    return res.status(400).json({ code: 1, msg: '参数缺失' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ code: 1, msg: '新密码至少 6 位' });
  }
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!verifyPassword(old_password, user.password_hash)) {
    return res.status(401).json({ code: 1, msg: '原密码错误' });
  }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(new_password), req.user.id);
  res.json({ code: 0, msg: '密码已修改' });
});

export default router;
