// 定时任务：定时同步频道 + 定时更新 EPG
import { getDb, getSetting } from './store.js';
import { syncAllSources } from './source.js';
import { parseM3U, generateM3U, mergeChannels } from './m3u.js';
import { fetchEpgXml, parseXmltv, buildChannelMatchMap, normalizeName } from './routes/epg.js';

let channelTimer = null;
let epgTimer = null;
let epgSyncing = false;

// 启动定时同步频道
export function startChannelCron() {
  const interval = parseInt(getSetting('cron_channel_interval', '0'), 10);
  const auto = parseInt(getSetting('cron_channel_auto', '0'), 10);

  stopChannelCron();

  if (auto !== 1 || interval <= 0) return;

  const ms = interval * 3600 * 1000;
  console.log(`[Cron] 频道定时同步已启动，间隔 ${interval} 小时`);
  channelTimer = setInterval(async () => {
    console.log('[Cron] 开始定时同步频道...');
    try {
      const result = await syncAllSources();
      console.log(`[Cron] 频道同步完成: ${result.count} 个频道`);
    } catch (e) {
      console.error('[Cron] 频道同步失败:', e.message);
    }
  }, ms);
}

export function stopChannelCron() {
  if (channelTimer) {
    clearInterval(channelTimer);
    channelTimer = null;
    console.log('[Cron] 频道定时同步已停止');
  }
}

// 启动定时 EPG 更新（每天凌晨随机时间 1-5 点）
export function startEpgCron() {
  const auto = parseInt(getSetting('cron_epg_auto', '0'), 10);

  stopEpgCron();
  if (auto !== 1) return;

  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const randomHour = 1 + Math.floor(Math.random() * 5);
  const randomMinute = Math.floor(Math.random() * 60);
  const target = new Date(tomorrow);
  target.setHours(randomHour, randomMinute, 0, 0);
  const delay = Math.max(target.getTime() - now.getTime(), 1000);

  console.log(`[Cron] EPG 定时更新已启动，下次: ${target.toLocaleString('zh-CN')}`);

  epgTimer = setTimeout(async () => {
    if (epgSyncing) return;
    epgSyncing = true;
    try {
      console.log('[Cron] 开始定时更新 EPG...');
      const db = getDb();
      const epgs = db.prepare('SELECT * FROM epgs WHERE enabled=1').all();
      const programInsert = db.prepare(
        `INSERT INTO programs (epg_id, channel_id, title, start_time, end_time, description)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      // 清空旧节目
      db.prepare('DELETE FROM programs').run();
      const channels = db.prepare('SELECT * FROM channels').all();
      let total = 0;

      for (const epg of epgs) {
        try {
          const text = await fetchEpgXml(epg.url);
          const programs = parseXmltv(text);
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
          console.error(`[Cron] EPG 源 ${epg.name} 同步失败:`, e.message);
          db.prepare('UPDATE epgs SET status=? WHERE id=?').run('error', epg.id);
        }
      }
      console.log(`[Cron] EPG 定时更新完成: ${total} 条节目`);
    } catch (e) {
      console.error('[Cron] EPG 定时更新失败:', e.message);
    } finally {
      epgSyncing = false;
      startEpgCron(); // 安排下一次
    }
  }, delay);
}

export function stopEpgCron() {
  if (epgTimer) {
    clearTimeout(epgTimer);
    epgTimer = null;
    console.log('[Cron] EPG 定时更新已停止');
  }
}

export function restartAllCrons() {
  startChannelCron();
  startEpgCron();
}