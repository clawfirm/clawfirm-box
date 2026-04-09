import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getReleaseSummary, getReleaseTopPaths } from '../src/stats.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawfirm-stats-'));
}

function seedRelease(root, domain, releaseId) {
  const releaseDir = path.join(root, domain, 'releases', releaseId);
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, 'index.html'), '<html></html>', 'utf8');
}

function writeLog(logPath, entries) {
  fs.writeFileSync(logPath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
}

test('getReleaseSummary aggregates requests for one domain+release', async () => {
  const root = tempRoot();
  const logPath = path.join(root, 'access.log');
  seedRelease(root, 'knowledgecli.com', 'r1');
  seedRelease(root, 'knowledgecli.com', 'r2');
  writeLog(logPath, [
    { ts: '2026-04-01T00:00:00Z', domain: 'knowledgecli.com', releaseId: 'r1', path: '/', status: 200, bytes: 100, ip: '1.1.1.1' },
    { ts: '2026-04-01T00:05:00Z', domain: 'knowledgecli.com', releaseId: 'r1', path: '/', status: 200, bytes: 200, ip: '2.2.2.2' },
    { ts: '2026-04-01T00:06:00Z', domain: 'knowledgecli.com', releaseId: 'r1', path: '/docs', status: 404, bytes: 50, ip: '1.1.1.1' },
    { ts: '2026-04-01T00:07:00Z', domain: 'knowledgecli.com', releaseId: 'r2', path: '/', status: 200, bytes: 300, ip: '3.3.3.3' },
  ]);

  const result = await getReleaseSummary({ sitesRoot: root, accessLogPath: logPath }, {
    domain: 'knowledgecli.com',
    releaseId: 'r1',
    since: '2026-04-01T00:00:00Z',
    until: '2026-04-01T01:00:00Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.requests, 3);
  assert.equal(result.uniqueIps, 2);
  assert.equal(result.bytesServed, 350);
  assert.deepEqual(result.statusCodes, { '200': 2, '404': 1 });
});

test('getReleaseTopPaths returns ranked paths', async () => {
  const root = tempRoot();
  const logPath = path.join(root, 'access.log');
  seedRelease(root, 'knowledgecli.com', 'r1');
  writeLog(logPath, [
    { ts: '2026-04-01T00:00:00Z', domain: 'knowledgecli.com', releaseId: 'r1', path: '/', status: 200, bytes: 100, ip: '1.1.1.1' },
    { ts: '2026-04-01T00:01:00Z', domain: 'knowledgecli.com', releaseId: 'r1', path: '/', status: 200, bytes: 100, ip: '2.2.2.2' },
    { ts: '2026-04-01T00:02:00Z', domain: 'knowledgecli.com', releaseId: 'r1', path: '/docs', status: 200, bytes: 300, ip: '3.3.3.3' },
  ]);

  const result = await getReleaseTopPaths({ sitesRoot: root, accessLogPath: logPath }, {
    domain: 'knowledgecli.com',
    releaseId: 'r1',
    limit: 10,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.paths, [
    { path: '/', requests: 2, bytesServed: 200 },
    { path: '/docs', requests: 1, bytesServed: 300 },
  ]);
});

test('stats fall back to current release when log lines omit explicit releaseId', async () => {
  const root = tempRoot();
  const logPath = path.join(root, 'access.log');
  seedRelease(root, 'knowledgecli.com', 'r1');
  const currentPath = path.join(root, 'knowledgecli.com', 'current');
  fs.symlinkSync(path.join(root, 'knowledgecli.com', 'releases', 'r1'), currentPath, 'dir');
  writeLog(logPath, [
    { ts: '2026-04-01T00:00:00Z', request: { host: 'knowledgecli.com', uri: '/' }, status: 200, bytes: 100, remote_ip: '1.1.1.1' },
    { ts: '2026-04-01T00:01:00Z', request: { host: 'knowledgecli.com', uri: '/docs' }, status: 200, bytes: 150, remote_ip: '2.2.2.2' },
  ]);

  const result = await getReleaseSummary({ sitesRoot: root, accessLogPath: logPath }, {
    domain: 'knowledgecli.com',
    releaseId: 'r1',
  });

  assert.equal(result.requests, 2);
  assert.equal(result.bytesServed, 250);
});

test('stats match Caddy host values with ports', async () => {
  const root = tempRoot();
  const logPath = path.join(root, 'access.log');
  seedRelease(root, 'dantevr.com', 'r1');
  const currentPath = path.join(root, 'dantevr.com', 'current');
  fs.symlinkSync(path.join(root, 'dantevr.com', 'releases', 'r1'), currentPath, 'dir');
  writeLog(logPath, [
    { ts: '2026-04-01T00:00:00Z', request: { host: 'dantevr.com:443', uri: '/' }, status: 200, size: 123, remote_ip: '1.1.1.1' },
  ]);

  const result = await getReleaseSummary({ sitesRoot: root, accessLogPath: logPath }, {
    domain: 'dantevr.com',
    releaseId: 'r1',
  });

  assert.equal(result.requests, 1);
  assert.equal(result.bytesServed, 123);
});

test('stats count www alias traffic for the paired domain', async () => {
  const root = tempRoot();
  const logPath = path.join(root, 'access.log');
  seedRelease(root, 'knowledgecli.com', 'r1');
  const currentPath = path.join(root, 'knowledgecli.com', 'current');
  fs.symlinkSync(path.join(root, 'knowledgecli.com', 'releases', 'r1'), currentPath, 'dir');
  writeLog(logPath, [
    { ts: '2026-04-01T00:00:00Z', request: { host: 'www.knowledgecli.com', uri: '/' }, status: 200, bytes: 100, remote_ip: '1.1.1.1' },
    { ts: '2026-04-01T00:01:00Z', request: { host: 'www.knowledgecli.com:443', uri: '/docs' }, status: 200, bytes: 150, remote_ip: '2.2.2.2' },
  ]);

  const result = await getReleaseSummary({ sitesRoot: root, accessLogPath: logPath }, {
    domain: 'knowledgecli.com',
    releaseId: 'r1',
  });

  assert.equal(result.requests, 2);
  assert.equal(result.bytesServed, 250);
});

test('stats parse numeric unix-second timestamps from Caddy json logs', async () => {
  const root = tempRoot();
  const logPath = path.join(root, 'access.log');
  seedRelease(root, 'dantevr.com', 'r1');
  const currentPath = path.join(root, 'dantevr.com', 'current');
  fs.symlinkSync(path.join(root, 'dantevr.com', 'releases', 'r1'), currentPath, 'dir');
  writeLog(logPath, [
    { ts: 1775095885.4536376, request: { host: 'dantevr.com', uri: '/' }, status: 200, size: 34115, remote_ip: '137.184.33.34' },
    { ts: '1775095885.5373414', request: { host: 'www.dantevr.com', uri: '/' }, status: 200, size: 34115, remote_ip: '137.184.33.34' },
  ]);

  const result = await getReleaseSummary({ sitesRoot: root, accessLogPath: logPath }, {
    domain: 'dantevr.com',
    releaseId: 'r1',
  });

  assert.equal(result.requests, 2);
  assert.equal(result.bytesServed, 68230);
});

test('stats reject unknown release ids', async () => {
  const root = tempRoot();
  const logPath = path.join(root, 'access.log');
  writeLog(logPath, []);

  await assert.rejects(
    () => getReleaseSummary({ sitesRoot: root, accessLogPath: logPath }, { domain: 'knowledgecli.com', releaseId: 'missing' }),
    /release not found/i,
  );
});
