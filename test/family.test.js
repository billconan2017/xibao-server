import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'xibao-test-'));
process.env.XIBAO_DB_PATH=path.join(folder,'test.db');
const {initDb,setSetting}=await import('../src/store.js');
const {default:api}=await import('../src/routes/api.js');
const {default:advanced}=await import('../src/routes/advanced.js');
const {default:epg,parseXmltv,syncEpgInternal}=await import('../src/routes/epg.js');
const {default:vod,normalizeVod}=await import('../src/routes/vod.js');
const db=initDb();let server,base,upstream,sourceBase;
const id='xibao-test-family-device',secret='a'.repeat(64),headers={'Content-Type':'application/json','X-Device-Id':id,'X-Device-Token':secret};
before(async()=>{
  const app=express();app.use(express.json());app.use('/api',api,advanced,epg,vod);app.use('/',api,advanced);
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;
  const mock=express();mock.get('/xml',(_,res)=>res.type('xml').send(`<tv><channel id="numeric-100"><display-name>CCTV-1 综合</display-name></channel><programme start="20990101000000 +0800" stop="20990101010000 +0800" channel="numeric-100"><title>新闻 &amp; 生活</title></programme></tv>`));
  mock.get('/vod',(_,res)=>res.json({page:1,pagecount:1,list:[{vod_id:1,vod_name:'家庭影片',vod_play_url:'正片$http://127.0.0.1/movie.mp4'}]}));
  upstream=await new Promise(resolve=>{const s=mock.listen(0,'127.0.0.1',()=>resolve(s));});sourceBase=`http://127.0.0.1:${upstream.address().port}`;
});
after(async()=>{await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>upstream.close(r))]);db.close();fs.rmSync(folder,{recursive:true,force:true});});
async function request(route,options={}){return fetch(base+route,options);}
test('secure family onboarding, aliases, revoke, expiry and disabled groups',async()=>{
  assert.equal((await request('/api/channels.json')).status,403);
  for(const route of ['/api/channels','/channels','/api/sources','/sources','/m3u','/api/m3u','/api/m3u.txt','/api/api/m3u.txt','/mytv/getUserM3U8','/api/mytv/getUserM3U8']) {
    const response=await request(route,{redirect:'manual'});assert.ok([401,302].includes(response.status),route);
  }
  let response=await request('/api/device/heartbeat',{method:'POST',headers,body:JSON.stringify({device_id:id,name:'test'})});assert.equal(response.status,200);assert.equal((await response.json()).data.authorized,false);
  db.prepare("INSERT INTO meals(name,rss_key) VALUES ('test','private-test-key')").run();const meal=db.prepare('SELECT id FROM meals').get().id;
  db.prepare('UPDATE devices SET meal_id=? WHERE device_id=?').run(meal,id);
  assert.equal((await request('/api/channels.json',{headers})).status,200);
  assert.equal((await request('/api/channels.json?device_id='+id)).status,403);
  assert.equal((await request('/api/channels.json',{headers:{...headers,'X-Device-Token':'b'.repeat(64)}})).status,403);
  assert.equal((await request('/api/device/heartbeat',{method:'POST',headers:{...headers,'X-Device-Token':'b'.repeat(64)},body:JSON.stringify({device_id:id})})).status,401);
  db.prepare('UPDATE meals SET status=0 WHERE id=?').run(meal);
  assert.equal((await request('/api/channels.json',{headers})).status,403);assert.equal((await request('/rss/private-test-key')).status,404);
  db.prepare('UPDATE meals SET status=1 WHERE id=?').run(meal);db.prepare('UPDATE devices SET exp_at=1 WHERE device_id=?').run(id);
  assert.equal((await request('/api/channels.json',{headers})).status,403);
  db.prepare('UPDATE devices SET exp_at=0, meal_id=0 WHERE device_id=?').run(id);assert.equal((await request('/api/channels.json',{headers})).status,403);
  db.prepare('UPDATE devices SET meal_id=? WHERE device_id=?').run(meal,id);
});
test('XMLTV display names and time window exclude stale first fifty programs',async()=>{
  const xml=`<tv><channel id='42'><display-name>CCTV-1 综合</display-name></channel><programme start='20260916140000 +0800' stop='20260916150000 +0800' channel='42'><title>新闻 &amp; 生活</title></programme></tv>`;
  const parsed=parseXmltv(xml);assert.equal(parsed[0].title,'新闻 & 生活');assert.equal(parsed[0].names[0],'CCTV-1 综合');assert.equal(parsed[0].start,Date.parse('2026-09-16T14:00:00+08:00')/1000);
  db.prepare("INSERT INTO channels(name,url) VALUES ('CCTV-1 综合','http://source.invalid/live')").run();const channel=db.prepare('SELECT id FROM channels').get().id;
  db.prepare("INSERT INTO epgs(name,url) VALUES ('test',?)").run(sourceBase+'/xml');
  const synced=await syncEpgInternal(db);assert.equal(synced.total,1);
  const insert=db.prepare('INSERT INTO programs(epg_id,channel_id,title,start_time,end_time) VALUES (1,?,?,?,?)');
  const now=Math.floor(Date.now()/1000);for(let i=0;i<60;i++)insert.run(channel,'过去节目',now-10000-i*100,now-9000-i*100);
  insert.run(channel,'现在的节目',now-600,now+600);
  const response=await request('/api/epg?name='+encodeURIComponent('CCTV-1 综合'),{headers});const body=await response.json();assert.equal(body.data.programs.length,1);assert.equal(body.data.programs[0].title,'现在的节目');
  db.prepare("UPDATE programs SET channel_name='CCTV-1 综合' WHERE title='现在的节目'").run();
  db.prepare('DELETE FROM channels WHERE id=?').run(channel);db.prepare("INSERT INTO channels(name,url) VALUES ('CCTV-1 综合','http://source.invalid/new')").run();
  const afterSync=await request('/api/epg?name='+encodeURIComponent('CCTV-1 综合'),{headers});assert.equal((await afterSync.json()).data.programs[0].title,'现在的节目');
});
test('VOD only enabled sources, device authorization and playable episodes',async()=>{
  assert.equal((await request('/api/vod/sources')).status,403);
  db.prepare("INSERT INTO movies(name,api) VALUES ('家庭源',?)").run(sourceBase+'/vod');const source=db.prepare('SELECT id FROM movies').get().id;
  const response=await request('/api/vod/catalog?source='+source,{headers});assert.equal(response.status,200);assert.equal((await response.json()).data.items[0].lines[0].episodes[0].name,'正片');
  assert.equal(normalizeVod({vod_play_url:'一$javascript:alert(1)#二$https://example.com/a.m3u8'}).lines[0].episodes.length,1);
  db.prepare('UPDATE movies SET state=0').run();assert.equal((await request('/api/vod/catalog?source='+source,{headers})).status,404);
});
