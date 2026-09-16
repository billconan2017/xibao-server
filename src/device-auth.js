import crypto from 'node:crypto';
import { getDb, getSetting } from './store.js';
import { getAuthUser } from './auth.js';

export const tokenHash = value => crypto.createHash('sha256').update(value).digest('hex');
export function deviceAllowed(device) {
  return !!(device?.meal_id && (!device.exp_at || device.exp_at > Date.now() / 1000)
    && getDb().prepare('SELECT id FROM meals WHERE id=? AND status=1').get(device.meal_id));
}
export function authenticatedDevice(req) {
  const id = String(req.headers['x-device-id'] || req.query.device_id || '');
  const token = String(req.headers['x-device-token'] || '');
  if (!token || token.length > 256) return null;
  const device = getDb().prepare('SELECT * FROM devices WHERE device_id=?').get(id);
  return device?.token_hash && device.token_hash === tokenHash(token) ? device : null;
}
export function requireDevice(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (getAuthUser(req)) return next();
  if (getSetting('client_needauthor', '1') !== '1') return next();
  const device = authenticatedDevice(req);
  if (!device || !deviceAllowed(device)) return res.status(403).json({ code:403, msg:'设备未授权、凭据无效或授权已过期，请在管理平台放行设备' });
  req.device = device;
  next();
}

// Bounded, per-address request counters. Do not trust arbitrary forwarded headers.
export function rateLimit(limit = 120, windowMs = 60000) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now(), key = req.ip || req.socket.remoteAddress;
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (buckets.size >= 4096) for (const [k,v] of buckets) if(v.until <= now) buckets.delete(k);
      if (buckets.size >= 4096 && !bucket) return res.status(429).json({code:429,msg:'请求过多，请稍后重试'});
      bucket = {until:now + windowMs, count:0}; buckets.set(key,bucket);
    }
    if (++bucket.count > limit) return res.status(429).set('Retry-After',String(Math.ceil((bucket.until-now)/1000))).json({code:429,msg:'请求过多，请稍后重试'});
    next();
  };
}
