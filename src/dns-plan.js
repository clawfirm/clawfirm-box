const ALLOWED_TYPES = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'NS']);

function assertDomainLike(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9.-]+$/i.test(value)) {
    throw new Error(`${label} must be a domain-like string`);
  }
  return value.toLowerCase().replace(/\.$/, '');
}

function normalizeRecord(record, zone) {
  if (!record || typeof record !== 'object') {
    throw new Error('Each DNS record must be an object');
  }

  const type = String(record.type || '').toUpperCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`Unsupported DNS record type: ${type || '(missing)'}`);
  }

  const name = String(record.name || '@').trim();
  const value = String(record.value || '').trim();
  if (!value) {
    throw new Error(`DNS record ${type} ${name} is missing value`);
  }

  const ttl = Number(record.ttl || 300);
  if (!Number.isFinite(ttl) || ttl < 60 || ttl > 86400) {
    throw new Error(`DNS record ${type} ${name} must have ttl between 60 and 86400`);
  }

  const fqdn = name === '@'
    ? zone
    : `${name.replace(/\.$/, '')}.${zone}`;

  return { name, fqdn, type, value, ttl };
}

export function normalizeZoneName(zone) {
  return assertDomainLike(zone, 'zone');
}

export function planZoneReplace(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('DNS input is required');
  }

  const zone = normalizeZoneName(input.zone || input.domain);
  const records = Array.isArray(input.records) ? input.records.map((record) => normalizeRecord(record, zone)) : [];
  if (!records.length) {
    throw new Error('At least one DNS record is required');
  }

  return {
    zone,
    mode: 'replace',
    records,
    requestedBy: typeof input.requestedBy === 'string' ? input.requestedBy : 'functions-adapter',
    reason: typeof input.reason === 'string' ? input.reason : 'apply records',
  };
}

export function planEnsureZone(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('DNS input is required');
  }
  return {
    zone: normalizeZoneName(input.zone || input.domain),
    mode: 'ensure',
    requestedBy: typeof input.requestedBy === 'string' ? input.requestedBy : 'functions-adapter',
    reason: typeof input.reason === 'string' ? input.reason : 'ensure zone',
  };
}
