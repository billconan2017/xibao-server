// EPG 管理：来源 + 节目单解析 + 频道绑定 + 下发
import express from 'express';
import { getDb } from '../store.js';
import { requireAuth } from '../auth.js';

const router = express.Router();

// 单源拉取上限：控制内存/CPU，避免巨大 XMLTV 拖死事件循环
const MAX_XML_BYTES = 64 * 1024 * 1024;   // 单源最多下载 64MB
const MAX_PROGRAMS = 200000;              // 单源最多解析 20 万条节目
const FETCH_TIMEOUT = 25000;              // 拉取超时 25s

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

// 触发 EPG 同步：后台异步执行，立即返回，避免阻塞事件循环（防卡死）
router.post('/epgs/sync', requireAuth, async (req, res) => {
  const db = getDb();
  // 立即标记所有启用的源为"同步中"
  const epgs = db.prepare('SELECT * FROM epgs WHERE enabled=1').all();
  if (epgs.length === 0) {
    return res.json({ code: 0, data: { total: 0, results: [], async: true, msg: '没有启用的 EPG 源' } });
  }
  for (const e of epgs) {
    db.prepare('UPDATE epgs SET status=? WHERE id=?').run('syncing', e.id);
  }
  // 先返回，再后台跑
  res.json({ code: 0, data: { async: true, msg: `已开始同步 ${epgs.length} 个 EPG 源，请在频道列表刷新查看结果` } });

  setImmediate(async () => {
    try {
      await syncEpgInternal(db);
      console.log(`[EPG] 同步完成`);
    } catch (e) {
      console.error('[EPG] 同步异常:', e.message);
    }
  });
});

// 供路由与 cron 共用的 EPG 同步核心
export async function syncEpgInternal(db) {
  const epgs = db.prepare('SELECT * FROM epgs WHERE enabled=1').all();

  const programInsert = db.prepare(
    `INSERT INTO programs (epg_id, channel_id, title, start_time, end_time, description)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const channels = db.prepare('SELECT * FROM channels').all();
  const chMap = buildChannelMatchMap(channels);

  let total = 0;
  const results = [];

  for (const epg of epgs) {
    try {
      // 1. 拉取（带超时 + 大小上限）
      const text = await fetchEpgXml(epg.url, FETCH_TIMEOUT, MAX_XML_BYTES);

      // 2. 解析（带数量上限）
      const programs = parseXmltv(text, MAX_PROGRAMS);

      // 3. 删除该源旧节目
      db.prepare('DELETE FROM programs WHERE epg_id=?').run(epg.id);

      // 4. 批量事务写入（只保留能匹配到真实频道的节目）
      db.exec('BEGIN');
      try {
        let cnt = 0;
        for (const p of programs) {
          let chId = chMap.get(p.channel);
          if (chId == null) chId = chMap.get(normalizeName(p.channel));
          if (chId != null) {
            programInsert.run(epg.id, chId, p.title, p.start, p.stop, p.desc || '');
            cnt++;
          }
        }
        db.exec('COMMIT');
        total += cnt;
        results.push({ id: epg.id, name: epg.name, status: 'ok', parsed: programs.length, saved: cnt });
        db.prepare('UPDATE epgs SET status=?, last_sync=? WHERE id=?').run('ok', Date.now() / 1000 | 0, epg.id);
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    } catch (e) {
      results.push({ id: epg.id, name: epg.name, status: 'error', msg: String(e.message || e).slice(0, 120) });
      db.prepare('UPDATE epgs SET status=? WHERE id=?').run('error', epg.id);
    }
  }

  return { total, results };
}

// EPG 自动绑定频道
router.post('/epgs/bind', requireAuth, (req, res) => {
  const db = getDb();
  const channels = db.prepare('SELECT * FROM channels').all();
  const chMap = buildChannelMatchMap(channels);
  let bound = 0;
  for (const ch of channels) {
    if (normalizeName(ch.name)) bound++;
  }
  const epgs = db.prepare('SELECT DISTINCT channel_id FROM programs').all();
  const hasEpg = new Set(epgs.map(e => e.channel_id));
  const noEpg = channels.filter(c => !hasEpg.has(c.id));
  res.json({ code: 0, msg: '自动绑定完成', data: { total: channels.length, bound, unmatched: noEpg.length } });
});

// ============ EPG 节目单下发（供 APK 用） ============
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

// 拉取 XMLTV，带超时 + 大小上限（避免巨大文件撑爆内存）
export async function fetchEpgXml(url, timeoutMs = 25000, maxBytes = MAX_XML_BYTES) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'XibaoIPTV/1.0', 'Accept-Encoding': 'gzip' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // 先读内容长度，超限直接拒绝
    const cl = res.headers.get('content-length');
    if (cl && +cl > maxBytes) throw new Error(`文件过大 ${(cl / 1024 / 1024).toFixed(0)}MB，超过限制`);

    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error(`文件过大 ${(buf.byteLength / 1024 / 1024).toFixed(0)}MB，超过限制`);

    // gzip 解压（部分 EPG 源用 gzip 传输）
    let text = Buffer.from(buf).toString('utf8');
    if (buf.byteLength >= 2) {
      const b = new Uint8Array(buf);
      if (b[0] === 0x1f && b[1] === 0x8b) {
        const zlib = await import('node:zlib');
        text = zlib.gunzipSync(Buffer.from(buf)).toString('utf8');
      }
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// XMLTV 解析：单次正则遍历，带数量上限，避免无界 CPU 阻塞
export function parseXmltv(xml, maxPrograms = MAX_PROGRAMS) {
  if (!xml) return [];
  const programs = [];
  const progRe = /<programme\b[^>]*>([\s\S]*?)<\/programme>/g;
  let m;
  while ((m = progRe.exec(xml)) !== null) {
    if (programs.length >= maxPrograms) break;
    const attrs = m[0].slice(0, m[0].indexOf('>') === -1 ? m[0].length : m[0].indexOf('>'));
    const body = m[1];
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
export function buildChannelMatchMap(channels) {
  const map = new Map();
  for (const c of channels) {
    if (c.tvg_id) map.set(c.tvg_id, c.id);
    if (c.name) map.set(c.name, c.id);
    const n = normalizeName(c.name);
    if (n) map.set(n, c.id);
  }
  return map;
}

// 频道名归一化：去空格/括号/特殊字符，统一小写
export function normalizeName(name) {
  if (!name) return '';
  return name.replace(/[\s-—–_·・'"'（）()\[\]【】]+/g, '').replace(/[高清超蓝]+/g, '').replace(/[频道台]+$/i, '').trim().toLowerCase();
}

export default router;
