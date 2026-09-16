// M3U/TXT 播放列表解析与多源合并
// 兼容清和逻辑：m3u8 和 txt 都支持，txt 用 #genre# 分组，m3u8 用 group-title

// 过滤 emoji（清和 FilterEmoji 逻辑）
export function filterEmoji(text) {
  if (!text) return text;
  return text.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{200D}\u{1F900}-\u{1F9FF}]/gu,
    ''
  ).trim();
}

// 判断是否是 M3U 格式（含 #EXTINF 或 #EXTM3U）
export function isM3UContent(text) {
  if (!text) return false;
  const head = text.slice(0, 4096);
  return /#EXTM3U/i.test(head) || /#EXTINF/i.test(head);
}

// 解析 M3U 文本（#EXTINF 格式，支持 group-title / tvg-id / tvg-logo / tvg-name）
export function parseM3U(text) {
  const channels = [];
  const lines = text.split(/\r?\n/);
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      const nameMatch = line.match(/,(.+)$/);
      const displayName = nameMatch ? filterEmoji(nameMatch[1].trim()) : '未命名';

      const attr = (key) => {
        const m = line.match(new RegExp(`${key}="([^"]*)"`));
        return m ? m[1].trim() : '';
      };

      current = {
        name: displayName,
        tvg_id: attr('tvg-id'),
        tvg_logo: attr('tvg-logo'),
        tvg_name: attr('tvg-name'),
        group_title: attr('group-title')
      };
    } else if (line.startsWith('#')) {
      // 跳过注释和头部
    } else if (current) {
      const url = line.trim();
      channels.push({
        name: current.name,
        url,
        group_name: current.group_title || '未分组',
        tvg_id: current.tvg_id || current.tvg_name || current.name,
        tvg_logo: current.tvg_logo,
        tvg_name: current.tvg_name || current.name
      });
      current = null;
    }
  }
  return channels;
}

// 解析 TXT 文本（#genre# 分组格式）
// 格式示例：
//   #genre#央视#
//   CCTV-1 综合,http://xxx/1.m3u8
//   湖南卫视,http://xxx/hunan.m3u8
// 支持逗号分隔：频道名,URL；也支持 m3u 那种 URL 单独一行的情况
export function parseTXT(text) {
  const channels = [];
  const lines = text.split(/\r?\n/);
  let currentGenre = '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // 检测 #genre# 分组标记：#genre#名称# 或 #genre#名称
    const genreMatch = line.match(/^#genre#\s*([^#,]+)/i);
    if (genreMatch) {
      currentGenre = genreMatch[1].trim();
      continue;
    }

    // 跳过其他注释
    if (line.startsWith('#') && !line.includes(',')) continue;

    // 解析频道行：支持 "名称,URL" 用逗号/空白分隔
    // 优先逗号，其次空白；名字在前，URL 在后（含 http/rtsp/udp 等协议）
    const protocolMatches = [
      line.search(/https?:\/\//i),
      line.search(/rtsp:\/\//i),
      line.search(/rtmp:\/\//i),
      line.search(/udp:\/\//i)
    ].filter(index => index >= 0);
    const urlIdx = protocolMatches.length ? Math.min(...protocolMatches) : -1;
    if (urlIdx < 0) continue;

    const url = line.slice(urlIdx).trim();
    // 名称 = URL 前面部分，去掉分隔逗号
    let name = line.slice(0, urlIdx).replace(/[,，\s]+$/, '').trim();

    if (!name) {
      // 没有名称，用 URL 文件名兜底
      name = url.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '') || '未命名';
    }

    name = filterEmoji(name);

    channels.push({
      name,
      url,
      group_name: currentGenre || '未分组',
      tvg_id: name,
      tvg_logo: '',
      tvg_name: name
    });
  }
  return channels;
}

// 统一解析入口：自动判断 m3u8 还是 txt
export function parsePlaylist(text) {
  if (!text) return [];
  const clean = filterEmoji(text);
  if (isM3UContent(clean)) {
    return parseM3U(clean);
  }
  return parseTXT(clean);
}

// 合并去重：以 (name, url) 唯一，重复的保留第一个
export function mergeChannels(channelLists) {
  const seen = new Map();
  let idx = 0;
  for (const list of channelLists) {
    for (const ch of list) {
      const key = `${ch.name}|${ch.url}`;
      if (!seen.has(key)) {
        seen.set(key, { ...ch, sort_order: idx++ });
      }
    }
  }
  return Array.from(seen.values());
}

// 生成 M3U 文本
export function generateM3U(channels) {
  const lines = ['#EXTM3U'];
  for (const ch of channels) {
    const attrs = [
      `tvg-id="${ch.tvg_id || ''}"`,
      `tvg-logo="${ch.tvg_logo || ''}"`,
      `tvg-name="${ch.tvg_name || ch.name}"`,
      `group-title="${ch.group_name || ''}"`
    ].join(' ');
    lines.push(`#EXTINF:-1 ${attrs},${ch.name}`);
    lines.push(ch.url);
  }
  return lines.join('\n') + '\n';
}
