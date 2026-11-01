#!/usr/bin/env node
/** Removes the registry entries and generated files created by install.js. Windows only. */
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSERS, HOST_NAME, paths } from './install.js';

if (process.platform !== 'win32') {
  console.error('uninstall.js supports Windows only.');
  process.exit(1);
}

for (const b of BROWSERS) {
  try {
    execFileSync('reg', ['delete', `HKCU\\${b.key}\\${HOST_NAME}`, '/f'], { stdio: 'pipe' });
    console.log(`  [dibuang] ${b.name}`);
  } catch (_) {
    console.log(`  [tiada] ${b.name}`);
  }
}
const p = paths(path.dirname(fileURLToPath(import.meta.url)));
for (const file of [p.launcher, p.manifest]) if (existsSync(file)) unlinkSync(file);
console.log('Selesai.');
