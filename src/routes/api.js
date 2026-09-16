// API 路由
import express from 'express';
import { getDb } from '../store.js';
import { parseM3U, mergeChannels, generateM3U } from '../m3u.js';
import { syncAllSources } from '../source.js';
import { requireAuth } from '../auth.js';

const router = express.Router();

// ============ 频道管理 ============

// 列出所有频道（支持 group 过滤、搜索）
router.get('/channels', (req, res) => {
  const db = getDb();
  const { group, search, enabled } = req.query;

  let sql = 'SELECT * FROM channels WHERE 1=1';
  const params = [];

  if (group) {
    sql += ' AND group_name = ?';
    params.push(group);
  }
  if (search) {
    sql += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }
  if (enabled !== undefined) {
    sql += ' AND enabled = ?';
    params.push(enabled === '1' ? 1 : 0);
  }

  sql += ' ORDER BY sort_order, id';
  const channels = db.prepare(sql).all(...params);
  res.json({ code: 0, data: channels });
});

// 分组列表
router.get('/groups', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT group_name, COUNT(*) as count FROM channels WHERE enabled=1 GROUP BY group_name ORDER BY group_name'
  ).all();
  res.json({ code: 0, data: rows });
});

// 新增频道
router.post('/channels', requireAuth, (req, res) => {
  const db = getDb();
  const { name, url, group_name, tvg_id, tvg_logo, tvg_name, sort_order } = req.body;
  if (!name || !url) return res.status(400).json({ code: 1, msg: 'name 和 url 必填' });

  const info = db.prepare(
    `INSERT INTO channels (name, url, group_name, tvg_id, tvg_logo, tvg_name, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name, url,
    group_name || '未分组',
    tvg_id || name,
    tvg_logo || '',
    tvg_name || name,
    sort_order || 0
  );
  res.json({ code: 0, data: { id: info.lastInsertRowid } });
});

// 批量更新频道
router.put('/channels/:id', requireAuth, (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { name, url, group_name, tvg_id, tvg_logo, tvg_name, sort_order, enabled } = req.body;

  const existing = db.prepare('SELECT * FROM channels WHERE id=?').get(id);
  if (!existing) return res.status(404).json({ code: 1, msg: '频道不存在' });

  db.prepare(
    `UPDATE channels SET 
       name=?, url=?, group_name=?, tvg_id=?, tvg_logo=?, tvg_name=?, sort_order=?, enabled=?,
       updated_at=strftime('%s','now')
     WHERE id=?`
  ).run(
    name ?? existing.name,
    url ?? existing.url,
    group_name ?? existing.group_name,
    tvg_id ?? existing.tvg_id,
    tvg_logo ?? existing.tvg_logo,
    tvg_name ?? existing.tvg_name,
    sort_order ?? existing.sort_order,
    enabled ?? existing.enabled,
    id
  );
  res.json({ code: 0, msg: 'ok' });
});

// 删除频道
router.delete('/channels/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM channels WHERE id=?').run(req.params.id);
  res.json({ code: 0, msg: 'ok' });
});

// ============ 直播源管理 ============

// 源列表
router.get('/sources', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM sources ORDER BY id').all();
  res.json({ code: 0, data: rows });
});

// 添加源
router.post('/sources', requireAuth, (req, res) => {
  const db = getDb();
  const { name, url, type } = req.body;
  if (!url) return res.status(400).json({ code: 1, msg: 'url 必填' });

  try {
    const info = db.prepare(
      `INSERT INTO sources (name, url, type) VALUES (?, ?, ?)`
    ).run(name || url, url, type || 'm3u');
    res.json({ code: 0, data: { id: info.lastInsertRowid } });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return res.status(400).json({ code: 1, msg: '该源已存在' });
    }
    throw e;
  }
});

// 删除源
router.delete('/sources/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM sources WHERE id=?').run(req.params.id);
  res.json({ code: 0, msg: 'ok' });
});

// ============ 同步 ============

// 触发全量同步：拉所有源 → 合并去重 → 入库
router.post('/sync', requireAuth, async (req, res) => {
  const db = getDb();
  const sources = db.prepare('SELECT * FROM sources WHERE enabled=1').all();

  try {
    const merged = await syncAllSources(sources);
    // 更新 sources 状态
    const updateSrc = db.prepare(
      'UPDATE sources SET channel_count=?, status=?, last_sync=? WHERE id=?'
    );
    for (const s of sources) {
      updateSrc.run(s.channel_count || 0, s.status || 'ok', s.last_sync || 0, s.id);
    }

    // 清空并重建 channels（全量替换）
    const clearCh = db.prepare('DELETE FROM channels');
    const insertCh = db.prepare(
      `INSERT INTO channels (name, url, group_name, tvg_id, tvg_logo, tvg_name, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    db.exec('BEGIN');
    try {
      clearCh.run();
      for (const ch of merged) {
        insertCh.run(ch.name, ch.url, ch.group_name, ch.tvg_id, ch.tvg_logo, ch.tvg_name, ch.sort_order);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    res.json({ code: 0, data: { count: merged.length } });
  } catch (e) {
    res.status(500).json({ code: 1, msg: String(e.message || e) });
  }
});

// ============ 下发 ============

// 下发 M3U（供 APK / 播放器拉取）
router.get('/m3u', (req, res) => {
  const db = getDb();
  const channels = db.prepare(
    'SELECT * FROM channels WHERE enabled=1 ORDER BY sort_order, id'
  ).all();
  const text = generateM3U(channels);
  res.setHeader('Content-Type', 'application/x-mpegurl');
  res.setHeader('Content-Disposition', 'attachment; filename="xibao.m3u"');
  res.send(text);
});

// 文本格式（供 APK getM3U 对接，返回纯文本）
router.get('/api/m3u.txt', (req, res) => {
  const db = getDb();
  const channels = db.prepare(
    'SELECT * FROM channels WHERE enabled=1 ORDER BY sort_order, id'
  ).all();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(generateM3U(channels));
});

// 兼容旧 APK 接口名
router.get('/mytv/getUserM3U8', (req, res) => {
  const db = getDb();
  const channels = db.prepare(
    'SELECT * FROM channels WHERE enabled=1 ORDER BY sort_order, id'
  ).all();
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(generateM3U(channels));
});

// 频道 JSON（供新版 APK）
router.get('/api/channels.json', (req, res) => {
  const db = getDb();
  const channels = db.prepare(
    'SELECT id, name, url, group_name, tvg_id, tvg_logo FROM channels WHERE enabled=1 ORDER BY sort_order, id'
  ).all();
  res.json({ code: 0, data: channels });
});

export default router;
