#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const namedConfPath = process.env.CLAWFIRM_DNS_NAMED_CONF || '/etc/powerdns/named.conf';
const zonesDir = process.env.CLAWFIRM_DNS_ZONE_DIR || '/etc/powerdns/zones';

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function normalizeZone(zone) {
  const value = String(zone || '').toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9.-]+$/.test(value)) throw new Error('zone is required');
  return value;
}

function zoneFilePath(zone) {
  return path.join(zonesDir, `${zone}.zone`);
}

function parseZone(text) {
  const serialMatch = text.match(/\(\s*\n\s*(\d+)\s*; serial/m);
  const serial = serialMatch ? Number(serialMatch[1]) : null;
  const records = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('$') || line.includes(' SOA ')) continue;
    const match = rawLine.match(/^\s*(\S+)\s+(?:(\d+)\s+)?IN\s+(A|AAAA|CNAME|TXT|NS)\s+(.+?)\s*$/i);
    if (!match) continue;
    const [, name, ttlRaw, typeRaw, valueRaw] = match;
    records.push({
      name,
      ttl: ttlRaw ? Number(ttlRaw) : null,
      type: typeRaw.toUpperCase(),
      value: valueRaw.replace(/^"|"$/g, ''),
    });
  }
  return { serial, records };
}

const stdin = await readStdin();
const input = stdin ? JSON.parse(stdin) : {};
const zone = normalizeZone(input.zone || input.domain);
const zonePath = zoneFilePath(zone);
const namedConf = fs.existsSync(namedConfPath) ? fs.readFileSync(namedConfPath, 'utf8') : '';
const declared = namedConf.includes(`zone "${zone}"`);

if (!fs.existsSync(zonePath)) {
  console.log(JSON.stringify({ ok: true, zone, exists: false, declared, records: [] }));
  process.exit(0);
}

const text = fs.readFileSync(zonePath, 'utf8');
const parsed = parseZone(text);
console.log(JSON.stringify({
  ok: true,
  zone,
  exists: true,
  declared,
  zoneFilePath: zonePath,
  serial: parsed.serial,
  records: parsed.records,
  rawZone: text,
}));
