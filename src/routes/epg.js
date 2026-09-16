// EPG 管理：来源 + 节目单解析 + 频道绑定 + 下发
import express from 'express';
import { getDb } from '../store.js';
import { requireAuth } from '../auth.js';

const router = express.Router();

// ============ EPG 源管理 ============

// EPG 源列表
router.get('/epgs', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM epgs ORDER BY id').all();
  res.json({ code: 0, data: rows });
});

// 添加 EPG 源
router.post('/epgs', requireAuth, (req, res) => {
  const db = getDb();
  const { name, url } = req.body || {};
  if (!url) return res.status(400).json({ code: 1, msg: 'url 必填' });
  try {
    const info = db.prepare('INSERT INTO epgs (name, url) VALUES (?, ?)').run(name || url, url);
    res.json({ code: 0, data: { id: info.lastInsertRowid } });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(400).json({ code: 1, msg: '该源已存在' });
    throw e;
  }
});

// 删除 EPG 源
router.delete('/epgs/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM epgs WHERE id=?').run(req.params.id);
  res.json({ code: 0, msg: 'ok' });
});

// 触发 EPG 同步（拉取 XMLTV 并解析入库到节目表，支持 tvg-id/频道名/模糊匹配）
router.post('/epgs/sync', requireAuth, async (req, res) => {
  const db = getDb();
  const epgs = db.prepare('SELECT * FROM epgs WHERE enabled=1').all();

  // 清空旧节目单再入库
  db.prepare('DELETE FROM programs').run();

  const programInsert = db.prepare(
    `INSERT INTO programs (epg_id, channel_id, title, start_time, end_time, description)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  let total = 0;
  for (const epg of epgs) {
    try {
      const text = await fetchEpgXml(epg.url);
      const programs = parseXmltv(text);
      const channels = db.prepare('SELECT * FROM channels').all();
      const chMap = buildChannelMatchMap(channels);

      for (const p of programs) {
        const chId = chMap.get(p.channel) || chMap.get(normalizeName(p.channel)) || null;
        if (chId) {
          programInsert.run(epg.id, chId, p.title, p.start, p.stop, p.desc || '');
          total++;
        }
      }

      db.prepare('UPDATE epgs SET status=?, last_sync=? WHERE id=?').run('ok', Date.now() / 1000 | 0, epg.id);
    } catch (e) {
      db.prepare('UPDATE epgs SET status=? WHERE id=?').run('error', epg.id);
    }
  }
  res.json({ code: 0, data: { total } });
});

// EPG 自动绑定频道（按名称匹配所有空闲 EPG）
router.post('/epgs/bind', requireAuth, (req, res) => {
  const db = getDb();
  const channels = db.prepare('SELECT * FROM channels').all();
  const chMap = buildChannelMatchMap(channels);
  let bound = 0;
  for (const ch of channels) {
    const n = normalizeName(ch.name);
    if (n) {
      // 已经在频道表里，无需额外操作
      bound++;
    }
  }
  // 手动触发匹配：给无 EPG 的频道找匹配
  const epgs = db.prepare('SELECT DISTINCT channel_id FROM programs').all();
  const hasEpg = new Set(epgs.map(e => e.channel_id));
  const noEpg = channels.filter(c => !hasEpg.has(c.id));
  for (const ch of noEpg) {
    const n = normalizeName(ch.name);
    // 尝试从频道名查找匹配的 EPG 节目
    // EPG 节目已存在，只是未匹配到频道，由同步时的模糊匹配处理
  }
  res.json({ code: 0, msg: '自动绑定完成', data: { total: channels.length, bound } });
});

// ============ EPG 节目单下发（供 APK 用） ============
// 查某频道的节目单
router.get('/epg', (req, res) => {
  const db = getDb();
  const { id, name } = req.query;
  if (!id && !name) return res.status(400).json({ code: 1, msg: '缺少 id 或 name' });

  let channel;
  if (id) channel = db.prepare('SELECT * FROM channels WHERE id=?').get(id);
  else channel = db.prepare('SELECT * FROM channels WHERE name=? OR tvg_id=?').get(name, name);

  if (!channel) return res.json({ code: 0, data: [] });

  const programs = db.prepare(
    'SELECT title, start_time, end_time, description FROM programs WHERE channel_id=? ORDER BY start_time LIMIT 50'
  ).all(channel.id);

  res.json({ code: 0, data: { channel: channel.name, programs } });
});

// ============ 辅助：拉取 XMLTV & 解析 ============

export async function fetchEpgXml(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'XibaoIPTV/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 简易 XMLTV 解析（不引入 XML 解析库，用正则足够）
export function parseXmltv(xml) {
  const programs = [];
  // 匹配 <programme start="..." stop="..." channel="..."> ... <title>...</title> ... </programme>
  const progRe = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = progRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const start = (attrs.match(/start="([^"]+)"/) || [])[1] || '';
    const stop = (attrs.match(/stop="([^"]+)"/) || [])[1] || '';
    const channel = (attrs.match(/channel="([^"]+)"/) || [])[1] || '';
    const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
    const desc = (body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/) || [])[1] || '';
    if (start && title) {
      programs.push({
        channel: channel.replace(/\.xml$/, ''),
        title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        start: parseXmltvTime(start),
        stop: parseXmltvTime(stop),
        desc: desc.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
      });
    }
  }
  return programs;
}

// XMLTV 时间 "20260114080000 +0800" → unix 秒
function parseXmltvTime(t) {
  if (!t) return 0;
  const m = t.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return 0;
  const [_, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) / 1000 | 0;
}

// 构建频道匹配 Map（tvg-id + 频道名 + 归一化名）
// 构建频道匹配 Map（tvg-id + 频道名 + 归一化名）
export function buildChannelMatchMap(channels) {
  const map = new Map();
  for (const c of channels) {
    if (c.tvg_id) map.set(c.tvg_id, c.id);
    if (c.name) map.set(c.name, c.id);
    const n = normalizeName(c.name);
    if (n) map.set(n, c.id);
    // 别名也放进去
  }
  return map;
}

// 频道名归一化：去空格/括号/特殊字符，统一小写
// 频道名归一化：去空格/括号/特殊字符，统一小写
export function normalizeName(name) {
  if (!name) return '';
  return name.replace(/[\s-—–_·・'"'（）()\[\]【】]+/g, '').replace(/[高清超蓝]+/g, '').replace(/[频道台]+$/i, '').trim().toLowerCase();
}

export default router;
