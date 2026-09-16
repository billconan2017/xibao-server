import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlaylist} from '../src/m3u.js';

test('local TXT preserves genre and HTTP, RTSP, UDP addresses', () => {
  const rows=parsePlaylist('家人常看,#genre#\n央视,http://192.0.2.1/live.m3u8\n地方台,rtsp://192.0.2.1/live\n地方二台,udp://239.0.0.1:1234');
  assert.equal(rows.length,3);
  assert.ok(rows.every(r=>r.group_name==='家人常看'));
  assert.equal(rows[1].url,'rtsp://192.0.2.1/live');
  assert.equal(rows[2].url,'udp://239.0.0.1:1234');
});

test('legacy genre notation and M3U remain supported', () => {
  assert.equal(parsePlaylist('#genre#央视#\nCCTV-1,http://192.0.2.1/1')[0].group_name,'央视');
  const rows=parsePlaylist('#EXTM3U\n#EXTINF:-1 group-title="央视" tvg-id="cctv1",CCTV-1\nhttp://192.0.2.1/1');
  assert.equal(rows[0].tvg_id,'cctv1');
  assert.equal(rows[0].group_name,'央视');
});
