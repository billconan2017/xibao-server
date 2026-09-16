import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.XIBAO_DB_PATH || path.join(__dirname, '..', 'data', 'xibao.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db;

export function initDb() {
  db = new DatabaseSync(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      group_name TEXT DEFAULT '',
      tvg_id TEXT DEFAULT '',
      tvg_logo TEXT DEFAULT '',
      tvg_name TEXT DEFAULT '',
      tvg_number INTEGER DEFAULT 0,
      source_id INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(name, url)
    );

    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT '',
      url TEXT NOT NULL,
      type TEXT DEFAULT 'm3u',
      enabled INTEGER DEFAULT 1,
      last_sync INTEGER DEFAULT 0,
      channel_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(url)
    );

    CREATE TABLE IF NOT EXISTS epgs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT '',
      url TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_sync INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(url)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epg_id INTEGER DEFAULT 0,
      channel_id INTEGER DEFAULT 0,
      title TEXT DEFAULT '',
      start_time INTEGER DEFAULT 0,
      end_time INTEGER DEFAULT 0,
      description TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_programs_channel ON programs(channel_id, start_time);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );

    -- 点播资源库
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT '',
      api TEXT NOT NULL,
      state INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    -- 套餐
    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status INTEGER DEFAULT 1,
      content TEXT DEFAULT '',
      rss_key TEXT DEFAULT '',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    -- 客户端设备（授权）
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT '',
      device_id TEXT DEFAULT '',
      model TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      region TEXT DEFAULT '',
      meal_id INTEGER DEFAULT 0,
      author INTEGER DEFAULT 0,
      marks TEXT DEFAULT '',
      exp_at INTEGER DEFAULT 0,
      last_time INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      UNIQUE(device_id)
    );

    CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_name);
    CREATE INDEX IF NOT EXISTS idx_channels_enabled ON channels(enabled);
  `);

  // 初始化默认管理员 & 默认设置
  seedDefaults();

  return db;
}

function seedDefaults() {
  // 默认管理员 admin / 365759630
  const existing = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (existing.c === 0) {
    const hash = hashPassword('365759630');
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
  }

  // 默认设置
  const defaults = {
    site_name: '喜宝IPTV',
    apk_url: '', // APK 下载地址，留空则用内置默认
    // 客户端编译配置
    client_server_url: '',
    client_packagename: 'com.xibao.iptv',
    client_appname: '喜宝IPTV',
    client_version: '1.0.1',
    client_needauthor: '0',
    client_decoder: '3',
    client_bufftimeout: '10',
    // 应用提示文案
    tip_loading: '正在加载...',
    tip_userexpired: '订阅已过期',
    tip_userforbidden: '设备已被禁用',
    tip_usernoreg: '设备未授权',
    // 系统公告
    ad_text: '',
    ad_showtime: '5',
    ad_showinterval: '30',
    version: '1.1.0',
  };
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    insert.run(k, v);
  }
}

export function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pwd, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pwd, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.pbkdf2Sync(pwd, salt, 10000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

export function createSession(userId, ttlSeconds = 7 * 24 * 3600) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() / 1000 | 0 + ttlSeconds;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

export function getDb() {
  if (!db) return initDb();
  return db;
}
