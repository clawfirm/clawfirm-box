import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ensureCaddyImport, ensureServingHost, reconcileDomain } from '../src/domains.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawfirm-domain-reconcile-'));
}

function testConfig(root) {
  return {
    sitesRoot: path.join(root, 'sites'),
    caddyConfigPath: path.join(root, 'Caddyfile'),
    caddySitesDir: path.join(root, 'sites-enabled'),
    caddyReloadCommand: 'echo reload-caddy',
    caddyManagedHostExclude: ['adapter.clawfirm.ai'],
    caddyHttpOnly: false,
    noWwwHostSuffixes: ['dev.clawfirm.ai'],
    dnsReadCommand: '/usr/local/bin/clawfirm-dns-read',
    dnsApplyCommand: '/usr/local/bin/clawfirm-dns-apply',
    dnsDefaultARecords: ['137.184.33.34'],
    dnsDefaultAaaaRecords: [],
  };
}

test('ensureCaddyImport appends sites-enabled import once', () => {
  const root = tempRoot();
  const config = testConfig(root);
  fs.writeFileSync(config.caddyConfigPath, 'adapter.clawfirm.ai {\n  reverse_proxy 127.0.0.1:8787\n}\n', 'utf8');

  const first = ensureCaddyImport(config);
  const second = ensureCaddyImport(config);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  const content = fs.readFileSync(config.caddyConfigPath, 'utf8');
  assert.match(content, /import .*sites-enabled\/\*\.caddy/);
});

test('ensureServingHost writes domain snippet rooted at current release path', () => {
  const root = tempRoot();
  const config = testConfig(root);
  const result = ensureServingHost(config, 'knowledgecli.com');

  assert.equal(result.changed, true);
  const snippet = fs.readFileSync(result.snippetPath, 'utf8');
  assert.match(snippet, /knowledgecli\.com, www\.knowledgecli\.com/);
  assert.match(snippet, /root \* .*\/sites\/knowledgecli\.com\/current/);
  assert.match(snippet, /output file .*access\.log/);
  assert.match(snippet, /format json/);
});

test('reconcileDomain ensures zone, site root, serving host, caddy reload, and both apex/www probes', async () => {
  const root = tempRoot();
  const config = {
    ...testConfig(root),
    commandExecutor: async (command, args) => ({ command, args, stdout: 'ok', stderr: '' }),
  };
  const calls = [];
  const probed = [];

  const result = await reconcileDomain(config, {
    domain: 'knowledgecli.com',
    requestedBy: 'tester',
  }, {
    dnsExecutor: async (command, payload) => {
      calls.push({ command, payload });
      if (command.includes('read')) {
        return { ok: true, zone: payload.zone, exists: false, records: [] };
      }
      return { ok: true, zone: payload.zone, mode: payload.mode, records: payload.records };
    },
    probeFn: async (url) => {
      probed.push(url);
      return { ok: true, status: 200 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.domain, 'knowledgecli.com');
  assert.equal(result.dnsReady, true);
  assert.equal(result.siteRootReady, true);
  assert.equal(result.servingReady, true);
  assert.equal(result.tlsReady, true);
  assert.equal(result.runtimeReady, true);
  assert.equal(result.diagnosis, 'ok');
  assert.equal(result.retryable, false);
  assert.equal(result.sshRequired, false);
  assert.match(result.servingConfigPath, /knowledgecli\.com\.caddy$/);
  assert.equal(result.probe.apex.host, 'knowledgecli.com');
  assert.equal(result.probe.www.host, 'www.knowledgecli.com');
  assert.deepEqual(probed, ['https://knowledgecli.com', 'https://www.knowledgecli.com']);
  assert.ok(result.actions.includes('ensured_site_root'));
  assert.ok(result.actions.includes('updated_caddy_import'));
  assert.ok(result.actions.includes('updated_serving_host'));
  assert.ok(result.actions.includes('reloaded_caddy'));
  assert.equal(calls.length, 2);
});

test('ensureServingHost uses explicit http labels in caddyHttpOnly mode', () => {
  const root = tempRoot();
  const config = {
    ...testConfig(root),
    caddyHttpOnly: true,
  };
  const result = ensureServingHost(config, 'test.64.23.189.64.nip.io');

  assert.equal(result.changed, true);
  const snippet = fs.readFileSync(result.snippetPath, 'utf8');
  assert.match(snippet, /^http:\/\/test\.64\.23\.189\.64\.nip\.io, http:\/\/www\.test\.64\.23\.189\.64\.nip\.io \{/);
});

test('reconcileDomain reports pending runtime with httpReady in caddyHttpOnly mode', async () => {
  const root = tempRoot();
  const config = {
    ...testConfig(root),
    caddyHttpOnly: true,
  };

  const result = await reconcileDomain(config, {
    domain: 'wave0.com',
  }, {
    dnsExecutor: async () => ({ ok: true, zone: 'wave0.com', records: [] }),
    probeFn: async (url) => ({ ok: url.startsWith('http://'), status: 200 }),
  });

  assert.equal(result.httpReady, true);
  assert.equal(result.httpsReady, false);
  assert.equal(result.runtimeState, 'pending');
  assert.equal(result.runtimeReady, false);
  assert.equal(result.diagnosis, 'ssh-required');
  assert.equal(result.retryable, false);
  assert.equal(result.sshRequired, true);
  assert.equal(result.diagnosisCode, 'caddy-http-only');
  assert.match(result.probe.apex.url, /^http:\/\//);
});

test('ensureServingHost omits www alias for platform-managed dev subdomains', () => {
  const root = tempRoot();
  const config = testConfig(root);
  const result = ensureServingHost(config, 'quiet-otter.dev.clawfirm.ai');

  assert.equal(result.changed, true);
  const snippet = fs.readFileSync(result.snippetPath, 'utf8');
  assert.match(snippet, /^quiet-otter\.dev\.clawfirm\.ai \{/);
  assert.doesNotMatch(snippet, /www\.quiet-otter\.dev\.clawfirm\.ai/);
});

test('reconcileDomain probes only apex for platform-managed dev subdomains', async () => {
  const root = tempRoot();
  const config = {
    ...testConfig(root),
    commandExecutor: async (command, args) => ({ command, args, stdout: 'ok', stderr: '' }),
  };
  const probed = [];

  const result = await reconcileDomain(config, {
    domain: 'quiet-otter.dev.clawfirm.ai',
    requestedBy: 'tester',
  }, {
    dnsExecutor: async (command, payload) => {
      if (command.includes('read')) {
        return { ok: true, zone: payload.zone, exists: false, records: [] };
      }
      return { ok: true, zone: payload.zone, mode: payload.mode, records: payload.records };
    },
    probeFn: async (url) => {
      probed.push(url);
      return { ok: true, status: 404 };
    },
  });

  assert.deepEqual(probed, ['https://quiet-otter.dev.clawfirm.ai']);
  assert.equal(result.probe.apex.host, 'quiet-otter.dev.clawfirm.ai');
  assert.equal(result.probe.www, null);
  assert.equal(result.tlsReady, true);
  assert.equal(result.runtimeReady, true);
});

test('ensureServingHost skips excluded managed hosts', () => {
  const root = tempRoot();
  const config = testConfig(root);
  const sitesDir = config.caddySitesDir;
  fs.mkdirSync(sitesDir, { recursive: true });
  const stalePath = path.join(sitesDir, 'adapter.clawfirm.ai.caddy');
  fs.writeFileSync(stalePath, 'adapter.clawfirm.ai {\n  reverse_proxy 127.0.0.1:8787\n}\n', 'utf8');

  const result = ensureServingHost(config, 'adapter.clawfirm.ai');

  assert.equal(result.skipped, true);
  assert.equal(fs.existsSync(stalePath), false);
});

test('ensureServingHost skips domains already defined in the main Caddyfile', () => {
  const root = tempRoot();
  const config = testConfig(root);
  fs.writeFileSync(config.caddyConfigPath, 'dantevr.com, www.dantevr.com {\n  root * /srv/nameserve/sites/dantevr.com/current\n  file_server\n}\n\nimport /etc/caddy/sites-enabled/*.caddy\n', 'utf8');
  const sitesDir = config.caddySitesDir;
  fs.mkdirSync(sitesDir, { recursive: true });
  const stalePath = path.join(sitesDir, 'dantevr.com.caddy');
  fs.writeFileSync(stalePath, 'dantevr.com, www.dantevr.com {\n  root * /srv/nameserve/sites/dantevr.com/current\n  file_server\n}\n', 'utf8');

  const result = ensureServingHost(config, 'dantevr.com');

  assert.equal(result.skipped, true);
  assert.equal(fs.existsSync(stalePath), false);
});

test('reconcileDomain accepts HTTPS 404s as runtime-ready before first publish', async () => {
  const root = tempRoot();
  const config = {
    ...testConfig(root),
    commandExecutor: async (command, args) => ({ command, args, stdout: 'ok', stderr: '' }),
  };

  const result = await reconcileDomain(config, {
    domain: 'knowledgecli.com',
    requestedBy: 'tester',
  }, {
    dnsExecutor: async (command, payload) => {
      if (command.includes('read')) {
        return { ok: true, zone: payload.zone, exists: false, records: [] };
      }
      return { ok: true, zone: payload.zone, mode: payload.mode, records: payload.records };
    },
    probeFn: async () => ({ ok: false, status: 404 }),
  });

  assert.equal(result.probe.apex.ok, true);
  assert.equal(result.probe.apex.contentReady, false);
  assert.equal(result.probe.www.ok, true);
  assert.equal(result.probe.www.contentReady, false);
  assert.equal(result.tlsReady, true);
  assert.equal(result.runtimeReady, true);
});

test('reconcileDomain stays not-ready when host probing cannot connect', async () => {
  const root = tempRoot();
  const config = {
    ...testConfig(root),
    commandExecutor: async (command, args) => ({ command, args, stdout: 'ok', stderr: '' }),
  };

  const result = await reconcileDomain(config, {
    domain: 'knowledgecli.com',
    requestedBy: 'tester',
  }, {
    dnsExecutor: async (command, payload) => {
      if (command.includes('read')) {
        return { ok: true, zone: payload.zone, exists: false, records: [] };
      }
      return { ok: true, zone: payload.zone, mode: payload.mode, records: payload.records };
    },
    probeFn: async (url) => {
      if (url === 'https://knowledgecli.com') return { ok: true, status: 200 };
      throw new Error('connect ECONNREFUSED');
    },
  });

  assert.equal(result.probe.apex.ok, true);
  assert.equal(result.probe.www.ok, false);
  assert.equal(result.tlsReady, false);
  assert.equal(result.runtimeReady, false);
  assert.equal(result.diagnosis, 'retryable');
  assert.equal(result.retryable, true);
  assert.equal(result.sshRequired, false);
  assert.equal(result.diagnosisCode, 'tls-pending');
});
