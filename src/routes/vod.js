import express from 'express';
import { getDb } from '../store.js';
import { requireDevice, rateLimit } from '../device-auth.js';

const router = express.Router();
router.use('/vod', rateLimit(60), requireDevice);
router.get('/vod/sources', (req,res) => res.json({code:0,data:getDb().prepare('SELECT id,name FROM movies WHERE state=1 ORDER BY id').all()}));
const cache = new Map();
let active = 0;
export function normalizeVod(row) {
  const groups = String(row.vod_play_url || '').split('$$$');
  const names = String(row.vod_play_from || '').split('$$$');
  const lines = groups.map((group,index) => ({name:names[index] || `线路 ${index+1}`,episodes:group.split('#').map((entry,i)=> {
    const split=entry.indexOf('$');
    return {name:split<0 ? `第 ${i+1} 集` : entry.slice(0,split),url:split<0 ? entry : entry.slice(split+1)};
  }).filter(e=>/^https?:\/\//i.test(e.url))})).filter(line=>line.episodes.length);
  return {id:String(row.vod_id ?? ''),name:String(row.vod_name || '未命名'),remarks:String(row.vod_remarks || ''),year:String(row.vod_year || ''),type:String(row.type_name || ''),description:String(row.vod_content || '').replace(/<[^>]*>/g,'').slice(0,2000),lines};
}
async function fetchCatalog(url) {
  const key=url.toString(), hit=cache.get(key);
  if(hit && hit.until>Date.now()) return hit.data;
  if(active>=4) throw new Error('点播源请求繁忙，请稍后重试');
  active++;
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok) throw new Error('点播源返回 HTTP '+response.status);
    let length=0; const chunks=[];
    for await(const chunk of response.body) { length+=chunk.length; if(length>4*1024*1024) {controller.abort();throw new Error('点播源响应过大');} chunks.push(chunk); }
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!Array.isArray(data.list)) throw new Error('仅支持苹果 CMS JSON 接口，接口未返回 list 列表');
    if(cache.size>=64) cache.delete(cache.keys().next().value);
    cache.set(key,{until:Date.now()+30000,data}); return data;
  } finally {clearTimeout(timer);active--;}
}
router.get('/vod/catalog', async (req,res) => {
  const source=getDb().prepare('SELECT * FROM movies WHERE id=? AND state=1').get(String(req.query.source || ''));
  if(!source) return res.status(404).json({code:1,msg:'请先在后台添加并启用点播源'});
  try {
    const url=new URL(source.api);
    if(!['http:','https:'].includes(url.protocol)) throw new Error('点播接口必须是 HTTP 或 HTTPS');
    url.searchParams.set('ac','detail');
    url.searchParams.set('pg',String(Math.min(10000,Math.max(1,parseInt(req.query.page)||1))));
    if(req.query.search) url.searchParams.set('wd',String(req.query.search).slice(0,100));
    if(req.query.id) url.searchParams.set('ids',String(req.query.id).slice(0,100));
    const body=await fetchCatalog(url);
    res.json({code:0,data:{page:Number(body.page)||1,pages:Number(body.pagecount)||1,items:body.list.slice(0,100).map(normalizeVod)}});
  } catch(error) {res.status(502).json({code:1,msg:error.name==='AbortError'?'点播源连接超时':error.message});}
});
export default router;
