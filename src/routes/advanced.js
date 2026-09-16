// 点播管理、套餐管理、设备授权/列表
import express from 'express';
import { getDb, getSetting } from '../store.js';
import { requireAuth } from '../auth.js';
import { generateM3U } from '../m3u.js';
import crypto from 'crypto';
import { tokenHash, authenticatedDevice, deviceAllowed, rateLimit } from '../device-auth.js';

const router = express.Router();
const db = () => getDb();

function parseMealGroups(meal, groupNames = []) {
  if (!meal?.content) return [];
  try {
    const parsed = JSON.parse(meal.content);
    if (Array.isArray(parsed)) return parsed.filter(name => groupNames.includes(name));
  } catch {}
  // 兼容旧版以分组下标保存的逗号字符串。
  return meal.content.split(',').map(value => {
    const item = value.trim();
    if (groupNames.includes(item)) return item;
    const index = Number(item);
    return Number.isInteger(index) ? groupNames[index] : '';
  }).filter(Boolean);
}

// ============ 点播管理 ============

router.get('/movies', requireAuth, (req, res) => {
  const rows = db().prepare('SELECT * FROM movies ORDER BY id').all();
  res.json({ code: 0, data: rows });
});

router.post('/movies', requireAuth, (req, res) => {
  const { name, api } = req.body || {};
  if (!api) return res.status(400).json({ code: 1, msg: '接口地址必填' });
  const info = db().prepare('INSERT INTO movies (name, api) VALUES (?, ?)').run(name || api, api);
  res.json({ code: 0, data: { id: info.lastInsertRowid } });
});

router.put('/movies/:id', requireAuth, (req, res) => {
  const { name, api, state } = req.body || {};
  const cur = db().prepare('SELECT * FROM movies WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ code: 1, msg: '不存在' });
  db().prepare('UPDATE movies SET name=?, api=?, state=? WHERE id=?')
    .run(name ?? cur.name, api ?? cur.api, state ?? cur.state, req.params.id);
  res.json({ code: 0, msg: 'ok' });
});

router.delete('/movies/:id', requireAuth, (req, res) => {
  db().prepare('DELETE FROM movies WHERE id=?').run(req.params.id);
  res.json({ code: 0, msg: 'ok' });
});

// ============ 套餐管理 ============

router.get('/meals', requireAuth, (req, res) => {
  const meals = db().prepare('SELECT * FROM meals ORDER BY id').all();
  const groups = db().prepare('SELECT group_name, COUNT(*) as c FROM channels GROUP BY group_name ORDER BY group_name').all();
  const groupNames = groups.map(g => g.group_name);
  for (const m of meals) {
    m.groups = parseMealGroups(m, groupNames);
    m.ca_name = m.groups.length ? m.groups.join('、') : '全部频道';
  }
  res.json({ code: 0, data: meals });
});

router.post('/meals', requireAuth, (req, res) => {
  const { name, content, groups } = req.body || {};
  if (!name) return res.status(400).json({ code: 1, msg: '套餐名称必填' });
  const rssKey = crypto.randomBytes(8).toString('hex');
  const info = db().prepare('INSERT INTO meals (name, content, rss_key) VALUES (?, ?, ?)')
    .run(name, Array.isArray(groups) ? JSON.stringify(groups) : (content || ''), rssKey);
  res.json({ code: 0, data: { id: info.lastInsertRowid, rss_key: rssKey } });
});

router.put('/meals/:id', requireAuth, (req, res) => {
  const { name, content, groups, status } = req.body || {};
  const cur = db().prepare('SELECT * FROM meals WHERE id=?').get(req.params.id);
  if (!cur) return res.status(404).json({ code: 1, msg: '不存在' });
  db().prepare('UPDATE meals SET name=?, content=?, status=? WHERE id=?')
    .run(name ?? cur.name, Array.isArray(groups) ? JSON.stringify(groups) : (content ?? cur.content), status ?? cur.status, req.params.id);
  res.json({ code: 0, msg: 'ok' });
});

router.delete('/meals/:id', requireAuth, (req, res) => {
  db().prepare('DELETE FROM meals WHERE id=?').run(req.params.id);
  res.json({ code: 0, msg: 'ok' });
});

// 刷新订阅 KEY
router.post('/meals/:id/rsskey', requireAuth, (req, res) => {
  const rssKey = crypto.randomBytes(8).toString('hex');
  db().prepare('UPDATE meals SET rss_key=? WHERE id=?').run(rssKey, req.params.id);
  res.json({ code: 0, data: { rss_key: rssKey } });
});

// 订阅地址（公开，供播放器用 key 拉取）
router.get('/rss/:key', (req, res) => {
  const meal = db().prepare('SELECT * FROM meals WHERE rss_key=?').get(req.params.key);
  if (!meal || meal.status !== 1) return res.status(404).json({ code: 1, msg: '订阅不存在' });
  // 按套餐内容过滤频道
  let channels = db().prepare('SELECT * FROM channels WHERE enabled=1').all();
  const groupNames = db().prepare('SELECT DISTINCT group_name FROM channels ORDER BY group_name').all().map(g => g.group_name);
  const allowed = parseMealGroups(meal, groupNames);
  if (allowed.length) {
    channels = channels.filter(c => allowed.includes(c.group_name));
  }
  const m3u = generateM3U(channels);
  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.send(m3u);
});

// ============ 设备授权 / 列表 ============

function deviceToShow(d) {
  delete d.token_hash;
  const meal = d.meal_id ? db().prepare('SELECT name FROM meals WHERE id=?').get(d.meal_id) : null;
  let expDesc = '', expDays = '未授权';
  if (d.meal_id && !d.exp_at) {
    expDesc = '永久';
    expDays = '永久';
  } else if (d.exp_at) {
    const days = Math.ceil((d.exp_at - Date.now() / 1000) / 86400);
    expDesc = new Date(d.exp_at * 1000).toLocaleDateString('zh-CN');
    expDays = days > 0 ? days + '天' : '已过期';
  }
  return {
    ...d,
    meal_name: meal ? meal.name : '',
    exp_desc: expDesc,
    exp_days: expDays,
    last_time_str: d.last_time ? new Date(d.last_time * 1000).toLocaleString('zh-CN') : '',
  };
}

// 设备列表（已授权）
router.get('/devices', requireAuth, (req, res) => {
  const { keywords = '' } = req.query;
  let sql = 'SELECT * FROM devices WHERE meal_id>0';
  let params = [];
  if (keywords) { sql += ' AND (name LIKE ? OR device_id LIKE ? OR model LIKE ?)'; params = [`%${keywords}%`, `%${keywords}%`, `%${keywords}%`]; }
  sql += ' ORDER BY last_time DESC';
  const rows = db().prepare(sql).all(...params).map(deviceToShow);
  res.json({ code: 0, data: rows });
});

// 待授权列表（device 无 meal 或未绑定）
router.get('/devices/unauthorized', requireAuth, (req, res) => {
  const rows = db().prepare('SELECT * FROM devices WHERE meal_id=0 ORDER BY created_at DESC').all().map(deviceToShow);
  res.json({ code: 0, data: rows });
});

// 授权/更新设备（绑定套餐 + 到期时间 + 备注）
router.post('/devices', requireAuth, (req, res) => {
  const { name, device_id, model, ip, region, meal_id, exp_at, marks } = req.body || {};
  if (!device_id) return res.status(400).json({ code: 1, msg: '设备ID必填' });
  const existing = db().prepare('SELECT * FROM devices WHERE device_id=?').get(device_id);
  if (existing) {
    db().prepare(`UPDATE devices SET name=?, model=?, ip=?, region=?, meal_id=?, exp_at=?, marks=? WHERE device_id=?`)
      .run(name ?? existing.name, model ?? existing.model, ip ?? existing.ip, region ?? existing.region,
        meal_id ?? existing.meal_id, exp_at ?? existing.exp_at, marks ?? existing.marks, device_id);
    return res.json({ code: 0, data: { id: existing.id } });
  }
  const info = db().prepare('INSERT INTO devices (name, device_id, model, ip, region, meal_id, exp_at, marks) VALUES (?,?,?,?,?,?,?,?)')
    .run(name || '', device_id, model || '', ip || '', region || '', meal_id || 0, exp_at || 0, marks || '');
  res.json({ code: 0, data: { id: info.lastInsertRowid } });
});

// Family approval: no subscription configuration required.
router.post('/devices/:id/approve', requireAuth, (req,res) => {
  const d=db().prepare('SELECT id FROM devices WHERE id=?').get(req.params.id);
  if(!d) return res.status(404).json({code:1,msg:'设备不存在'});
  let meal=db().prepare("SELECT id FROM meals WHERE name='家庭设备' AND content='' AND status=1").get();
  if(!meal) { const row=db().prepare("INSERT INTO meals(name,content,rss_key) VALUES ('家庭设备','',?)").run(crypto.randomBytes(24).toString('hex')); meal={id:row.lastInsertRowid}; }
  db().prepare('UPDATE devices SET meal_id=?, exp_at=0 WHERE id=?').run(meal.id,d.id);
  res.json({code:0,msg:'已允许家庭设备'});
});
router.post('/devices/:id/revoke', requireAuth, (req,res) => {
  db().prepare('UPDATE devices SET meal_id=0, exp_at=0 WHERE id=?').run(req.params.id);
  res.json({code:0,msg:'已撤销授权'});
});

// 批量授权（选中多个 device_id）
router.post('/devices/batch', requireAuth, (req, res) => {
  const { ids, meal_id, exp_days } = req.body || {};
  if (!ids || !ids.length) return res.status(400).json({ code: 1, msg: '未选中设备' });
  const exp_at = exp_days ? (Date.now() / 1000 | 0) + exp_days * 86400 : 0;
  const stmt = db().prepare('UPDATE devices SET meal_id=?, exp_at=? WHERE device_id=?');
  for (const id of ids) stmt.run(meal_id || 0, exp_at, id);
  res.json({ code: 0, msg: `已授权 ${ids.length} 台设备` });
});

// 删除设备
router.delete('/devices/:id', requireAuth, (req, res) => {
  db().prepare('DELETE FROM devices WHERE id=?').run(req.params.id);
  res.json({ code: 0, msg: 'ok' });
});

// 设备上报心跳（公开，供 APK 连接）
router.post('/device/heartbeat', rateLimit(60), (req, res) => {
  const { name, device_id, model, region } = req.body || {};
  if (typeof device_id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(device_id)) return res.status(400).json({code:1,msg:'设备 ID 格式错误'});
  const secret = String(req.headers['x-device-token'] || '');
  if (!/^[a-f0-9]{64}$/.test(secret)) return res.status(401).json({code:401,msg:'请安装 2.2.0 或更新版本 APK 后重新连接'});
  for (const field of [name,model,region]) if (field != null && (typeof field !== 'string' || field.length > 160)) return res.status(400).json({code:1,msg:'设备信息过长'});
  const ip = req.ip || req.socket?.remoteAddress || '';
  const existing = db().prepare('SELECT * FROM devices WHERE device_id=?').get(device_id);
  const now = Date.now() / 1000 | 0;
  if (existing && authenticatedDevice(req)?.device_id !== device_id) return res.status(401).json({code:401,msg:'设备凭据不匹配，请重置设备身份并重新授权'});
  if (!existing && db().prepare('SELECT COUNT(*) AS n FROM devices WHERE meal_id=0').get().n >= 200) return res.status(429).json({code:429,msg:'待授权设备已满，请管理员清理'});
  if (existing) {
    db().prepare('UPDATE devices SET name=?, model=?, ip=?, region=?, last_time=? WHERE device_id=?')
      .run(name ?? existing.name, model ?? existing.model, ip ?? existing.ip, region ?? existing.region, now, device_id);
  } else {
    db().prepare('INSERT INTO devices (name, device_id, model, ip, region, last_time, token_hash) VALUES (?,?,?,?,?,?,?)')
      .run(name || '', device_id, model || '', ip || '', region || '', now, tokenHash(secret));
  }
  // 返回是否授权
  const d = db().prepare('SELECT * FROM devices WHERE device_id=?').get(device_id);
  const authorizationRequired = getSetting('client_needauthor', '1') === '1';
  const authorized = !authorizationRequired || deviceAllowed(d);
  res.json({ code: 0, data: {
    authorized,
    authorization_required: authorizationRequired,
    exp_at: d.exp_at,
    meal_id: d.meal_id,
    notice: getSetting('ad_text', ''),
    tips: {
      user_expired: getSetting('tip_userexpired', '订阅已过期'),
      user_forbidden: getSetting('tip_userforbidden', '设备已被禁用'),
      user_noreg: getSetting('tip_usernoreg', '设备未授权'),
    },
  } });
});

export { parseMealGroups };

export default router;
