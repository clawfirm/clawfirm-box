import { createDnsExecutor } from './dns-ssh.js';
import { planEnsureZone, planZoneReplace } from './dns-plan.js';

function defaultSiteRecords(config, zone) {
  const records = [];

  for (const value of config.dnsDefaultARecords ?? []) {
    records.push({ type: 'A', name: '@', value, ttl: 300 });
  }

  for (const value of config.dnsDefaultAaaaRecords ?? []) {
    records.push({ type: 'AAAA', name: '@', value, ttl: 300 });
  }

  records.push({ type: 'CNAME', name: 'www', value: zone, ttl: 300 });

  return records;
}

function normalizeExistingRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .filter((record) => record && typeof record === 'object')
    .map((record) => ({
      type: String(record.type || '').toUpperCase(),
      name: String(record.name || '@').trim(),
      ttl: Number(record.ttl || 300),
      value: String(record.value || '').trim(),
    }))
    .filter((record) => record.type && record.value)
    .filter((record) => record.type !== 'NS');
}

function hasRecord(records, predicate) {
  return records.some((record) => predicate(record));
}

function hasApexSiteRecord(records) {
  return hasRecord(records, (record) => {
    const name = record.name.trim();
    return (name === '@' || name === '') && (record.type === 'A' || record.type === 'AAAA' || record.type === 'CNAME');
  });
}

function hasWwwSiteRecord(records) {
  return hasRecord(records, (record) => record.name.trim() === 'www' && (record.type === 'A' || record.type === 'AAAA' || record.type === 'CNAME'));
}

export async function getZone(config, input, executor = createDnsExecutor(config)) {
  const zone = String(input?.zone || input?.domain || '').trim();
  if (!zone) throw new Error('zone is required');
  return executor(config.dnsReadCommand, { zone });
}

export async function ensureZone(config, input, executor = createDnsExecutor(config)) {
  const plan = planEnsureZone(input);
  const existingZone = await executor(config.dnsReadCommand, { zone: plan.zone });
  const preservedRecords = normalizeExistingRecords(existingZone?.records);
  const records = [...preservedRecords];

  if (!hasApexSiteRecord(records)) {
    records.push(...defaultSiteRecords(config, plan.zone).filter((record) => record.name === '@'));
  }

  if (!hasWwwSiteRecord(records)) {
    records.push(...defaultSiteRecords(config, plan.zone).filter((record) => record.name === 'www'));
  }

  const nextPlan = planZoneReplace({
    zone: plan.zone,
    reason: plan.reason,
    records,
    requestedBy: plan.requestedBy,
  });

  return executor(config.dnsApplyCommand, nextPlan);
}

export async function applyZoneRecords(config, input, executor = createDnsExecutor(config)) {
  const plan = planZoneReplace(input);
  return executor(config.dnsApplyCommand, plan);
}
