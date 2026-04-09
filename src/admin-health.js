import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

function shellSplit(command) {
  return String(command || '')
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function runCommand(command, args = [], commandExecutor) {
  if (typeof commandExecutor === 'function') {
    return commandExecutor(command, args);
  }
  return execFile(command, args);
}

function parseSystemctlActive(stdout = '') {
  const value = String(stdout || '').trim().toLowerCase();
  return value === 'active';
}

function safeStatfs(targetPath) {
  if (typeof fs.statfsSync !== 'function') {
    return null;
  }
  try {
    return fs.statfsSync(targetPath);
  } catch {
    return null;
  }
}

function directorySizeBytes(targetPath) {
  if (!fs.existsSync(targetPath)) return 0;
  const stats = fs.statSync(targetPath);
  if (!stats.isDirectory()) return stats.size;
  let total = 0;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    total += directorySizeBytes(path.join(targetPath, entry.name));
  }
  return total;
}

function countReleaseDirs(sitesRoot) {
  if (!fs.existsSync(sitesRoot)) return 0;
  let total = 0;
  for (const domainEntry of fs.readdirSync(sitesRoot, { withFileTypes: true })) {
    if (!domainEntry.isDirectory()) continue;
    const releasesDir = path.join(sitesRoot, domainEntry.name, 'releases');
    if (!fs.existsSync(releasesDir)) continue;
    for (const releaseEntry of fs.readdirSync(releasesDir, { withFileTypes: true })) {
      if (releaseEntry.isDirectory()) total += 1;
    }
  }
  return total;
}

function largestDomainDir(sitesRoot) {
  if (!fs.existsSync(sitesRoot)) return null;
  let largest = null;
  for (const domainEntry of fs.readdirSync(sitesRoot, { withFileTypes: true })) {
    if (!domainEntry.isDirectory()) continue;
    const domainPath = path.join(sitesRoot, domainEntry.name);
    const bytes = directorySizeBytes(domainPath);
    if (!largest || bytes > largest.bytes) {
      largest = { domain: domainEntry.name, bytes };
    }
  }
  return largest;
}

function deriveSystemWarnings({ diskFreeBytes, diskTotalBytes, ramFreeBytes, ramTotalBytes }) {
  const warnings = [];
  if (diskTotalBytes > 0 && diskFreeBytes / diskTotalBytes < 0.1) {
    warnings.push('disk_free_below_10_percent');
  }
  if (ramTotalBytes > 0 && ramFreeBytes / ramTotalBytes < 0.1) {
    warnings.push('ram_free_below_10_percent');
  }
  return warnings;
}

export async function getSystemHealth(config) {
  const memory = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const statfs = safeStatfs(config.sitesRoot) || safeStatfs('/');
  const diskTotalBytes = statfs ? Number(statfs.bsize) * Number(statfs.blocks) : 0;
  const diskFreeBytes = statfs ? Number(statfs.bsize) * Number(statfs.bavail) : 0;
  const diskUsedBytes = diskTotalBytes > 0 ? diskTotalBytes - diskFreeBytes : 0;
  const warnings = deriveSystemWarnings({
    diskFreeBytes,
    diskTotalBytes,
    ramFreeBytes: freeMem,
    ramTotalBytes: totalMem,
  });

  return {
    ok: true,
    host: {
      cpuLoad1: os.loadavg()[0],
      cpuLoad5: os.loadavg()[1],
      cpuLoad15: os.loadavg()[2],
      diskFreeBytes,
      diskTotalBytes,
      diskUsedBytes,
      inodeFree: statfs ? Number(statfs.ffree) : null,
      inodeUsed: statfs ? Number(statfs.files) - Number(statfs.ffree) : null,
      ramFreeBytes: freeMem,
      ramTotalBytes: totalMem,
      ramUsedBytes: totalMem - freeMem,
      rssBytes: memory.rss,
      uptimeSeconds: os.uptime(),
    },
    warnings,
  };
}

async function getServiceActive(serviceName, commandExecutor) {
  try {
    const { stdout } = await runCommand('systemctl', ['is-active', serviceName], commandExecutor);
    return parseSystemctlActive(stdout);
  } catch {
    return false;
  }
}

export async function getServiceHealth(config) {
  const adapterRunning = true;
  const caddyRunning = await getServiceActive(config.caddyServiceName || 'caddy', config.commandExecutor);
  return {
    ok: true,
    services: {
      adapter: {
        pid: process.pid,
        running: adapterRunning,
        uptimeSeconds: Math.floor(process.uptime()),
      },
      caddy: {
        running: caddyRunning,
      },
    },
  };
}

export async function getStorageHealth(config) {
  const sitesRootBytes = directorySizeBytes(config.sitesRoot);
  return {
    ok: true,
    storage: {
      largestDomain: largestDomainDir(config.sitesRoot),
      releaseCount: countReleaseDirs(config.sitesRoot),
      sitesRoot: config.sitesRoot,
      sitesRootBytes,
    },
  };
}

export async function getLogPipelineHealth(config) {
  const logPath = config.accessLogPath || '/var/log/caddy/access.log';
  let exists = false;
  let sizeBytes = 0;
  let mtimeMs = null;
  try {
    const stats = fs.statSync(logPath);
    exists = stats.isFile();
    sizeBytes = stats.size;
    mtimeMs = stats.mtimeMs;
  } catch {
    exists = false;
  }

  const nowMs = Date.now();
  const lagSeconds = mtimeMs ? Math.max(0, Math.floor((nowMs - mtimeMs) / 1000)) : null;
  const staleAfterSeconds = config.logPipelineStaleAfterSeconds || 300;
  const warnings = [];
  if (!exists) warnings.push('log_path_missing');
  if (lagSeconds !== null && lagSeconds > staleAfterSeconds) warnings.push('log_pipeline_stale');

  return {
    ok: true,
    statsPipeline: {
      aggregationLagSeconds: lagSeconds,
      enabled: true,
      lastAggregateAt: mtimeMs ? new Date(mtimeMs).toISOString() : null,
      lastIngestAt: mtimeMs ? new Date(mtimeMs).toISOString() : null,
      logPath,
      parseErrors24h: 0,
      sizeBytes,
    },
    warnings,
  };
}
