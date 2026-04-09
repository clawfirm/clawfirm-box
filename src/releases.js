import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import JSZip from 'jszip';
import yauzl from 'yauzl';

const DEFAULT_MAX_ARCHIVE_BYTES = 3 * 1024 * 1024;
const DEFAULT_MAX_EXTRACTED_BYTES = 12 * 1024 * 1024;

function safeDomainSegment(domain) {
  if (!/^[a-z0-9.-]+$/i.test(domain)) {
    throw new Error('Invalid domain');
  }
  return domain.toLowerCase();
}

function normalizeArtifactPath(name) {
  const unixPath = String(name || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!unixPath || unixPath.startsWith('/') || /^[A-Za-z]:\//.test(unixPath)) {
    throw new Error(`Archive contains invalid path: ${name}`);
  }

  const rawSegments = unixPath.split('/');
  if (rawSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Archive contains invalid path: ${name}`);
  }

  const normalizedPath = path.posix.normalize(unixPath);
  const normalizedSegments = normalizedPath.split('/');
  if (normalizedSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Archive contains invalid path: ${name}`);
  }

  return normalizedSegments.join('/');
}

function isSymlinkEntry(externalFileAttributes = 0) {
  const unixMode = (externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & 0o170000) === 0o120000;
}

function scanArchiveMetadata(archiveBuffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archiveBuffer, { lazyEntries: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(new Error('Archive could not be read as zip'));
        return;
      }

      let extractedBytes = 0;
      let hasRootIndex = false;
      let settled = false;

      const fail = (reason) => {
        if (settled) return;
        settled = true;
        zipFile.close();
        reject(reason);
      };

      zipFile.readEntry();
      zipFile.on('entry', (entry) => {
        try {
          const normalizedPath = normalizeArtifactPath(entry.fileName);
          if (isSymlinkEntry(entry.externalFileAttributes || 0)) {
            fail(new Error(`Archive contains symlink-like entry: ${entry.fileName}`));
            return;
          }

          if (!entry.fileName.endsWith('/')) {
            extractedBytes += entry.uncompressedSize;
            if (extractedBytes > DEFAULT_MAX_EXTRACTED_BYTES) {
              fail(new Error(`Archive expands beyond max extracted size of ${DEFAULT_MAX_EXTRACTED_BYTES} bytes`));
              return;
            }

            if (normalizedPath === 'index.html') {
              hasRootIndex = true;
            }
          }

          zipFile.readEntry();
        } catch (scanError) {
          fail(scanError);
        }
      });
      zipFile.on('end', () => {
        if (settled) return;
        if (!hasRootIndex) {
          fail(new Error('Archive must contain index.html at its root'));
          return;
        }
        settled = true;
        resolve({ extractedBytes, hasRootIndex });
      });
      zipFile.on('error', () => {
        fail(new Error('Archive could not be read as zip'));
      });
    });
  });
}

async function unpackArchive({ archiveBase64, archiveBytes, archiveSha256 }) {
  if (!archiveBase64 || typeof archiveBase64 !== 'string') {
    throw new Error('archiveBase64 is required');
  }

  const archiveBuffer = Buffer.from(archiveBase64, 'base64');
  if (!archiveBuffer.length) {
    throw new Error('archiveBase64 is empty');
  }
  if (archiveBuffer.length > DEFAULT_MAX_ARCHIVE_BYTES) {
    throw new Error(`Archive exceeds max upload size of ${DEFAULT_MAX_ARCHIVE_BYTES} bytes`);
  }
  if (typeof archiveBytes === 'number' && archiveBytes !== archiveBuffer.length) {
    throw new Error('archiveBytes does not match uploaded archive');
  }

  const artifactSha256 = crypto.createHash('sha256').update(archiveBuffer).digest('hex');
  if (archiveSha256 && archiveSha256 !== artifactSha256) {
    throw new Error('archiveSha256 does not match uploaded archive');
  }

  await scanArchiveMetadata(archiveBuffer);

  const zip = await JSZip.loadAsync(archiveBuffer, { checkCRC32: true });
  const files = {};
  let extractedBytes = 0;
  let fileCount = 0;
  let html = null;

  const entries = Object.values(zip.files).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const normalizedPath = normalizeArtifactPath(entry.name);
    if (entry.dir) {
      continue;
    }

    const content = await entry.async('nodebuffer');
    extractedBytes += content.length;
    fileCount += 1;

    if (extractedBytes > DEFAULT_MAX_EXTRACTED_BYTES) {
      throw new Error(`Archive expands beyond max extracted size of ${DEFAULT_MAX_EXTRACTED_BYTES} bytes`);
    }

    if (normalizedPath === 'index.html') {
      html = content;
      continue;
    }

    files[normalizedPath] = content;
  }

  if (!html) {
    throw new Error('Archive must contain index.html at its root');
  }

  return {
    archiveBytes: archiveBuffer.length,
    artifactSha256,
    fileCount,
    files,
    html,
  };
}

function decodeUploadedFile(content) {
  if (Buffer.isBuffer(content)) return content;
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  if (content && typeof content === 'object') {
    if (content.type === 'Buffer' && Array.isArray(content.data)) {
      return Buffer.from(content.data);
    }
    if (content.encoding === 'base64' && typeof content.content === 'string') {
      return Buffer.from(content.content, 'base64');
    }
  }
  throw new Error('Unsupported uploaded file content');
}

function normalizeDirectUpload({ files = {}, html = '', archiveBytes, archiveSha256 }) {
  const normalizedFiles = {};
  let totalBytes = 0;
  let fileCount = 0;

  const htmlBuffer = Buffer.isBuffer(html) ? html : Buffer.from(String(html || ''), 'utf8');
  if (!htmlBuffer.length) {
    throw new Error('index.html content is required');
  }
  totalBytes += htmlBuffer.length;
  fileCount += 1;

  for (const [name, content] of Object.entries(files || {})) {
    const cleanName = normalizeArtifactPath(name);
    const buffer = decodeUploadedFile(content);
    totalBytes += buffer.length;
    fileCount += 1;
    if (totalBytes > DEFAULT_MAX_EXTRACTED_BYTES) {
      throw new Error(`Artifact expands beyond max extracted size of ${DEFAULT_MAX_EXTRACTED_BYTES} bytes`);
    }
    normalizedFiles[cleanName] = buffer;
  }

  return {
    archiveBytes: typeof archiveBytes === 'number' ? archiveBytes : totalBytes,
    artifactSha256: archiveSha256 || crypto.createHash('sha256').update(htmlBuffer).digest('hex'),
    fileCount,
    files: normalizedFiles,
    html: htmlBuffer,
  };
}

export function domainPaths(sitesRoot, domain) {
  const safe = safeDomainSegment(domain);
  const base = path.join(sitesRoot, safe);
  return {
    base,
    current: path.join(base, 'current'),
    releases: path.join(base, 'releases'),
  };
}

export function ensureDomainLayout(sitesRoot, domain) {
  const paths = domainPaths(sitesRoot, domain);
  fs.mkdirSync(paths.releases, { recursive: true });
  return paths;
}

export function writeArtifact(targetDir, files = {}, html = '', title = '') {
  fs.mkdirSync(targetDir, { recursive: true });
  if (html) {
    const htmlText = Buffer.isBuffer(html) ? html.toString('utf8') : String(html);
    const finalHtml = title && !htmlText.includes('<title>')
      ? htmlText.replace('<head>', `<head><title>${title}</title>`)
      : htmlText;
    fs.writeFileSync(path.join(targetDir, 'index.html'), finalHtml, 'utf8');
  }
  for (const [name, content] of Object.entries(files || {})) {
    const cleanName = normalizeArtifactPath(name);
    const fullPath = path.join(targetDir, cleanName);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, decodeUploadedFile(content));
  }
}

function replaceCurrentSymlink(linkPath, targetPath) {
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(targetPath, linkPath, 'dir');
}

function directorySizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += directorySizeBytes(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function safeRealpath(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return '';
  }
}

export async function publishRelease(sitesRoot, domain, { activate = false, archiveBase64, archiveBytes, archiveSha256, files = {}, html = '', title = '' } = {}) {
  const paths = ensureDomainLayout(sitesRoot, domain);
  const releaseId = `${Date.now()}`;
  const releaseDir = path.join(paths.releases, releaseId);
  const artifact = archiveBase64
    ? await unpackArchive({ archiveBase64, archiveBytes, archiveSha256 })
    : normalizeDirectUpload({ files, html, archiveBytes, archiveSha256 });
  writeArtifact(releaseDir, artifact.files, artifact.html, title);

  const activated = Boolean(activate);
  if (activated) {
    replaceCurrentSymlink(paths.current, releaseDir);
  }

  return {
    activated,
    archiveBytes: artifact.archiveBytes,
    artifactSha256: artifact.artifactSha256,
    fileCount: artifact.fileCount,
    releaseId,
    livePath: activated ? releaseDir : null,
    liveUrl: activated ? `https://${domain}` : null,
    releasePath: releaseDir,
    servingUrl: `https://${domain}`,
    totalBytes: directorySizeBytes(releaseDir),
  };
}

export function listReleases(sitesRoot, domain) {
  const paths = ensureDomainLayout(sitesRoot, domain);
  const entries = fs.existsSync(paths.releases)
    ? fs.readdirSync(paths.releases, { withFileTypes: true }).sort((left, right) => right.name.localeCompare(left.name))
    : [];
  const currentTarget = safeRealpath(paths.current);
  const releases = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const releaseId = entry.name;
    const fullPath = path.join(paths.releases, releaseId);

    try {
      releases.push({
        releaseId,
        current: safeRealpath(fullPath) === currentTarget,
        totalBytes: directorySizeBytes(fullPath),
      });
    } catch {
      continue;
    }
  }

  return releases;
}

export function rollbackRelease(sitesRoot, domain, releaseId) {
  const paths = ensureDomainLayout(sitesRoot, domain);
  const target = path.join(paths.releases, releaseId);
  if (!fs.existsSync(target)) {
    throw new Error('Release not found');
  }
  replaceCurrentSymlink(paths.current, target);
  return {
    releaseId,
    livePath: target,
    liveUrl: `https://${domain}`,
    totalBytes: directorySizeBytes(target),
  };
}

export function deleteRelease(sitesRoot, domain, releaseId) {
  const paths = ensureDomainLayout(sitesRoot, domain);
  const target = path.join(paths.releases, releaseId);
  if (!fs.existsSync(target)) {
    throw new Error('Release not found');
  }

  const currentTarget = safeRealpath(paths.current);
  if (currentTarget && currentTarget === safeRealpath(target)) {
    fs.rmSync(paths.current, { force: true, recursive: true });
  }

  fs.rmSync(target, { recursive: true, force: true });
  return { ok: true, releaseId };
}
