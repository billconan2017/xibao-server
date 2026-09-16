// 系统设置
import express from 'express';
import { getDb, getSetting, setSetting } from '../store.js';
import { requireAuth } from '../auth.js';

const router = express.Router();

// 获取设置（站点名、APK URL 等；部分公开给前端）
router.get('/settings', (req, res) => {
  res.json({
    code: 0,
    data: {
      site_name: getSetting('site_name', '喜宝IPTV'),
      apk_url: getSetting('apk_url', ''),
    },
  });
});

// 更新设置（需登录）
router.post('/settings', requireAuth, (req, res) => {
  const { site_name, apk_url } = req.body || {};
  if (site_name !== undefined) setSetting('site_name', site_name);
  if (apk_url !== undefined) setSetting('apk_url', apk_url);
  res.json({ code: 0, msg: '已保存' });
});

export default router;
