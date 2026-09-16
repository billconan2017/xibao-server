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
  return applySourceOptions(parsePlaylist(text), source);
}

function normalizeChannelName(name) {
  return String(name || '')
    .replace(/[（(]?\s*(?:高清|超清|HD)\s*[)）]?$/i, '')
    .replace(/^CCTV\s*[-－]?\s*(\d+[+]?)/i, 'CCTV-$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferGroup(name) {
  if (/^(?:CCTV|央视)/i.test(name)) return '央视';
  if (/卫视/.test(name)) return '卫视';
  if (/(?:少儿|卡通|动漫)/.test(name)) return '少儿动漫';
  if (/(?:电影|影院|剧场)/.test(name)) return '影视';
  return '其他';
}

// 把管理页的源选项应用到单个源，避免开关只显示却不起作用。
export function applySourceOptions(channels, source = {}) {
  const seenUrls = new Set();
  const result = [];

  for (const item of channels) {
    const channel = { ...item };
    if (source.rename) {
      channel.name = normalizeChannelName(channel.name) || channel.name;
      channel.tvg_name = normalizeChannelName(channel.tvg_name) || channel.name;
    }
    if (source.auto_group && (!channel.group_name || channel.group_name === '未分组')) {
      channel.group_name = inferGroup(channel.name);
    }
    if (source.dedup) {
      if (seenUrls.has(channel.url)) continue;
      seenUrls.add(channel.url);
    }
    result.push(channel);
  }
  return result;
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
      src.error = String(e.message || e);
      src.last_sync = Date.now() / 1000 | 0;
    }
  }
  return mergeChannels(lists);
}
