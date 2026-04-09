import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';

import { listReleases, publishRelease, rollbackRelease } from '../src/releases.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clawfirm-adapter-'));
}

async function createArchive(files) {
  const zip = new JSZip();
  if (Array.isArray(files)) {
    for (const entry of files) {
      zip.file(entry.name, entry.content, entry.options ?? {});
    }
  } else {
    for (const [name, content] of Object.entries(files)) {
      zip.file(name, content);
    }
  }
  const archiveBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
  });
  return {
    archiveBase64: archiveBuffer.toString('base64'),
    archiveBytes: archiveBuffer.length,
  };
}

function rewriteZipEntryName(archiveBuffer, fromName, toName) {
  assert.equal(Buffer.byteLength(fromName), Buffer.byteLength(toName));

  const source = Buffer.from(fromName, 'utf8');
  const target = Buffer.from(toName, 'utf8');
  const patched = Buffer.from(archiveBuffer);
  let replacements = 0;
  let offset = 0;

  while (offset <= patched.length - 4) {
    const signature = patched.readUInt32LE(offset);

    if (signature === 0x04034b50) {
      const fileNameLength = patched.readUInt16LE(offset + 26);
      const extraLength = patched.readUInt16LE(offset + 28);
      const compressedSize = patched.readUInt32LE(offset + 18);
      const fileNameOffset = offset + 30;
      const fileName = patched.subarray(fileNameOffset, fileNameOffset + fileNameLength);
      if (fileName.equals(source)) {
        target.copy(patched, fileNameOffset);
        replacements += 1;
      }
      offset = fileNameOffset + fileNameLength + extraLength + compressedSize;
      continue;
    }

    if (signature === 0x02014b50) {
      const fileNameLength = patched.readUInt16LE(offset + 28);
      const extraLength = patched.readUInt16LE(offset + 30);
      const commentLength = patched.readUInt16LE(offset + 32);
      const fileNameOffset = offset + 46;
      const fileName = patched.subarray(fileNameOffset, fileNameOffset + fileNameLength);
      if (fileName.equals(source)) {
        target.copy(patched, fileNameOffset);
        replacements += 1;
      }
      offset = fileNameOffset + fileNameLength + extraLength + commentLength;
      continue;
    }

    if (signature === 0x06054b50) {
      break;
    }

    offset += 1;
  }

  assert.equal(replacements, 2);
  return patched;
}

async function createArchiveWithInvalidEntryPath(fromName, toName) {
  const safeArchive = await createArchive({
    [fromName]: 'nope',
    'index.html': '<html><body>Hello</body></html>',
  });
  const archiveBuffer = rewriteZipEntryName(Buffer.from(safeArchive.archiveBase64, 'base64'), fromName, toName);
  return {
    archiveBase64: archiveBuffer.toString('base64'),
    archiveBytes: archiveBuffer.length,
  };
}

test('publish creates a staged release from zip archive without switching current by default', async () => {
  const root = tempRoot();
  const result = await publishRelease(root, 'example.com', await createArchive({
    'index.html': '<html><head></head><body>Hello</body></html>',
  }));
  assert.ok(result.releaseId);
  assert.equal(result.activated, false);
  assert.equal(result.releasePath, path.join(root, 'example.com', 'releases', result.releaseId));
  const releases = listReleases(root, 'example.com');
  assert.equal(releases.length, 1);
  assert.equal(releases[0].current, false);
});

test('publish can activate a release immediately when explicitly requested', async () => {
  const root = tempRoot();
  const result = await publishRelease(root, 'example.com', {
    ...(await createArchive({
      'index.html': '<html><head></head><body>Hello</body></html>',
    })),
    activate: true,
  });
  assert.equal(result.activated, true);
  const releases = listReleases(root, 'example.com');
  assert.equal(releases.length, 1);
  assert.equal(releases[0].current, true);
  assert.equal(fs.readFileSync(path.join(root, 'example.com', 'current', 'index.html'), 'utf8'), '<html><head></head><body>Hello</body></html>');
});

test('publish creates release from direct file payload without touching current serving', async () => {
  const root = tempRoot();
  const result = await publishRelease(root, 'example.com', {
    html: '<html><head></head><body>Direct</body></html>',
    files: {
      'assets/logo.png': { encoding: 'base64', content: Buffer.from([0, 1, 2, 3]).toString('base64') },
      'assets/app.js': { encoding: 'base64', content: Buffer.from('console.log("hi")').toString('base64') },
    },
    archiveBytes: 123,
    archiveSha256: 'direct-payload-sha',
  });
  assert.ok(result.releaseId);
  assert.equal(result.archiveBytes, 123);
  assert.equal(result.artifactSha256, 'direct-payload-sha');
  assert.equal(result.activated, false);
  assert.equal(fs.existsSync(path.join(root, 'example.com', 'current')), false);
  assert.equal(fs.readFileSync(path.join(root, 'example.com', 'releases', result.releaseId, 'index.html'), 'utf8'), '<html><head></head><body>Direct</body></html>');
  assert.deepEqual(fs.readFileSync(path.join(root, 'example.com', 'releases', result.releaseId, 'assets', 'logo.png')), Buffer.from([0, 1, 2, 3]));
});

test('rollback points current to earlier release', async () => {
  const root = tempRoot();
  const first = await publishRelease(root, 'example.com', {
    ...(await createArchive({
      'index.html': '<html><head></head><body>v1</body></html>',
    })),
    activate: true,
  });
  await new Promise((r) => setTimeout(r, 5));
  const second = await publishRelease(root, 'example.com', await createArchive({
    'index.html': '<html><head></head><body>v2</body></html>',
    'assets/logo.png': Buffer.from([0, 1, 2, 3]),
  }));
  assert.notEqual(first.releaseId, second.releaseId);
  const rolled = rollbackRelease(root, 'example.com', first.releaseId);
  assert.equal(rolled.releaseId, first.releaseId);
  const releases = listReleases(root, 'example.com');
  const current = releases.find((r) => r.current);
  assert.equal(current.releaseId, first.releaseId);
});

test('listReleases ignores stray files in the releases directory', async () => {
  const root = tempRoot();
  const result = await publishRelease(root, 'example.com', await createArchive({
    'index.html': '<html><head></head><body>Hello</body></html>',
  }));

  fs.writeFileSync(path.join(root, 'example.com', 'releases', '.DS_Store'), 'noise', 'utf8');

  const releases = listReleases(root, 'example.com');
  assert.equal(releases.length, 1);
  assert.equal(releases[0].releaseId, result.releaseId);
  assert.equal(releases[0].current, false);
});

test('publish rejects archives without root index.html', async () => {
  const root = tempRoot();
  const archive = await createArchive({
    'nested/index.html': '<html><body>Hello</body></html>',
  });
  await assert.rejects(
    () => publishRelease(root, 'example.com', archive),
    /index\.html at its root/i,
  );
});

test('publish rejects archives with traversal paths', async () => {
  const root = tempRoot();
  const archive = await createArchiveWithInvalidEntryPath('good/path.tx', 'safe//ok.txt');
  await assert.rejects(
    () => publishRelease(root, 'example.com', archive),
    /invalid path/i,
  );
});

test('publish rejects archives that expand beyond the extracted size limit', async () => {
  const root = tempRoot();
  const archive = await createArchive({
    'index.html': '<html><body>Hello</body></html>',
    'assets/huge.txt': 'x'.repeat((13 * 1024 * 1024) + 1),
  });
  await assert.rejects(
    () => publishRelease(root, 'example.com', archive),
    /max extracted size/i,
  );
});

test('publish rejects direct file payloads without root html', async () => {
  const root = tempRoot();
  await assert.rejects(
    () => publishRelease(root, 'example.com', {
      html: '',
      files: {
        'assets/app.js': { encoding: 'base64', content: Buffer.from('console.log("hi")').toString('base64') },
      },
    }),
    /index\.html content is required/i,
  );
});

test('publish rejects symlink-like archive entries', async () => {
  const root = tempRoot();
  const archive = await createArchive([
    { name: 'index.html', content: '<html><body>Hello</body></html>', options: { unixPermissions: 0o100644 } },
    { name: 'link', content: 'target', options: { unixPermissions: 0o120777 } },
  ]);
  await assert.rejects(
    () => publishRelease(root, 'example.com', archive),
    /symlink-like entry/i,
  );
});
