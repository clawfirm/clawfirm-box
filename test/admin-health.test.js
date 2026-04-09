import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getLogPipelineHealth, getServiceHealth, getStorageHealth, getSystemHealth } from '../src/admin-health.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawfirm-admin-health-'));
}

test('getSystemHealth returns host metrics', async () => {
  const root = tempRoot();
  const result = await getSystemHealth({ sitesRoot: root });

  assert.equal(result.ok, true);
  assert.equal(typeof result.host.ramTotalBytes, 'number');
  assert.equal(typeof result.host.diskTotalBytes, 'number');
  assert.ok(Array.isArray(result.warnings));
});

test('getServiceHealth reports caddy state via command executor', async () => {
  const result = await getServiceHealth({
    caddyServiceName: 'caddy',
    commandExecutor: async (command, args) => {
      assert.equal(command, 'systemctl');
      assert.deepEqual(args, ['is-active', 'caddy']);
      return { stdout: 'active\n', stderr: '' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.services.adapter.running, true);
  assert.equal(result.services.caddy.running, true);
});

test('getStorageHealth summarizes sites root usage', async () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'example.com', 'releases', 'r1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'example.com', 'releases', 'r1', 'index.html'), '<html></html>', 'utf8');

  const result = await getStorageHealth({ sitesRoot: root });

  assert.equal(result.ok, true);
  assert.equal(result.storage.releaseCount, 1);
  assert.equal(result.storage.largestDomain.domain, 'example.com');
});

test('getLogPipelineHealth reports stale/missing log warnings', async () => {
  const root = tempRoot();
  const missing = await getLogPipelineHealth({ accessLogPath: path.join(root, 'missing.log'), logPipelineStaleAfterSeconds: 10 });
  assert.equal(missing.ok, true);
  assert.ok(missing.warnings.includes('log_path_missing'));

  const logPath = path.join(root, 'access.log');
  fs.writeFileSync(logPath, 'hello', 'utf8');
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(logPath, old, old);

  const stale = await getLogPipelineHealth({ accessLogPath: logPath, logPipelineStaleAfterSeconds: 10 });
  assert.ok(stale.warnings.includes('log_pipeline_stale'));
});
