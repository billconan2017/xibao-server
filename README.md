# 喜宝 IPTV 管理平台

面向群晖和家庭服务器的自建 IPTV 管理平台，配套原生 Android 手机/电视客户端。

## 功能

- M3U、M3U8、TXT 直播源导入、合并与定时同步
- 频道搜索、分组、排序、台标和启停管理
- XMLTV EPG 多源同步、频道模糊匹配与节目单下发
- 设备自动登记、后台授权和有效期管理
- 套餐绑定频道分组，按设备下发允许观看的频道
- M3U、TXT、JSON 和套餐订阅地址
- APK 下载地址、公告、提示文案和授权开关配置
- SQLite 数据库存储，单容器部署
- 管理页面静态依赖随镜像提供，局域网断网时仍可使用

## 群晖 Docker 部署

```bash
docker run -d \
  --name xibao-server \
  --restart unless-stopped \
  -p 8089:8080 \
  -v /volume1/docker/xibao/data:/app/data \
  -e TZ=Asia/Shanghai \
  billcoann/xibao-server:latest
```

访问：

| 地址 | 说明 |
|---|---|
| `http://群晖IP:8089/` | 门户与 APK 下载 |
| `http://群晖IP:8089/login` | 登录页 |
| `http://群晖IP:8089/admin` | 管理平台 |
| `http://群晖IP:8089/health` | 健康检查 |

首次登录账号为 `admin / admin123`。登录后请在“系统设置”中修改密码。

## 建议使用流程

1. 在“直播源”中添加远程订阅或上传 M3U/TXT 文件。
2. 同步并在“频道管理”中检查频道分组。
3. 在“EPG 节目单”中添加 XMLTV 地址并同步。
4. 在“套餐管理”中创建套餐并勾选可看的频道分组；不选表示全部频道。
5. 在“客户端设置”中决定是否启用设备授权。
6. 手机或电视安装喜宝 TV APK，填写服务器地址。
7. 如果启用了授权，在“设备授权”中为新设备绑定套餐和有效期。

## 客户端接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 连接检查 |
| `/api/device/heartbeat` | POST | 登记设备并读取授权状态 |
| `/api/channels.json?device_id=...` | GET | 按设备套餐下发频道 |
| `/api/epg?id=...` | GET | 下发频道节目单 |
| `/m3u` | GET | 全量 M3U |
| `/api/m3u.txt` | GET | 全量 M3U 文本 |
| `/api/rss/:key` | GET | 套餐订阅 |

## 本地开发

需要 Node.js 22 或更高版本：

```bash
npm ci
npm start
```

默认监听 `8080`。可通过 `PORT` 和 `XIBAO_DB_PATH` 修改端口与数据库路径。

## 相关仓库

- Android 客户端：https://github.com/billconan2017/xibao-iptv
- 管理平台：https://github.com/billconan2017/xibao-server

## License

MIT
