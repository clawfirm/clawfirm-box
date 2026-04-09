import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';

import { createServer } from '../src/server.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawfirm-adapter-'));
}

async function createArchive(files) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  const archiveBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  return {
    archiveBase64: archiveBuffer.toString('base64'),
    archiveBytes: archiveBuffer.length,
  };
}

async function start(overrides = {}) {
  const root = tempRoot();
  const calls = [];
  const dnsExecutor = async (command, payload) => {
    calls.push({ command, payload });
    if (command.includes('read')) {
      return { ok: true, zone: payload.zone, records: [{ type: 'A', name: '@', value: '137.184.33.34', ttl: 300 }] };
    }
    return { ok: true, zone: payload.zone, mode: payload.mode, recordCount: payload.records?.length || 0 };
  };
  const server = createServer({
    port: 0,
    sharedSecret: 'test-secret',
    sitesRoot: root,
    dnsReadCommand: '/usr/local/bin/clawfirm-dns-read',
    dnsApplyCommand: '/usr/local/bin/clawfirm-dns-apply',
    dnsExecutor,
    ...overrides,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, baseUrl, calls };
}

test('health endpoint works', async (t) => {
  const { server, baseUrl } = await start();
  t.after(() => server.close());
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
});

test('publish requires auth and returns a staged release for zip payload', async (t) => {
  const { server, baseUrl } = await start();
  t.after(() => server.close());

  const archive = await createArchive({
    'index.html': '<html><head></head><body>hi</body></html>',
    'assets/logo.png': Buffer.from([0, 1, 2, 3]),
  });

  const unauth = await fetch(`${baseUrl}/publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ domain: 'example.com', ...archive }) });
  assert.equal(unauth.status, 401);

  const res = await fetch(`${baseUrl}/publish`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ domain: 'example.com', ...archive }),
  });
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.ok(payload.releaseId);
  assert.ok(payload.artifactSha256);
  assert.equal(payload.activated, false);
  assert.equal(payload.liveUrl, null);
  assert.equal(payload.livePath, null);
  assert.match(payload.releasePath, /example\.com\/releases\//);
});

test('adapter also accepts x-api-key auth for all-in-one compatibility', async (t) => {
  const { server, baseUrl } = await start();
  t.after(() => server.close());

  const res = await fetch(`${baseUrl}/admin/system-health`, {
    method: 'POST',
    headers: {
      'x-api-key': 'test-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.ok, true);
});

test('publish accepts direct file payload', async (t) => {
  const { server, baseUrl } = await start();
  t.after(() => server.close());

  const res = await fetch(`${baseUrl}/publish`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      domain: 'example.com',
      archiveBytes: 77,
      archiveSha256: 'direct-payload-sha',
      html: '<html><head></head><body>direct</body></html>',
      files: {
        'assets/logo.png': { encoding: 'base64', content: Buffer.from([0, 1, 2, 3]).toString('base64') },
      },
    }),
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.ok(payload.releaseId);
  assert.equal(payload.archiveBytes, 77);
  assert.equal(payload.artifactSha256, 'direct-payload-sha');
  assert.equal(payload.activated, false);
});

test('publish can activate a release immediately when requested', async (t) => {
  const { server, baseUrl } = await start();
  t.after(() => server.close());

  const archive = await createArchive({
    'index.html': '<html><head></head><body>active</body></html>',
  });

  const res = await fetch(`${baseUrl}/publish`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ domain: 'example.com', activate: true, ...archive }),
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.activated, true);
  assert.equal(payload.liveUrl, 'https://example.com');
});

test('stats endpoints require auth and return aggregated release data', async (t) => {
  const root = tempRoot();
  const logPath = path.join(root, 'access.log');
  fs.mkdirSync(path.join(root, 'knowledgecli.com', 'releases', 'r1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledgecli.com', 'releases', 'r1', 'index.html'), '<html></html>', 'utf8');
  fs.writeFileSync(logPath, [
    JSON.stringify({ ts: '2026-04-01T00:00:00Z', domain: 'knowledgecli.com', releaseId: 'r1', path: '/', status: 200, bytes: 100, ip: '1.1.1.1' }),
    JSON.stringify({ ts: '2026-04-01T00:01:00Z', domain: 'knowledgecli.com', releaseId: 'r1', path: '/docs', status: 404, bytes: 50, ip: '2.2.2.2' }),
  ].join('\n') + '\n', 'utf8');

  const { server, baseUrl } = await start({ sitesRoot: root, accessLogPath: logPath });
  t.after(() => server.close());

  const unauth = await fetch(`${baseUrl}/stats/release-summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'knowledgecli.com', releaseId: 'r1' }),
  });
  assert.equal(unauth.status, 401);

  const summaryRes = await fetch(`${baseUrl}/stats/release-summary`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'knowledgecli.com', releaseId: 'r1' }),
  });
  assert.equal(summaryRes.status, 200);
  const summary = await summaryRes.json();
  assert.equal(summary.requests, 2);
  assert.equal(summary.statusCodes['404'], 1);

  const topRes = await fetch(`${baseUrl}/stats/release-top-paths`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ domain: 'knowledgecli.com', releaseId: 'r1' }),
  });
  assert.equal(topRes.status, 200);
  const top = await topRes.json();
  assert.equal(top.paths.length, 2);
});

test('admin health endpoints require auth and return health payloads', async (t) => {
  const root = tempRoot();
  const logPath = path.join(root, 'access.log');
  fs.writeFileSync(logPath, 'ok', 'utf8');
  const { server, baseUrl } = await start({
    sitesRoot: root,
    accessLogPath: logPath,
    commandExecutor: async (command, args) => {
      if (command === 'systemctl' && args[0] === 'is-active') {
        return { stdout: 'active\n', stderr: '' };
      }
      return { stdout: 'ok\n', stderr: '' };
    },
  });
  t.after(() => server.close());

  const unauth = await fetch(`${baseUrl}/admin/system-health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(unauth.status, 401);

  const systemRes = await fetch(`${baseUrl}/admin/system-health`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(systemRes.status, 200);
  const systemPayload = await systemRes.json();
  assert.equal(systemPayload.ok, true);
  assert.equal(typeof systemPayload.host.ramTotalBytes, 'number');

  const serviceRes = await fetch(`${baseUrl}/admin/service-health`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(serviceRes.status, 200);
  const servicePayload = await serviceRes.json();
  assert.equal(servicePayload.services.caddy.running, true);

  const storageRes = await fetch(`${baseUrl}/admin/storage-health`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(storageRes.status, 200);

  const logRes = await fetch(`${baseUrl}/admin/log-pipeline-health`, {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(logRes.status, 200);
  const logPayload = await logRes.json();
  assert.equal(logPayload.statsPipeline.logPath, logPath);
});

test('dns apply endpoint sends structured intent to executor', async (t) => {
  const { server, baseUrl, calls } = await start();
  t.after(() => server.close());

  const res = await fetch(`${baseUrl}/dns/apply-records`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      zone: 'example.com',
      requestedBy: 'jackie',
      records: [
        { type: 'A', name: '@', value: '137.184.33.34', ttl: 300 },
        { type: 'CNAME', name: 'www', value: '@', ttl: 300 },
      ],
    }),
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.mode, 'replace');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/usr/local/bin/clawfirm-dns-apply');
  assert.equal(calls[0].payload.records[1].fqdn, 'www.example.com');
});

test('domains reconcile endpoint ensures runtime readiness', async (t) => {
  const root = tempRoot();
  const server = createServer({
    port: 0,
    sharedSecret: 'test-secret',
    sitesRoot: path.join(root, 'sites'),
    caddyConfigPath: path.join(root, 'Caddyfile'),
    caddySitesDir: path.join(root, 'sites-enabled'),
    caddyReloadCommand: 'echo reload-caddy',
    dnsReadCommand: '/usr/local/bin/clawfirm-dns-read',
    dnsApplyCommand: '/usr/local/bin/clawfirm-dns-apply',
    dnsDefaultARecords: ['137.184.33.34'],
    dnsDefaultAaaaRecords: [],
    dnsExecutor: async (command, payload) => {
      if (command.includes('read')) return { ok: true, zone: payload.zone, exists: false, records: [] };
      return { ok: true, zone: payload.zone, mode: payload.mode, records: payload.records };
    },
    commandExecutor: async () => ({ stdout: 'ok', stderr: '' }),
    probeFn: async () => ({ ok: true, status: 200 }),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(() => server.close());

  const res = await fetch(`${baseUrl}/domains/reconcile`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ domain: 'knowledgecli.com', requestedBy: 'tester' }),
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.domain, 'knowledgecli.com');
  assert.equal(payload.runtimeReady, true);
  assert.equal(payload.tlsReady, true);
  assert.equal(payload.diagnosis, 'ok');
  assert.equal(payload.retryable, false);
  assert.equal(payload.sshRequired, false);
});

test('dns get-zone endpoint uses read command', async (t) => {
  const { server, baseUrl, calls } = await start();
  t.after(() => server.close());

  const res = await fetch(`${baseUrl}/dns/get-zone`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ zone: 'example.com' }),
  });

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.zone, 'example.com');
  assert.equal(calls[0].command, '/usr/local/bin/clawfirm-dns-read');
});
