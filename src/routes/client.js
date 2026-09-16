// 客户端编译配置、系统公告、系统更新、升级日志
import express from 'express';
import { getSetting, setSetting } from '../store.js';
import { requireAuth } from '../auth.js';
const router = express.Router();

// ============ 客户端编译配置 ============

// 读取客户端配置（需登录）
router.get('/client/config', requireAuth, (req, res) => {
  res.json({
    code: 0,
    data: {
      server_url: getSetting('client_server_url', ''),
      apk_url: getSetting('apk_url', ''),
      packagename: getSetting('client_packagename', 'com.xibao.iptv'),
      appname: getSetting('client_appname', '喜宝 TV'),
      version: getSetting('client_version', '2.1.0'),
      needauthor: getSetting('client_needauthor', '0'),
      decoder: getSetting('client_decoder', '3'),
      bufftimeout: getSetting('client_bufftimeout', '10'),
    },
  });
});

// 客户端编译配置
router.post('/client/config', requireAuth, (req, res) => {
  const keys = ['server_url', 'apk_url', 'packagename', 'appname', 'version', 'needauthor', 'decoder', 'bufftimeout'];
  const map = {
    server_url: 'client_server_url',
    apk_url: 'apk_url',
    packagename: 'client_packagename',
    appname: 'client_appname',
    version: 'client_version',
    needauthor: 'client_needauthor',
    decoder: 'client_decoder',
    bufftimeout: 'client_bufftimeout',
  };
  for (const k of keys) {
    if (req.body && req.body[k] !== undefined) setSetting(map[k], req.body[k]);
  }
  res.json({ code: 0, msg: '已保存' });
});

// 返回已发布 APK。Android SDK 构建放在 CI/专用镜像中，避免拖死 NAS 管理服务。
router.post('/client/build', requireAuth, (req, res) => {
  const url = getSetting('apk_url', '');
  if (!url) return res.status(400).json({ code: 1, msg: '请先填写已发布 APK 的下载地址' });
  res.json({ code: 0, data: { url } });
});

// 保存应用提示文案
router.post('/client/tips', requireAuth, (req, res) => {
  const map = {
    loading: 'tip_loading',
    user_expired: 'tip_userexpired',
    user_forbidden: 'tip_userforbidden',
    user_noreg: 'tip_usernoreg',
  };
  for (const [k, key] of Object.entries(map)) {
    if (req.body && req.body[k] !== undefined) setSetting(key, req.body[k]);
  }
  res.json({ code: 0, msg: '已保存' });
});

// 客户端下发配置（公开，供 APK 启动时拉取）
router.get('/client/config/public', (req, res) => {
  res.json({
    code: 0,
    data: {
      server_url: getSetting('client_server_url', ''),
      appname: getSetting('client_appname', '喜宝 TV'),
      version: getSetting('client_version', '2.1.0'),
      needauthor: getSetting('client_needauthor', '0'),
      decoder: getSetting('client_decoder', '3'),
      bufftimeout: getSetting('client_bufftimeout', '10'),
      tips: {
        loading: getSetting('tip_loading', '正在加载...'),
        user_expired: getSetting('tip_userexpired', '订阅已过期'),
        user_forbidden: getSetting('tip_userforbidden', '设备已被禁用'),
        user_noreg: getSetting('tip_usernoreg', '设备未授权'),
      },
      ad: {
        adtext: getSetting('ad_text', ''),
        showtime: getSetting('ad_showtime', '5'),
        showinterval: getSetting('ad_showinterval', '30'),
      },
    },
  });
});

// ============ 系统公告 ============

router.get('/notice', (req, res) => {
  res.json({
    code: 0,
    data: {
      adtext: getSetting('ad_text', ''),
      showtime: getSetting('ad_showtime', '5'),
      showinterval: getSetting('ad_showinterval', '30'),
    },
  });
});

router.post('/notice', requireAuth, (req, res) => {
  const { adtext, showtime, showinterval } = req.body || {};
  if (adtext !== undefined) setSetting('ad_text', adtext);
  if (showtime !== undefined) setSetting('ad_showtime', showtime);
  if (showinterval !== undefined) setSetting('ad_showinterval', showinterval);
  res.json({ code: 0, msg: '已保存' });
});

// ============ 系统更新 ============

router.get('/update', (req, res) => {
  res.json({
    code: 0,
    data: {
      version: getSetting('version', '2.1.0'),
      latest: getSetting('version', '2.1.0'),
      has_update: false,
    },
  });
});

// ============ 升级日志（关于） ============

router.get('/about', (req, res) => {
  const changelog = [
    { version: 'v2.1.0', date: '2026-09-16', desc: '家庭管理界面、频道编辑与排序、本地 TXT 分组导入；修复客户端启动闪退，增加自动播放、收藏和重连' },
    { version: 'v2.0.0', date: '2026-09-16', desc: '原生 Android TV/手机客户端、设备授权与套餐频道下发' },
    { version: 'v1.1.0', date: '2026-09-16', desc: '综合门户：登录 + APK下载首页 + 后台多页 + EPG' },
    { version: 'v1.0.1', date: '2026-09-15', desc: 'APK 连自建后端' },
    { version: 'v1.0.0', date: '2026-09-14', desc: '首个版本' },
  ];
  res.json({ code: 0, data: { changelog, version: getSetting('version', '2.1.0') } });
});

export default router;
