import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { ensureZone } from './dns.js';
import { domainPaths } from './releases.js';

const execFile = promisify(execFileCallback);

function safeDomain(domain) {
  const normalized = String(domain || '').trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/i.test(normalized)) {
    throw new Error('domain must be a domain-like string');
  }
  return normalized;
}

function shellSplit(command) {
  return String(command || '')
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isManagedHostExcluded(config, domain) {
  return Array.isArray(config.caddyManagedHostExclude)
    && config.caddyManagedHostExclude.map((entry) => String(entry).trim().toLowerCase()).includes(domain);
}

function shouldManageWwwAlias(config, domain) {
  const suffixes = Array.isArray(config.noWwwHostSuffixes)
    ? config.noWwwHostSuffixes.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : [];

  return !suffixes.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
}

function withScheme(config, label) {
  return config.caddyHttpOnly ? `http://${label}` : label;
}

function probeScheme(config) {
  return config.caddyHttpOnly ? 'http' : 'https';
}

function managedHostLabels(config, domain) {
  const labels = shouldManageWwwAlias(config, domain) ? [domain, `www.${domain}`] : [domain];
  return labels.map((label) => withScheme(config, label));
}

function isDomainDefinedInMainCaddyConfig(config, domain) {
  const caddyConfigPath = config.caddyConfigPath;
  if (!caddyConfigPath || !fs.existsSync(caddyConfigPath)) return false;

  const aliases = new Set(managedHostLabels(config, domain));
  const content = fs.readFileSync(caddyConfigPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('import ')) continue;
    if (!line.endsWith('{')) continue;
    const labelSection = line.slice(0, -1).trim();
    if (!labelSection) continue;
    const labels = labelSection.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    if (labels.some((label) => aliases.has(label))) {
      return true;
    }
  }
  return false;
}

function caddySnippet(config, domain, sitesRoot, accessLogPath) {
  const root = path.posix.join(sitesRoot.replace(/\\/g, '/'), domain, 'current');
  const logPath = (accessLogPath || '/var/log/caddy/access.log').replace(/\\/g, '/');
  const labels = managedHostLabels(config, domain).join(', ');
  return `${labels} {\n  root * ${root}\n  file_server\n  log {\n    output file ${logPath}\n    format json\n  }\n}\n`;
}

async function runCommand(command, args = [], commandExecutor) {
  if (typeof commandExecutor === 'function') {
    return commandExecutor(command, args);
  }
  return execFile(command, args);
}

async function reloadCaddy(config) {
  const parts = shellSplit(config.caddyReloadCommand || 'systemctl reload caddy');
  if (!parts.length) {
    throw new Error('caddy reload command is not configured');
  }
  const [command, ...args] = parts;
  await runCommand(command, args, config.commandExecutor);
}

export function ensureSiteRoot(config, domain) {
  const paths = domainPaths(config.sitesRoot, domain);
  fs.mkdirSync(paths.releases, { recursive: true });
  return {
    currentPath: paths.current,
    releasesPath: paths.releases,
    siteRootPath: paths.base,
  };
}

export function ensureCaddyImport(config) {
  const caddyConfigPath = config.caddyConfigPath;
  const caddySitesDir = config.caddySitesDir;
  if (!caddyConfigPath || !caddySitesDir) {
    throw new Error('caddy config paths are not configured');
  }

  const importLine = `import ${path.posix.join(caddySitesDir.replace(/\\/g, '/'), '*.caddy')}`;
  let current = fs.existsSync(caddyConfigPath) ? fs.readFileSync(caddyConfigPath, 'utf8') : '';
  if (!current.includes(importLine)) {
    current = current.trimEnd();
    current = current ? `${current}\n\n${importLine}\n` : `${importLine}\n`;
    fs.mkdirSync(path.dirname(caddyConfigPath), { recursive: true });
    fs.writeFileSync(caddyConfigPath, current, 'utf8');
    return { changed: true, importLine };
  }
  return { changed: false, importLine };
}

export function ensureServingHost(config, domain) {
  const caddySitesDir = config.caddySitesDir;
  if (!caddySitesDir) {
    throw new Error('caddy sites directory is not configured');
  }

  const snippetPath = path.join(caddySitesDir, `${domain}.caddy`);
  if (isManagedHostExcluded(config, domain) || isDomainDefinedInMainCaddyConfig(config, domain)) {
    if (fs.existsSync(snippetPath)) {
      fs.rmSync(snippetPath, { force: true });
      return { changed: true, snippetPath, skipped: true };
    }
    return { changed: false, snippetPath, skipped: true };
  }

  fs.mkdirSync(caddySitesDir, { recursive: true });
  const desired = caddySnippet(config, domain, config.sitesRoot, config.accessLogPath);
  const existing = fs.existsSync(snippetPath) ? fs.readFileSync(snippetPath, 'utf8') : null;
  const changed = existing !== desired;
  if (changed) {
    fs.writeFileSync(snippetPath, desired, 'utf8');
  }
  return { changed, snippetPath, skipped: false };
}

export async function probeHost(host, config, probeFn = fetch) {
  const scheme = probeScheme(config);
  const url = `${scheme}://${host}`;
  try {
    const response = await probeFn(url, {
      method: 'GET',
      redirect: 'manual',
    });
    return {
      host,
      ok: true,
      status: response.status,
      url,
      contentReady: response.ok || [301, 302, 307, 308].includes(response.status),
    };
  } catch (error) {
    return {
      host,
      ok: false,
      status: null,
      url,
      error: error instanceof Error ? error.message : String(error),
      contentReady: false,
    };
  }
}

function classifyReadiness(config, domain, result) {
  if (config.caddyHttpOnly) {
    return {
      diagnosis: 'ssh-required',
      retryable: false,
      sshRequired: true,
      diagnosisCode: 'caddy-http-only',
      diagnosisMessage: `HTTPS is disabled for ${domain} because the box is configured in HTTP-only mode. Disable CLAWFIRM_CADDY_HTTP_ONLY and reload the adapter/Caddy.`,
    };
  }

  if (!result.siteRootReady || !result.caddyImportReady || !result.servingReady) {
    return {
      diagnosis: 'ssh-required',
      retryable: false,
      sshRequired: true,
      diagnosisCode: 'serving-repair-required',
      diagnosisMessage: `The box could not converge serving config for ${domain}. Inspect the host over SSH and repair the serving configuration.`,
    };
  }

  if (!result.dnsReady) {
    return {
      diagnosis: 'ssh-required',
      retryable: false,
      sshRequired: true,
      diagnosisCode: 'dns-repair-required',
      diagnosisMessage: `The box could not converge DNS state for ${domain}. Inspect the DNS helper and zone state over SSH.`,
    };
  }

  if (!result.tlsReady || !result.runtimeReady) {
    return {
      diagnosis: 'retryable',
      retryable: true,
      sshRequired: false,
      diagnosisCode: 'tls-pending',
      diagnosisMessage: `TLS for ${domain} is not ready yet. Retry reconcile/status after DNS propagation and certificate issuance settle.`,
    };
  }

  return {
    diagnosis: 'ok',
    retryable: false,
    sshRequired: false,
    diagnosisCode: 'ok',
    diagnosisMessage: `Domain ${domain} is API-operable and HTTPS-ready.`,
  };
}

export async function reconcileDomain(config, input, executor = {}) {
  const domain = safeDomain(input?.domain || input?.zone);
  const requestedBy = typeof input?.requestedBy === 'string' ? input.requestedBy : 'adapter';
  const actions = [];

  const zoneResult = await ensureZone(config, {
    zone: domain,
    requestedBy,
    reason: typeof input?.reason === 'string' ? input.reason : 'domain_reconcile',
  }, executor.dnsExecutor);

  const siteRoot = ensureSiteRoot(config, domain);
  actions.push('ensured_site_root');

  const importResult = ensureCaddyImport(config);
  if (importResult.changed) {
    actions.push('updated_caddy_import');
  }

  const servingHost = ensureServingHost(config, domain);
  if (servingHost.skipped) {
    actions.push('skipped_managed_host');
  } else if (servingHost.changed) {
    actions.push('updated_serving_host');
  }

  if (importResult.changed || servingHost.changed || input?.reload !== false) {
    await reloadCaddy(config);
    actions.push('reloaded_caddy');
  }

  const apexProbe = await probeHost(domain, config, executor.probeFn);
  const wwwProbe = shouldManageWwwAlias(config, domain)
    ? await probeHost(`www.${domain}`, config, executor.probeFn)
    : null;
  const httpReady = config.caddyHttpOnly
    ? Boolean(apexProbe.ok && (wwwProbe ? wwwProbe.ok : true))
    : false;
  const httpsReady = config.caddyHttpOnly
    ? false
    : Boolean(apexProbe.ok && (wwwProbe ? wwwProbe.ok : true));
  const runtimeState = httpsReady
    ? 'live'
    : httpReady
      ? 'pending'
      : (apexProbe.ok || (wwwProbe ? wwwProbe.ok : false))
        ? 'degraded'
        : 'broken';

  const result = {
    ok: true,
    domain,
    actions,
    dnsReady: true,
    zone: zoneResult.zone,
    siteRootReady: true,
    siteRootPath: siteRoot.siteRootPath,
    servingReady: true,
    caddyImportReady: true,
    servingConfigPath: servingHost.snippetPath,
    httpReady,
    httpsReady,
    tlsReady: httpsReady,
    runtimeState,
    probe: {
      apex: apexProbe,
      www: wwwProbe,
    },
    runtimeReady: httpsReady,
  };

  return {
    ...result,
    ...classifyReadiness(config, domain, result),
  };
}
