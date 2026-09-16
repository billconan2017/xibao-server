// 直播源同步：拉取远程 M3U/TXT URL，解析入库
import { parsePlaylist, mergeChannels } from './m3u.js';

// 拉取远程列表文本
export async function fetchM3U(url, timeoutMs = 30000, ua = 'XibaoIPTV/1.0') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': ua || 'XibaoIPTV/1.0'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 同步单个源：拉取并解析
export async function syncSource(source) {
  const text = await fetchM3U(source.url, 30000, source.ua);
  return parsePlaylist(text);
}

// 同步所有启用的源，合并去重；每个源的解析结果写入 src 对象
export async function syncAllSources(sources) {
  const lists = [];
  for (const src of sources) {
    if (!src.enabled) continue;
    try {
      const channels = await syncSource(src);
      lists.push(channels);
      src.channel_count = channels.length;
      src.status = 'ok';
      src.last_sync = Date.now() / 1000 | 0;
    } catch (e) {
      src.status = 'error';
      src.last_sync = Date.now() / 1000 | 0;
    }
  }
  return mergeChannels(lists);
}
