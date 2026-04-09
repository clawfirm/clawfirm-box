import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

import { domainPaths } from './releases.js';

function safeDomain(domain) {
  const normalized = String(domain || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/i.test(normalized)) {
    throw new Error('domain must be a domain-like string');
  }
  return normalized;
}

function requireRelease(config, domain, releaseId) {
  const cleanDomain = safeDomain(domain);
  const cleanReleaseId = String(releaseId || '').trim();
  if (!cleanReleaseId) throw new Error('releaseId is required');
  const paths = domainPaths(config.sitesRoot, cleanDomain);
  const releasePath = path.join(paths.releases, cleanReleaseId);
  if (!fs.existsSync(releasePath)) {
    const error = new Error('Release not found');
    error.statusCode = 404;
    throw error;
  }
  return { cleanDomain, cleanReleaseId, releasePath };
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.trunc(value) : Math.trunc(value * 1000);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1e12 ? Math.trunc(numeric) : Math.trunc(numeric * 1000);
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeTimeRange({ since, until }) {
  const sinceMs = parseTimestamp(since);
  const untilMs = parseTimestamp(until);
  if (since && sinceMs === null) throw new Error('since must be an ISO timestamp');
  if (until && untilMs === null) throw new Error('until must be an ISO timestamp');
  if (sinceMs !== null && untilMs !== null && sinceMs > untilMs) {
    throw new Error('since must be before until');
  }
  return { sinceMs, untilMs };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeHostname(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  const withoutTrailingDot = raw.replace(/\.+$/, '');
  const withoutPort = withoutTrailingDot.replace(/:\d+$/, '');
  return withoutPort || null;
}

function domainAliases(domain) {
  const normalized = normalizeHostname(domain);
  if (!normalized) return [];
  if (normalized.startsWith('www.')) {
    return [normalized, normalized.slice(4)];
  }
  return [normalized, `www.${normalized}`];
}

function sameManagedDomain(left, right) {
  const leftAliases = new Set(domainAliases(left));
  const rightAliases = domainAliases(right);
  return rightAliases.some((candidate) => leftAliases.has(candidate));
}

function resolveCurrentReleaseId(sitesRoot, domain) {
  for (const candidate of domainAliases(domain)) {
    try {
      const currentPath = domainPaths(sitesRoot, candidate).current;
      const target = fs.realpathSync(currentPath);
      return path.basename(target);
    } catch {
      continue;
    }
  }
  return null;
}

function normalizeLogEntry(entry, config) {
  const request = entry?.request && typeof entry.request === 'object' ? entry.request : {};
  const headers = request?.headers && typeof request.headers === 'object' ? request.headers : {};
  const ts = parseTimestamp(entry.ts ?? entry.timestamp ?? entry.time);
  const domain = firstString(entry.domain, entry.host, request.host, request.hostname);
  const explicitReleaseId = firstString(entry.releaseId, entry.release_id, entry.release);
  const pathValue = firstString(entry.path, request.uri, request.path, request.url) || '/';
  const referrer = firstString(entry.referrer, entry.referer, headers.Referer?.[0], headers.Referer, headers.Referrer?.[0], headers.Referrer) || 'direct';
  const ip = firstString(entry.ip, entry.remote_ip, request.remote_ip, request.client_ip) || 'unknown';
  const status = toNumber(entry.status, toNumber(entry.status_code, 0));
  const bytes = toNumber(entry.bytes, toNumber(entry.size, toNumber(entry.bytes_written, 0)));

  if (!ts || !domain) return null;

  const normalizedDomain = normalizeHostname(domain);
  if (!normalizedDomain) return null;
  const releaseId = explicitReleaseId || resolveCurrentReleaseId(config.sitesRoot, normalizedDomain);
  if (!releaseId) return null;

  return {
    ts,
    domain: normalizedDomain,
    releaseId,
    path: pathValue,
    referrer,
    ip,
    status,
    bytes,
  };
}

async function aggregateLog(config, query, reducer, initialState) {
  const logPath = config.accessLogPath || '/var/log/caddy/access.log';
  if (!fs.existsSync(logPath)) {
    return initialState;
  }

  const stream = fs.createReadStream(logPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let state = initialState;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = normalizeLogEntry(parsed, config);
    if (!entry) continue;
    if (!sameManagedDomain(entry.domain, query.domain)) continue;
    if (entry.releaseId !== query.releaseId) continue;
    if (query.sinceMs !== null && entry.ts < query.sinceMs) continue;
    if (query.untilMs !== null && entry.ts > query.untilMs) continue;
    state = reducer(state, entry);
  }

  return state;
}

export async function getReleaseSummary(config, input) {
  const { cleanDomain, cleanReleaseId } = requireRelease(config, input?.domain, input?.releaseId);
  const { sinceMs, untilMs } = normalizeTimeRange(input || {});

  const aggregated = await aggregateLog(
    config,
    { domain: cleanDomain, releaseId: cleanReleaseId, sinceMs, untilMs },
    (state, entry) => {
      state.requests += 1;
      state.bytesServed += entry.bytes;
      state.statusCodes[String(entry.status)] = (state.statusCodes[String(entry.status)] || 0) + 1;
      state.uniqueIps.add(entry.ip);
      return state;
    },
    {
      requests: 0,
      uniqueIps: new Set(),
      bytesServed: 0,
      statusCodes: {},
    },
  );

  return {
    ok: true,
    domain: cleanDomain,
    releaseId: cleanReleaseId,
    since: input?.since ?? null,
    until: input?.until ?? null,
    requests: aggregated.requests,
    uniqueIps: aggregated.uniqueIps.size,
    bytesServed: aggregated.bytesServed,
    statusCodes: aggregated.statusCodes,
  };
}

export async function getReleaseTopPaths(config, input) {
  const { cleanDomain, cleanReleaseId } = requireRelease(config, input?.domain, input?.releaseId);
  const { sinceMs, untilMs } = normalizeTimeRange(input || {});
  const limit = Math.max(1, Math.min(100, Number(input?.limit || 20)));

  const aggregated = await aggregateLog(
    config,
    { domain: cleanDomain, releaseId: cleanReleaseId, sinceMs, untilMs },
    (state, entry) => {
      const current = state.get(entry.path) || { path: entry.path, requests: 0, bytesServed: 0 };
      current.requests += 1;
      current.bytesServed += entry.bytes;
      state.set(entry.path, current);
      return state;
    },
    new Map(),
  );

  const paths = [...aggregated.values()]
    .sort((a, b) => b.requests - a.requests || b.bytesServed - a.bytesServed || a.path.localeCompare(b.path))
    .slice(0, limit);

  return {
    ok: true,
    domain: cleanDomain,
    releaseId: cleanReleaseId,
    since: input?.since ?? null,
    until: input?.until ?? null,
    paths,
  };
}
