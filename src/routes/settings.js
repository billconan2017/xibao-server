// 系统设置
import express from 'express';
import { getDb, getSetting, setSetting } from '../store.js';
import { requireAuth } from '../auth.js';
import { restartAllCrons } from '../cron.js';

const router = express.Router();

// 获取设置（站点名、APK URL 等；部分公开给前端）
router.get('/settings', (req, res) => {
  res.json({
    code: 0,
    data: {
      site_name: getSetting('site_name', '喜宝IPTV'),
      apk_url: getSetting('apk_url', ''),
      cron_channel_auto: getSetting('cron_channel_auto', '0'),
      cron_channel_interval: getSetting('cron_channel_interval', '6'),
      cron_epg_auto: getSetting('cron_epg_auto', '0'),
    },
  });
});

// 更新设置（需登录）
router.post('/settings', requireAuth, (req, res) => {
  const { site_name, apk_url } = req.body || {};
  const { cron_channel_auto, cron_channel_interval, cron_epg_auto } = req.body || {};
  if (cron_channel_interval !== undefined && (!Number.isInteger(Number(cron_channel_interval)) || Number(cron_channel_interval) < 1 || Number(cron_channel_interval) > 168)) {
    return res.status(400).json({ code: 1, msg: '同步间隔应为 1 至 168 小时的整数' });
  }
  if (site_name !== undefined) setSetting('site_name', site_name);
  if (apk_url !== undefined) setSetting('apk_url', apk_url);
  if (cron_channel_auto !== undefined) setSetting('cron_channel_auto', String(cron_channel_auto) === '1' ? '1' : '0');
  if (cron_channel_interval !== undefined) setSetting('cron_channel_interval', String(cron_channel_interval));
  if (cron_epg_auto !== undefined) setSetting('cron_epg_auto', String(cron_epg_auto) === '1' ? '1' : '0');
  if ([cron_channel_auto, cron_channel_interval, cron_epg_auto].some(v => v !== undefined)) restartAllCrons();
  res.json({ code: 0, msg: '已保存' });
});

export default router;
