# 喜宝IPTV

完全自建的 IPTV 解决方案，脱离第三方便件/后端，一套代码跑通「管理后台 + 直播源管理 + APK 播放器」。

## 架构

```
┌─────────────────────────────────────────────┐
│  xibao-server (后端 + 管理后台)              │
│  - 多源导入合并去重                          │
│  - 频道管理（增删改查/分组/台标/启停）        │
│  - M3U/JSON 下发给播放器                    │
│  - Vue3 单文件管理后台                       │
└─────────────────────────────────────────────┘
          ▲ 配置服务器地址
          │
┌─────────┴───────────────────────────────────┐
│  xibao-iptv (APK 播放器)                     │
│  - Capacitor + Vue3 原生 Android             │
│  - 支持 arm64/v7a/电视盒子                   │
│  - 打开即配置页，输后端地址即用               │
└─────────────────────────────────────────────┘
```

## 快速部署（群晖 Docker）

### 1. 启动后端 + 管理后台

```bash
docker run -d \
  --name xibao-server \
  -p 8089:8080 \
  -v /volume1/docker/xibao/data:/app/data \
  -e TZ=Asia/Shanghai \
  billcoann/xibao-server:latest
```

访问 `http://群晖IP:8089` 进入管理后台。

### 2. （可选）启动 APK 下载站

```bash
docker run -d --name xibao-apk -p 8088:80 billcoann/xibao-iptv:latest
```

访问 `http://群晖IP:8088` 下载 APK。

也可以用 GitHub Release 直链：
https://github.com/billconan2017/xibao-iptv/releases/latest

### 3. 使用流程

1. 打开管理后台 `http://群晖IP:8089`
2. 「直播源」标签 → 添加 M3U 源地址 → 点「全量同步」
3. 「频道管理」标签 → 查看/编辑/启停频道
4. 「M3U下发」标签 → 复制下发地址
5. 手机/电视装 APK → 输后端地址 `http://群晖IP:8089` → 观看

## 后端 API

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/channels` | GET | 频道列表（支持 group/search/enabled 过滤） |
| `/api/channels` | POST | 新增频道 |
| `/api/channels/:id` | PUT | 更新频道 |
| `/api/channels/:id` | DELETE | 删除频道 |
| `/api/groups` | GET | 分组统计 |
| `/api/sources` | GET/POST | 直播源列表/添加 |
| `/api/sources/:id` | DELETE | 删除源 |
| `/api/sync` | POST | 全量同步（拉所有源→合并→入库） |
| `/m3u` | GET | M3U 下发（Content-Disposition 附件） |
| `/api/m3u.txt` | GET | M3U 纯文本（供播放器拉取） |
| `/api/channels.json` | GET | 频道 JSON（供 APK 拉取） |

## 本地开发

```bash
cd xibao-server
npm install
npm start        # 默认 8080 端口，PORT 环境变量可改
```

## 技术栈

- 后端：Node.js (Express) + node:sqlite（零编译原生依赖）
- 前端：Vue 3（单文件，CDN 引入）
- APK：Capacitor + Vue 3
- 部署：Docker

## 相关仓库

- APK 播放器：https://github.com/billconan2017/xibao-iptv
- 后端（本仓库）：https://github.com/billconan2017/xibao-server

## License

MIT
