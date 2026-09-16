import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.XIBAO_DB_PATH || path.join(__dirname, '..', 'data', 'xibao.db');

// 确保 data 目录存在
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_name);
    CREATE INDEX IF NOT EXISTS idx_channels_enabled ON channels(enabled);
  `);

  return db;
}

export function getDb() {
  if (!db) return initDb();
  return db;
}
