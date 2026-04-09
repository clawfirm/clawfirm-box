import { timingSafeEqual, createHash } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(value).digest();
}

export function parseBearer(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (typeof header !== 'string') return '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

export function parseApiKey(req) {
  const header = req.headers['x-api-key'] || req.headers['X-API-Key'] || '';
  return typeof header === 'string' ? header : '';
}

export function isAuthorized(req, sharedSecret) {
  if (!sharedSecret) return false;
  const token = parseBearer(req) || parseApiKey(req);
  if (!token) return false;
  return timingSafeEqual(digest(token), digest(sharedSecret));
}
