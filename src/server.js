import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './store.js';
import apiRouter from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 初始化数据库
initDb();

// API 路由
app.use('/api', apiRouter);

// 兼容顶层接口（旧 APK 走 /mytv/...）
app.use('/', apiRouter);

// 静态管理后台
const webDir = path.join(__dirname, '..', 'web');
app.use(express.static(webDir));

// 健康检查
app.get('/health', (req, res) => res.json({ status: 'ok', name: 'xibao-server', version: '1.0.0' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 喜宝IPTV 后端已启动: http://0.0.0.0:${PORT}`);
  console.log(`   管理后台: http://<你的IP>:${PORT}`);
  console.log(`   M3U 下发: http://<你的IP>:${PORT}/m3u`);
});
