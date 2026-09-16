// 客户端编译配置、系统公告、系统更新、升级日志
import express from 'express';
import { getDb, getSetting, setSetting } from '../store.js';
import { requireAuth } from '../auth.js';
import { execSync } from 'child_process';
import fs from 'fs';
const router = express.Router();

// ============ 客户端编译配置 ============

// 读取客户端配置（需登录）
router.get('/client/config', requireAuth, (req, res) => {
  res.json({
    code: 0,
    data: {
      server_url: getSetting('client_server_url', ''),
      packagename: getSetting('client_packagename', 'com.xibao.iptv'),
      appname: getSetting('client_appname', '喜宝IPTV'),
      version: getSetting('client_version', '1.0.1'),
      needauthor: getSetting('client_needauthor', '0'),
      decoder: getSetting('client_decoder', '3'),
      bufftimeout: getSetting('client_bufftimeout', '10'),
    },
  });
});

// 客户端编译配置
router.post('/client/config', requireAuth, (req, res) => {
  const keys = ['server_url', 'packagename', 'appname', 'version', 'needauthor', 'decoder', 'bufftimeout'];
  const map = {
    server_url: 'client_server_url',
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

// 构建 APK：用当前 server_url 现场编译
router.post('/client/build', requireAuth, (req, res) => {
  const serverUrl = req.body?.server_url || getSetting('client_server_url', '');
  if (!serverUrl) return res.status(400).json({ code: 1, msg: '请先在编译配置中填写服务器地址' });

  const APK_DIR = '/home/bill/.openclaw/workspace/iptv/iptv-app';
  const OUT_APK = '/tmp/xibao-iptv.apk';
  
  // 用子进程同步执行构建
  try {
    // 1. 用 server_url 编译前端
    execSync(
      `VITE_SERVER_URL="${serverUrl}" npx vite build`,
      { cwd: APK_DIR, stdio: 'pipe', timeout: 60000, env: { ...process.env, PATH: process.env.PATH } }
    );
    // 2. sync 到电容
    execSync(
      `npx cap sync android`,
      { cwd: APK_DIR, stdio: 'pipe', timeout: 30000, env: { ...process.env, PATH: process.env.PATH } }
    );
    // 3. gradle 打包（静默，只取关键输出）
    execSync(
      `cd android && ANDROID_HOME=/opt/android-sdk ./gradlew assembleDebug --quiet`,
      { cwd: APK_DIR, stdio: 'pipe', timeout: 300000, env: { ...process.env, ANDROID_HOME: '/opt/android-sdk', PATH: process.env.PATH } }
    );
    
    // 4. 复制到输出路径
    execSync(`cp ${APK_DIR}/android/app/build/outputs/apk/debug/app-debug.apk ${OUT_APK}`);
    
    // 5. 返回文件下载
    const stat = fs.statSync(OUT_APK);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="xibao-iptv.apk"');
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(OUT_APK).pipe(res);
  } catch (e) {
    res.status(500).json({ code: 1, msg: `构建失败: ${e.stderr?.toString().slice(0, 200) || e.message}` });
  }
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
      appname: getSetting('client_appname', '喜宝IPTV'),
      version: getSetting('client_version', '1.0.1'),
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
      version: getSetting('version', '1.1.0'),
      latest: getSetting('version', '1.1.0'),
      has_update: false,
    },
  });
});

// ============ 升级日志（关于） ============

router.get('/about', (req, res) => {
  const changelog = [
    { version: 'v1.1.0', date: '2026-09-16', desc: '综合门户：登录 + APK下载首页 + 后台多页 + EPG' },
    { version: 'v1.0.1', date: '2026-09-15', desc: 'APK 连自建后端' },
    { version: 'v1.0.0', date: '2026-09-14', desc: '首个版本' },
  ];
  res.json({ code: 0, data: { changelog, version: getSetting('version', '1.1.0') } });
});

export default router;
