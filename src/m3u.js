// M3U 播放列表解析与多源合并

// 解析 M3U 文本为频道对象数组
export function parseM3U(text) {
  const channels = [];
  const lines = text.split(/\r?\n/);
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      // #EXTINF:-1 tvg-id="CCTV1" tvg-logo="..." tvg-name="CCTV-1综合" group-title="央视",CCTV-1 综合
      const nameMatch = line.match(/,(.+)$/);
      const displayName = nameMatch ? nameMatch[1].trim() : '未命名';

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
      // 跳过注释和头部（#EXTM3U 等）
    } else if (current) {
      // 真正的流地址（可能是 http://、rtsp://、udp:// 等）
      channels.push({
        name: current.name,
        url: line,
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
