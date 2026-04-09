import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import { getConfig } from './config.js';
import { isAuthorized, parseBearer } from './auth.js';
import { getLogPipelineHealth, getServiceHealth, getStorageHealth, getSystemHealth } from './admin-health.js';
import { getZone, ensureZone, applyZoneRecords } from './dns.js';
import { reconcileDomain } from './domains.js';
import { deleteRelease, listReleases, publishRelease, rollbackRelease } from './releases.js';
import { getReleaseSummary, getReleaseTopPaths } from './stats.js';

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function normalizedPath(url = '') {
  const pathname = (url.split('?')[0] || '/').replace(/\/+/g, '/');
  const known = ['/admin/system-health', '/admin/service-health', '/admin/storage-health', '/admin/log-pipeline-health', '/stats/release-summary', '/stats/release-top-paths', '/dns/get-zone', '/dns/ensure-zone', '/dns/apply-records', '/domains/reconcile', '/publish', '/releases', '/rollback', '/delete-release', '/health'];
  for (const suffix of known) {
    if (pathname === suffix || pathname.endsWith(suffix)) return suffix;
  }
  if (pathname === '/api' || pathname === '/api/') return '/';
  if (pathname.startsWith('/api/')) return pathname.slice(4);
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

function verifyPublishUploadToken(token, sharedSecret, body) {
  if (!token || !sharedSecret) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const [_, encodedPayload, signature] = parts;
  const expected = createHmac('sha256', sharedSecret).update(encodedPayload).digest('hex');
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return false;
  }

  if (payload?.purpose !== 'publish-upload') return false;
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return false;
  if (payload.domain !== body.domain) return false;
  if (payload.archiveSha256 !== body.archiveSha256) return false;
  if (Number(payload.archiveBytes) !== Number(body.archiveBytes)) return false;
  return true;
}

function canPublish(req, config, body) {
  if (isAuthorized(req, config.sharedSecret)) return true;
  const token = parseBearer(req);
  return verifyPublishUploadToken(token, config.sharedSecret, body);
}

export function createServer(config = getConfig()) {
  return http.createServer(async (req, res) => {
    try {
      const path = normalizedPath(req.url);

      if (req.method === 'GET' && path === '/health') {
        return send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && path === '/publish') {
        const body = await readJson(req);
        if (!canPublish(req, config, body)) {
          return send(res, 401, { error: 'Unauthorized' });
        }
        if (!body.domain) return send(res, 400, { error: 'domain is required' });
        const result = await publishRelease(config.sitesRoot, body.domain, {
          activate: Boolean(body.activate),
          archiveBase64: body.archiveBase64,
          archiveFormat: body.archiveFormat,
          archiveBytes: body.archiveBytes,
          archiveSha256: body.archiveSha256,
          files: body.files || {},
          html: body.html || '',
          title: body.title || '',
        });
        return send(res, 200, result);
      }

      if (!isAuthorized(req, config.sharedSecret)) {
        return send(res, 401, { error: 'Unauthorized' });
      }

      if (req.method === 'POST' && path === '/admin/system-health') {
        return send(res, 200, await getSystemHealth(config));
      }

      if (req.method === 'POST' && path === '/admin/service-health') {
        return send(res, 200, await getServiceHealth(config));
      }

      if (req.method === 'POST' && path === '/admin/storage-health') {
        return send(res, 200, await getStorageHealth(config));
      }

      if (req.method === 'POST' && path === '/admin/log-pipeline-health') {
        return send(res, 200, await getLogPipelineHealth(config));
      }

      if (req.method === 'POST' && path === '/stats/release-summary') {
        const body = await readJson(req);
        return send(res, 200, await getReleaseSummary(config, body));
      }

      if (req.method === 'POST' && path === '/stats/release-top-paths') {
        const body = await readJson(req);
        return send(res, 200, await getReleaseTopPaths(config, body));
      }

      if (req.method === 'POST' && path === '/releases') {
        const body = await readJson(req);
        if (!body.domain) return send(res, 400, { error: 'domain is required' });
        const releases = listReleases(config.sitesRoot, body.domain);
        return send(res, 200, { releases });
      }

      if (req.method === 'POST' && path === '/rollback') {
        const body = await readJson(req);
        if (!body.domain || !body.releaseId) return send(res, 400, { error: 'domain and releaseId are required' });
        const result = rollbackRelease(config.sitesRoot, body.domain, body.releaseId);
        return send(res, 200, result);
      }

      if (req.method === 'POST' && path === '/delete-release') {
        const body = await readJson(req);
        if (!body.domain || !body.releaseId) return send(res, 400, { error: 'domain and releaseId are required' });
        const result = deleteRelease(config.sitesRoot, body.domain, body.releaseId);
        return send(res, 200, result);
      }

      if (req.method === 'POST' && path === '/dns/get-zone') {
        const body = await readJson(req);
        const result = await getZone(config, body, config.dnsExecutor);
        return send(res, 200, result);
      }

      if (req.method === 'POST' && path === '/dns/ensure-zone') {
        const body = await readJson(req);
        const result = await ensureZone(config, body, config.dnsExecutor);
        return send(res, 200, result);
      }

      if (req.method === 'POST' && path === '/dns/apply-records') {
        const body = await readJson(req);
        const result = await applyZoneRecords(config, body, config.dnsExecutor);
        return send(res, 200, result);
      }

      if (req.method === 'POST' && path === '/domains/reconcile') {
        const body = await readJson(req);
        if (!body.domain) return send(res, 400, { error: 'domain is required' });
        const result = await reconcileDomain(config, body, {
          dnsExecutor: config.dnsExecutor,
          probeFn: config.probeFn,
        });
        return send(res, 200, result);
      }

      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      return send(res, 500, { error: error instanceof Error ? error.message : 'Internal error' });
    }
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const config = getConfig();
  const server = createServer(config);
  server.listen(config.port, () => {
    console.log(`Clawfirm adapter listening on :${config.port}`);
  });
}
