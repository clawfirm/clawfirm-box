import test from 'node:test';
import assert from 'node:assert/strict';

import { planEnsureZone, planZoneReplace } from '../src/dns-plan.js';

test('planZoneReplace normalizes records', () => {
  const plan = planZoneReplace({
    zone: 'Example.COM',
    requestedBy: 'jackie',
    records: [
      { type: 'a', name: '@', value: '137.184.33.34', ttl: 300 },
      { type: 'cname', name: 'www', value: '@', ttl: 600 },
    ],
  });

  assert.equal(plan.zone, 'example.com');
  assert.equal(plan.mode, 'replace');
  assert.equal(plan.records[1].fqdn, 'www.example.com');
  assert.equal(plan.records[1].type, 'CNAME');
});

test('planEnsureZone creates ensure intent', () => {
  const plan = planEnsureZone({ zone: 'join.clawfirm.ai' });
  assert.deepEqual(plan, {
    zone: 'join.clawfirm.ai',
    mode: 'ensure',
    requestedBy: 'functions-adapter',
    reason: 'ensure zone',
  });
});

test('planZoneReplace rejects empty records', () => {
  assert.throws(() => planZoneReplace({ zone: 'example.com', records: [] }), /At least one DNS record/);
});
