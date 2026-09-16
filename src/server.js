import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getSetting } from './store.js';
import apiRouter from './routes/api.js';
import authRouter from './routes/auth.js';
import epgRouter from './routes/epg.js';
import settingsRouter from './routes/settings.js';
import advancedRouter from './routes/advanced.js';
import clientRouter from './routes/client.js';
import vodRouter from './routes/vod.js';
import { requireAuth } from './auth.js';
import { restartAllCrons } from './cron.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 初始化数据库
initDb();

// 启动定时任务
restartAllCrons();

// 静态资源（管理后台前端页面）
const webDir = path.join(__dirname, '..', 'web');
app.use(express.static(webDir));

// ============ API 路由 ============
app.use('/api', apiRouter);
app.use('/api', authRouter);
app.use('/api', epgRouter);
app.use('/api', settingsRouter);
app.use('/api', advancedRouter);
app.use('/api', clientRouter);
app.use('/api', vodRouter);

// 兼容顶层下发接口（无需登录，供 APK 拉取）
app.use('/', apiRouter);
app.use('/', advancedRouter);

// ============ 页面路由 ============

// 首页：APK 下载 + 入口
app.get('/', (req, res) => {
  res.sendFile(path.join(webDir, 'index.html'));
});

// 登录页
app.get('/login', (req, res) => {
  res.sendFile(path.join(webDir, 'login.html'));
});

// 后台（需登录）
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(webDir, 'admin.html'));
});

// 健康检查
app.get('/health', (req, res) => res.json({ status: 'ok', name: 'xibao-server', version: '2.4.0' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 喜宝IPTV 后端已启动: http://0.0.0.0:${PORT}`);
  console.log(`   首页(APK下载): http://<ip>:${PORT}/`);
  console.log(`   登录页:        http://<ip>:${PORT}/login`);
  console.log(`   管理后台:      http://<ip>:${PORT}/admin`);
  console.log(`   M3U 下发:      http://<ip>:${PORT}/m3u`);
});
