#!/usr/bin/env node
/**
 * Registers the native helper with Chrome, Brave and Edge for the CURRENT USER
 * (HKCU – no administrator rights). Windows only.
 *
 *   node native-host/install.js
 *
 * It generates two untracked files next to this script:
 *   penawarplus-host.bat          launcher with the absolute path to this node.exe
 *   com.penawarplus.updater.json  native messaging manifest (names the one extension allowed to call it)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOST_NAME = 'com.penawarplus.updater';

export const BROWSERS = [
  { name: 'Chrome', key: 'Software\\Google\\Chrome\\NativeMessagingHosts' },
  { name: 'Brave', key: 'Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts' },
  { name: 'Edge', key: 'Software\\Microsoft\\Edge\\NativeMessagingHosts' },
];

/** Chrome derives an extension's ID from its public key: first 16 bytes of SHA-256, hex mapped to a–p. */
export function computeExtensionId(base64Key) {
  const digest = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest().subarray(0, 16);
  return [...digest].map((b) => 'abcdefghijklmnop'[b >> 4] + 'abcdefghijklmnop'[b & 15]).join('');
}

export function buildHostManifest({ launcherPath, extensionId }) {
  return {
    name: HOST_NAME,
    description: 'PenawarPlus updater (git pull)',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

export const paths = (dir) => ({
  launcher: path.join(dir, 'penawarplus-host.bat'),
  manifest: path.join(dir, `${HOST_NAME}.json`),
});

function main() {
  if (process.platform !== 'win32') {
    console.error('install.js supports Windows only. On macOS/Linux, register native-host/host.js manually (see README).');
    process.exit(1);
  }
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const extensionManifest = JSON.parse(readFileSync(path.join(dir, '..', 'manifest.json'), 'utf8'));
  if (!extensionManifest.key) throw new Error('manifest.json has no "key": the extension ID would not be stable');
  const extensionId = computeExtensionId(extensionManifest.key);
  const p = paths(dir);

  writeFileSync(p.launcher, `@echo off\r\n"${process.execPath}" "${path.join(dir, 'host.js')}" %*\r\n`);
  writeFileSync(p.manifest, JSON.stringify(buildHostManifest({ launcherPath: p.launcher, extensionId }), null, 2) + '\n');

  for (const b of BROWSERS) {
    try {
      execFileSync('reg', ['add', `HKCU\\${b.key}\\${HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', p.manifest, '/f'], { stdio: 'pipe' });
      console.log(`  [ok] ${b.name}`);
    } catch (e) {
      console.log(`  [failed] ${b.name}: ${String(e.message).split('\n')[0]}`);
    }
  }
  console.log(`\nExtension ID : ${extensionId}`);
  console.log(`Launcher     : ${p.launcher}`);
  console.log('Done. Reload the extension at chrome://extensions, then open the PenawarPlus popup.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
