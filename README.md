# 喜宝IPTV

完全自建的 IPTV 解决方案，脱离第三方便件/后端，一套代码跑通「综合门户 + 管理后台 + 直播源管理 + EPG + APK 播放器」。

## 架构

```
┌─────────────────────────────────────────────┐
│  xibao-server (综合门户 + 管理后台)           │
│  ├─ 首页 /         APK 下载 + 功能展示       │
│  ├─ 登录页 /login  账号密码登录              │
│  ├─ 后台 /admin    登录后管理（侧边栏导航）   │
│  │   ├─ 控制台      频道/分组/源统计         │
│  │   ├─ 频道管理    增删改查/分组/台标/启停   │
│  │   ├─ 直播源      多源导入合并去重         │
│  │   ├─ EPG         XMLTV 源 + 节目单匹配    │
│  │   ├─ M3U 下发    m3u/txt/json 多格式      │
│  │   └─ 系统设置    站点信息/APK地址/改密    │
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

```bash
docker run -d \
  --name xibao-server \
  -p 8089:8080 \
  -v /volume1/docker/xibao/data:/app/data \
  -e TZ=Asia/Shanghai \
  billcoann/xibao-server:latest
```

然后访问：

| 地址 | 说明 |
|---|---|
| `http://群晖IP:8089/` | 首页（APK 下载 + 功能展示） |
| `http://群晖IP:8089/login` | 登录页（默认 `admin` / `admin123`） |
| `http://群晖IP:8089/admin` | 管理后台（需登录） |

## 使用流程

1. 打开 `http://群晖IP:8089/login`，用默认账号登录
2. 「系统设置」→ 修改默认密码
3. 「直播源」→ 添加 M3U 源 → 点「全量同步」
4. 「频道管理」→ 查看/编辑/启停频道
5. 「EPG」→ 添加 XMLTV 源 → 同步节目单
6. 首页「下载 APK」→ 手机/电视安装 → 输后端地址 → 观看

## 后端 API

### 认证
| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/auth/login` | POST | 登录（返回 token + 写 cookie） |
| `/api/auth/logout` | POST | 登出 |
| `/api/auth/me` | GET | 当前用户 |
| `/api/auth/password` | POST | 修改密码 |

### 频道 / 源
| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/channels` | GET/POST | 频道列表/新增 |
| `/api/channels/:id` | PUT/DELETE | 更新/删除频道 |
| `/api/groups` | GET | 分组统计 |
| `/api/sources` | GET/POST | 直播源列表/添加 |
| `/api/sources/:id` | DELETE | 删除源 |
| `/api/sync` | POST | 全量同步 |

### EPG
| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/epgs` | GET | EPG 源列表 |
| `/api/epgs` | POST | 添加 EPG 源 |
| `/api/epgs/:id` | DELETE | 删除 EPG 源 |
| `/api/epgs/sync` | POST | 拉取 XMLTV 同步节目单 |
| `/api/epg?id=xxx` | GET | 查某频道节目单 |

### 下发（无需登录，供 APK/播放器）
| 接口 | 方法 | 说明 |
|---|---|---|
| `/m3u` | GET | M3U 文件（附件） |
| `/api/m3u.txt` | GET | M3U 纯文本 |
| `/api/channels.json` | GET | 频道 JSON |

### 设置
| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/settings` | GET/POST | 读取/更新站点设置 |

## 本地开发

```bash
cd xibao-server
npm install
npm start        # 默认 8080 端口，PORT 环境变量可改
```

## 技术栈

- 后端：Node.js (Express) + node:sqlite（零编译原生依赖）
- 前端：Vue 3（CDN 单文件，多页面）
- APK：Capacitor + Vue 3
- 部署：Docker

## 相关仓库

- APK 播放器：https://github.com/billconan2017/xibao-iptv
- 后端（本仓库）：https://github.com/billconan2017/xibao-server

## License

MIT
