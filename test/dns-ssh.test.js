import test from 'node:test';
import assert from 'node:assert/strict';

import { createDnsExecutor } from '../src/dns-ssh.js';

test('createDnsExecutor uses ssh mode by default', async () => {
  const calls = [];
  const executor = createDnsExecutor({
    dnsReadCommand: '/usr/local/bin/clawfirm-dns-read',
    dnsSshHost: 'dns.example.com',
    dnsSshPort: 2222,
    dnsSshUser: 'clawfirm',
  }, async (command, args, payload) => {
    calls.push({ command, args, payload });
    return { stdout: JSON.stringify({ ok: true, zone: payload.zone, exists: false, records: [] }), stderr: '' };
  });

  const result = await executor('/usr/local/bin/clawfirm-dns-read', { zone: 'example.com' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'ssh');
  assert.deepEqual(calls[0].args.slice(0, 5), ['-p', '2222', '-o', 'BatchMode=yes', '-o']);
  assert.equal(calls[0].args.at(-2), 'clawfirm@dns.example.com');
  assert.equal(calls[0].args.at(-1), '/usr/local/bin/clawfirm-dns-read');
});

test('createDnsExecutor uses local bash execution in single-box mode', async () => {
  const calls = [];
  const executor = createDnsExecutor({
    dnsMode: 'local',
    dnsReadCommand: '/usr/local/bin/clawfirm-dns-read',
  }, async (command, args, payload) => {
    calls.push({ command, args, payload });
    return { stdout: JSON.stringify({ ok: true, zone: payload.zone, exists: true, records: [] }), stderr: '' };
  });

  const result = await executor('/usr/local/bin/clawfirm-dns-read', { zone: 'example.com' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'bash');
  assert.deepEqual(calls[0].args, ['-lc', '/usr/local/bin/clawfirm-dns-read']);
});
