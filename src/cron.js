// 定时任务：定时同步频道 + 定时更新 EPG
import { getDb, getSetting } from './store.js';
import { syncAllSources } from './source.js';
import { syncEpgInternal } from './routes/epg.js';

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
      const db = getDb();
      const sources = db.prepare("SELECT * FROM sources WHERE enabled=1 AND type!='upload'").all();
      const channels = await syncAllSources(sources);
      const updateSource = db.prepare('UPDATE sources SET channel_count=?, status=?, last_sync=? WHERE id=?');
      const clearChannels = db.prepare("DELETE FROM channels WHERE source_id = 0 OR source_id NOT IN (SELECT id FROM sources WHERE type='upload')");
      const insertChannel = db.prepare(
        `INSERT OR IGNORE INTO channels (name, url, group_name, tvg_id, tvg_logo, tvg_name, source_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      );

      db.exec('BEGIN');
      try {
        for (const source of sources) {
          updateSource.run(source.channel_count || 0, source.status || 'error', source.last_sync || 0, source.id);
        }
        clearChannels.run();
        channels.forEach((channel, index) => {
          insertChannel.run(channel.name, channel.url, channel.group_name, channel.tvg_id, channel.tvg_logo, channel.tvg_name, index);
        });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      console.log(`[Cron] 频道同步完成: ${channels.length} 个频道`);
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
      const data = await syncEpgInternal(db);
      console.log(`[Cron] EPG 定时更新完成: ${data.total} 条节目`);
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
