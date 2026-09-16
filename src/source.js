// 直播源同步：拉取远程 M3U URL，解析入库
import { parseM3U, mergeChannels } from './m3u.js';

// 拉取远程 M3U 文本
export async function fetchM3U(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'XibaoIPTV/1.0'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 同步单个源：拉取并返回解析后的频道
export async function syncSource(sourceUrl) {
  const text = await fetchM3U(sourceUrl);
  return parseM3U(text);
}

// 同步所有启用的源，合并去重
export async function syncAllSources(sources) {
  const lists = [];
  for (const src of sources) {
    if (!src.enabled) continue;
    try {
      const channels = await syncSource(src.url);
      lists.push(channels);
      src.channel_count = channels.length;
      src.status = 'ok';
      src.last_sync = Date.now() / 1000 | 0;
    } catch (e) {
      src.status = 'error';
    }
  }
  return mergeChannels(lists);
}
