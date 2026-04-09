import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureZone } from '../src/dns.js';

test('ensureZone creates apex and www site records when zone has no site record yet', async () => {
  const calls = [];
  const config = {
    dnsApplyCommand: '/usr/local/bin/clawfirm-dns-apply',
    dnsDefaultARecords: ['137.184.33.34'],
    dnsDefaultAaaaRecords: [],
    dnsReadCommand: '/usr/local/bin/clawfirm-dns-read',
  };

  const executor = async (command, payload) => {
    calls.push({ command, payload });

    if (command.includes('read')) {
      return { ok: true, exists: false, records: [] };
    }

    return { ok: true, mode: payload.mode, records: payload.records, zone: payload.zone };
  };

  const result = await ensureZone(config, { requestedBy: 'tester', zone: 'knowledgecli.com' }, executor);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, '/usr/local/bin/clawfirm-dns-read');
  assert.equal(calls[1].command, '/usr/local/bin/clawfirm-dns-apply');
  assert.equal(calls[1].payload.mode, 'replace');
  assert.deepEqual(calls[1].payload.records, [
    { type: 'A', name: '@', fqdn: 'knowledgecli.com', value: '137.184.33.34', ttl: 300 },
    { type: 'CNAME', name: 'www', fqdn: 'www.knowledgecli.com', value: 'knowledgecli.com', ttl: 300 },
  ]);
  assert.equal(result.zone, 'knowledgecli.com');
});

test('ensureZone preserves existing non-NS records and backfills missing www record', async () => {
  const calls = [];
  const config = {
    dnsApplyCommand: '/usr/local/bin/clawfirm-dns-apply',
    dnsDefaultARecords: ['137.184.33.34'],
    dnsDefaultAaaaRecords: [],
    dnsReadCommand: '/usr/local/bin/clawfirm-dns-read',
  };

  const executor = async (command, payload) => {
    calls.push({ command, payload });

    if (command.includes('read')) {
      return {
        ok: true,
        exists: true,
        records: [
          { type: 'NS', name: '@', value: 'ns1.example.com', ttl: 300 },
          { type: 'NS', name: '@', value: 'ns2.example.com', ttl: 300 },
          { type: 'A', name: '@', value: '137.184.33.34', ttl: 300 },
          { type: 'TXT', name: '@', value: 'hello', ttl: 300 },
        ],
      };
    }

    return { ok: true, mode: payload.mode, records: payload.records, zone: payload.zone };
  };

  await ensureZone(config, { requestedBy: 'tester', zone: 'example.com' }, executor);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].payload.records, [
    { type: 'A', name: '@', fqdn: 'example.com', value: '137.184.33.34', ttl: 300 },
    { type: 'TXT', name: '@', fqdn: 'example.com', value: 'hello', ttl: 300 },
    { type: 'CNAME', name: 'www', fqdn: 'www.example.com', value: 'example.com', ttl: 300 },
  ]);
});

test('ensureZone preserves an existing www record without rewriting it', async () => {
  const calls = [];
  const config = {
    dnsApplyCommand: '/usr/local/bin/clawfirm-dns-apply',
    dnsDefaultARecords: ['137.184.33.34'],
    dnsDefaultAaaaRecords: [],
    dnsReadCommand: '/usr/local/bin/clawfirm-dns-read',
  };

  const executor = async (command, payload) => {
    calls.push({ command, payload });

    if (command.includes('read')) {
      return {
        ok: true,
        exists: true,
        records: [
          { type: 'A', name: '@', value: '137.184.33.34', ttl: 300 },
          { type: 'CNAME', name: 'www', value: 'proxy.example.net', ttl: 300 },
        ],
      };
    }

    return { ok: true, mode: payload.mode, records: payload.records, zone: payload.zone };
  };

  await ensureZone(config, { requestedBy: 'tester', zone: 'example.com' }, executor);

  assert.deepEqual(calls[1].payload.records, [
    { type: 'A', name: '@', fqdn: 'example.com', value: '137.184.33.34', ttl: 300 },
    { type: 'CNAME', name: 'www', fqdn: 'www.example.com', value: 'proxy.example.net', ttl: 300 },
  ]);
});
