#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const namedConfPath = process.env.CLAWFIRM_DNS_NAMED_CONF || '/etc/powerdns/named.conf';
const zonesDir = process.env.CLAWFIRM_DNS_ZONE_DIR || '/etc/powerdns/zones';
const defaultNs = (process.env.CLAWFIRM_DNS_DEFAULT_NS || 'ns1.example.com,ns2.example.com')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const soaPrimary = process.env.CLAWFIRM_DNS_SOA_PRIMARY || defaultNs[0] || 'ns1.example.com';
const soaMailbox = process.env.CLAWFIRM_DNS_SOA_MAILBOX || 'hostmaster.example.com';
const defaultTtl = Number(process.env.CLAWFIRM_DNS_DEFAULT_TTL || 300);
const refresh = Number(process.env.CLAWFIRM_DNS_SOA_REFRESH || 10800);
const retry = Number(process.env.CLAWFIRM_DNS_SOA_RETRY || 3600);
const expire = Number(process.env.CLAWFIRM_DNS_SOA_EXPIRE || 604800);
const minimum = Number(process.env.CLAWFIRM_DNS_SOA_MINIMUM || 3600);
const reloadCommand = process.env.CLAWFIRM_DNS_RELOAD_COMMAND || 'systemctl';
const reloadArgs = (process.env.CLAWFIRM_DNS_RELOAD_ARGS || 'reload-or-restart pdns').split(/\s+/).filter(Boolean);

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

function currentSerial(existingText) {
  const match = existingText.match(/\(\s*\n\s*(\d+)\s*; serial/m);
  return match ? Number(match[1]) : 0;
}

function nextSerial(existingText = '') {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const base = Number(`${today}01`);
  const existing = currentSerial(existingText);
  if (existing >= base) return existing + 1;
  return base;
}

function formatValue(type, value, zone) {
  const trimmed = String(value).trim();
  if (type === 'TXT') {
    const escaped = trimmed.replaceAll('"', '\\"');
    return `"${escaped}"`;
  }
  if (type === 'CNAME' || type === 'NS') {
    if (trimmed === '@') return `${zone}.`;
    return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
  }
  return trimmed;
}

function normalizeRecord(record) {
  const type = String(record.type || '').toUpperCase();
  const name = String(record.name || '@').trim();
  const ttl = Number(record.ttl || defaultTtl);
  const value = String(record.value || '').trim();
  if (!type || !value) throw new Error('record type and value are required');
  return { type, name, ttl, value };
}

function defaultNsRecords() {
  return defaultNs.map((value) => ({ type: 'NS', name: '@', ttl: defaultTtl, value }));
}

function renderZone(zone, records, existingText = '') {
  const serial = nextSerial(existingText);
  const lines = [];
  lines.push(`$TTL ${defaultTtl}`);
  lines.push(`@   IN SOA  ${soaPrimary}. ${soaMailbox}. (`);
  lines.push(`        ${serial} ; serial`);
  lines.push(`        ${refresh}      ; refresh`);
  lines.push(`        ${retry}       ; retry`);
  lines.push(`        ${expire}     ; expire`);
  lines.push(`        ${minimum} )     ; minimum`);
  lines.push('');

  const finalRecords = [...defaultNsRecords(), ...records.map(normalizeRecord)];
  for (const record of finalRecords) {
    const owner = record.name === '@' ? '@' : record.name;
    lines.push(`${owner} ${record.ttl} IN ${record.type} ${formatValue(record.type, record.value, zone)}`);
  }
  lines.push('');
  return { serial, text: `${lines.join('\n')}` };
}

function ensureZoneStanza(zone) {
  const stanza = `zone "${zone}" {\n  type master;\n  file "${zoneFilePath(zone)}";\n};`;
  const namedConf = fs.existsSync(namedConfPath) ? fs.readFileSync(namedConfPath, 'utf8') : '';
  if (namedConf.includes(`zone "${zone}"`)) return false;
  const next = namedConf.trimEnd() ? `${namedConf.trimEnd()}\n${stanza}\n` : `${stanza}\n`;
  fs.writeFileSync(namedConfPath, next);
  return true;
}

function reloadPdns() {
  execFileSync(reloadCommand, reloadArgs, { stdio: 'pipe' });
}

const stdin = await readStdin();
const input = stdin ? JSON.parse(stdin) : {};
const zone = normalizeZone(input.zone || input.domain);
const mode = input.mode || 'replace';
const zonePath = zoneFilePath(zone);
const existingText = fs.existsSync(zonePath) ? fs.readFileSync(zonePath, 'utf8') : '';

fs.mkdirSync(zonesDir, { recursive: true });
ensureZoneStanza(zone);

let records = [];
if (mode === 'replace') {
  records = Array.isArray(input.records) ? input.records : [];
  if (!records.length) throw new Error('records are required for replace mode');
}

const rendered = renderZone(zone, records, existingText);
fs.writeFileSync(zonePath, rendered.text);
reloadPdns();

console.log(JSON.stringify({
  ok: true,
  zone,
  mode,
  serial: rendered.serial,
  exists: true,
  records: [...defaultNsRecords(), ...records.map(normalizeRecord)],
  updatedAt: new Date().toISOString(),
  requestedBy: input.requestedBy || 'adapter',
  reason: input.reason || mode,
  zoneFilePath: zonePath,
}));
