import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir) {
  return readdirSync(path.join(ROOT, dir)).flatMap((name) => {
    const rel = path.posix.join(dir, name);
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}
const sources = ['src', 'native-host'].flatMap(walk).filter((f) => /\.(js|html)$/.test(f));

test('no dynamic code execution or HTML injection anywhere in shipped code', () => {
  const banned = [
    [/\bnew\s+Function\b/, 'new Function'],
    [/(?<![.\w])eval\s*\(/, 'eval()'],
    [/\.innerHTML\s*=/, 'innerHTML'],
    [/\.outerHTML\s*=/, 'outerHTML'],
    [/insertAdjacentHTML/, 'insertAdjacentHTML'],
    [/document\.write/, 'document.write'],
    [/\bimportScripts\s*\(/, 'importScripts'],
    [/import\s*\(\s*['"`]?https?:/, 'remote import()'],
  ];
  for (const file of sources) {
    const code = read(file);
    for (const [re, label] of banned) assert.equal(re.test(code), false, `${file} uses ${label}`);
  }
});

test('pages load no remote scripts, styles or fonts', () => {
  for (const file of sources.filter((f) => f.endsWith('.html'))) {
    assert.doesNotMatch(read(file), /<(?:script|link|img|iframe)[^>]+(?:src|href)=["']?(?:https?:)?\/\//i, file);
  }
  assert.doesNotMatch(read('src/ui.css'), /url\(\s*["']?(?:https?:)?\/\//i);
});

test('the only hosts the extension code talks to are GitHub', () => {
  const allowed = /^https:\/\/(?:raw\.githubusercontent\.com|github\.com)\b/;
  for (const file of sources) {
    for (const url of read(file).match(/https?:\/\/[^\s'"`)]+/g) || []) {
      if (/^https?:\/\/(?:\*|127\.0\.0\.1|localhost|x)(?![\w.-])/.test(url)) continue; // match patterns / local demo
      assert.match(url, allowed, `${file}: ${url}`);
    }
  }
});

test('manifest: minimal permissions, no remote-code or exposure hooks', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.deepEqual([...m.permissions].sort(), ['alarms', 'nativeMessaging', 'scripting', 'storage', 'webNavigation']);
  assert.deepEqual(m.host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(m.web_accessible_resources, undefined);
  assert.equal(m.externally_connectable, undefined);
  assert.equal(m.update_url, undefined);
  const csp = JSON.stringify(m.content_security_policy || {});
  assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|https?:/);
});

test('native host: allowed_origins is only our extension, and no shell is used', () => {
  const install = read('native-host/install.js');
  assert.match(install, /allowed_origins: \[`chrome-extension:\/\/\$\{extensionId\}\/`\]/);
  const host = read('native-host/host.js');
  assert.doesNotMatch(host, /(?<![.\w])exec\s*\(|shell:\s*true|(?<![.\w])spawn\s*\(/);
  assert.match(host, /execFile\(/);
});
