import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle, encodeMessage, createDecoder, githubSlug, isTrustedRemote } from '../native-host/host.js';
import { computeExtensionId, buildHostManifest } from '../native-host/install.js';

const HOST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'native-host', 'host.js');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

/** bare "remote" + two clones: `owner` pushes updates, `user` is the installed extension folder. */
function makeRepos() {
  const dir = mkdtempSync(path.join(tmpdir(), 'penawarplus-'));
  const remote = path.join(dir, 'remote.git');
  const owner = path.join(dir, 'owner');
  const user = path.join(dir, 'user');
  git(dir, 'init', '--bare', '-b', 'main', remote);
  git(dir, 'clone', remote, owner);
  for (const r of [owner]) {
    git(r, 'config', 'user.email', 't@example.com');
    git(r, 'config', 'user.name', 't');
  }
  writeFileSync(path.join(owner, 'manifest.json'), '{"version":"0.1.0"}\n');
  git(owner, 'add', '.');
  git(owner, 'commit', '-m', 'v0.1.0');
  git(owner, 'push', 'origin', 'HEAD:main');
  git(dir, 'clone', remote, user);
  process.env.PENAWARPLUS_TRUSTED_REMOTES = remote; // the local bare repo stands in for the trusted GitHub repo
  return { dir, owner, user, cleanup: () => { delete process.env.PENAWARPLUS_TRUSTED_REMOTES; rmSync(dir, { recursive: true, force: true }); } };
}

test('protocol: encode/decode round-trips, including split chunks and two messages', () => {
  const got = [];
  const feed = createDecoder((m) => got.push(m));
  const a = encodeMessage({ cmd: 'ping' });
  const b = encodeMessage({ cmd: 'info', unicode: 'ñ✓' });
  const all = Buffer.concat([a, b]);
  feed(all.subarray(0, 3));          // not even a full header
  feed(all.subarray(3, a.length + 5)); // rest of first + part of second
  feed(all.subarray(a.length + 5));
  assert.deepEqual(got, [{ cmd: 'ping' }, { cmd: 'info', unicode: 'ñ✓' }]);
});

test('protocol: oversized length header is rejected', () => {
  const feed = createDecoder(() => {});
  const evil = Buffer.alloc(4);
  evil.writeUInt32LE(0x7fffffff, 0);
  assert.throws(() => feed(evil));
});

test('handle: ping, unknown command, malformed requests', async () => {
  assert.equal((await handle({ cmd: 'ping' })).ok, true);
  assert.equal((await handle({ cmd: 'rm -rf /' })).error, 'unknown-command');
  assert.equal((await handle({})).error, 'bad-request');
  assert.equal((await handle(null)).error, 'bad-request');
  assert.equal((await handle({ cmd: 'pull', root: '/etc' })).ok !== undefined, true); // extra fields are ignored
});

test('info/pull: refuse a folder that is not a git repo', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'penawarplus-nogit-'));
  try {
    assert.equal((await handle({ cmd: 'info' }, dir)).error, 'not-a-git-repo');
    assert.equal((await handle({ cmd: 'pull' }, dir)).error, 'not-a-git-repo');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pull: fast-forwards to a newer upstream commit and reports the change', async () => {
  const r = makeRepos();
  try {
    const info = await handle({ cmd: 'info' }, r.user);
    assert.equal(info.ok, true);
    assert.equal(info.branch, 'main');
    assert.equal(info.dirty, false);
    assert.match(info.remote, /remote\.git$/);

    // Nothing new yet.
    const idle = await handle({ cmd: 'pull' }, r.user);
    assert.equal(idle.ok, true);
    assert.equal(idle.changed, false);

    // Owner releases 0.2.0.
    writeFileSync(path.join(r.owner, 'manifest.json'), '{"version":"0.2.0"}\n');
    git(r.owner, 'commit', '-am', 'v0.2.0');
    git(r.owner, 'push', 'origin', 'HEAD:main');

    const res = await handle({ cmd: 'pull' }, r.user);
    assert.equal(res.ok, true, res.output);
    assert.equal(res.changed, true);
    assert.notEqual(res.before, res.after);
    assert.match(readFileSync(path.join(r.user, 'manifest.json'), 'utf8'), /0\.2\.0/);
  } finally {
    r.cleanup();
  }
});

test('remote-file: reads the NEW upstream version without touching the working tree', async () => {
  const r = makeRepos();
  try {
    const before = await handle({ cmd: 'remote-file', file: 'manifest.json' }, r.user);
    assert.equal(before.ok, true, before.output);
    assert.match(before.content, /0\.1\.0/);

    writeFileSync(path.join(r.owner, 'manifest.json'), '{"version":"0.3.0"}\n');
    git(r.owner, 'commit', '-am', 'v0.3.0');
    git(r.owner, 'push', 'origin', 'HEAD:main');

    const after = await handle({ cmd: 'remote-file', file: 'manifest.json' }, r.user);
    assert.equal(after.ok, true);
    assert.match(after.content, /0\.3\.0/);
    // Checking is read-only: the installed copy is still 0.1.0 until the user pulls.
    assert.match(readFileSync(path.join(r.user, 'manifest.json'), 'utf8'), /0\.1\.0/);
  } finally {
    r.cleanup();
  }
});

test('remote-file: only whitelisted files; traversal and other names are refused', async () => {
  const r = makeRepos();
  try {
    for (const file of ['../secret.txt', 'package.json', 'native-host/host.js', '/etc/passwd', 'manifest.json --exec', '', undefined, 42]) {
      const res = await handle({ cmd: 'remote-file', file }, r.user);
      assert.equal(res.ok, false, `should refuse ${JSON.stringify(file)}`);
      assert.equal(res.error, 'file-not-allowed');
    }
  } finally {
    r.cleanup();
  }
});

test('remote-file: a whitelisted file missing upstream is a clean git-failed, not a crash', async () => {
  const r = makeRepos();
  try {
    const res = await handle({ cmd: 'remote-file', file: 'rules/rules.json' }, r.user);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'git-failed');
  } finally {
    r.cleanup();
  }
});

test('pull: a diverged local history is refused, not merged or overwritten', async () => {
  const r = makeRepos();
  try {
    git(r.user, 'config', 'user.email', 't@example.com');
    git(r.user, 'config', 'user.name', 't');
    writeFileSync(path.join(r.user, 'local.txt'), 'mine\n');
    git(r.user, 'add', '.');
    git(r.user, 'commit', '-m', 'local only');

    writeFileSync(path.join(r.owner, 'remote.txt'), 'theirs\n');
    git(r.owner, 'add', '.');
    git(r.owner, 'commit', '-m', 'remote only');
    git(r.owner, 'push', 'origin', 'HEAD:main');

    const res = await handle({ cmd: 'pull' }, r.user);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'git-failed');
    assert.equal(res.changed, false);
    assert.equal(readFileSync(path.join(r.user, 'local.txt'), 'utf8'), 'mine\n'); // local work intact
  } finally {
    r.cleanup();
  }
});

test('end to end: host.js as a real child process speaks the wire protocol', async () => {
  const r = makeRepos();
  try {
    const child = spawn(process.execPath, [HOST], {
      env: { ...process.env, PENAWARPLUS_ROOT: r.user },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const replies = [];
    const feed = createDecoder((m) => replies.push(m));
    child.stdout.on('data', feed);
    child.stdin.write(encodeMessage({ cmd: 'ping' }));
    child.stdin.write(encodeMessage({ cmd: 'info' }));
    child.stdin.end();
    await new Promise((resolve) => child.on('close', resolve));
    assert.equal(replies.length, 2);
    assert.equal(replies[0].ok, true);
    assert.equal(replies[1].branch, 'main');
  } finally {
    r.cleanup();
  }
});

test('install: extension ID derivation matches the manifest key; host manifest is locked to that ID', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const id = computeExtensionId(manifest.key);
  assert.match(id, /^[a-p]{32}$/);
  assert.equal(id, 'apdappnkjceohidhneafhcoglhffnamk');
  const hostManifest = buildHostManifest({ launcherPath: 'C:\\x\\host.bat', extensionId: id });
  assert.deepEqual(hostManifest.allowed_origins, [`chrome-extension://${id}/`]);
  assert.equal(hostManifest.type, 'stdio');
});

test('trust: only the official repo (any github URL form) is trusted by default', () => {
  delete process.env.PENAWARPLUS_TRUSTED_REMOTES;
  for (const url of [
    'https://github.com/Zaqrul/penawarplus.git',
    'https://github.com/zaqrul/penawarplus',
    'https://user@github.com/Zaqrul/penawarplus.git',
    'git@github.com:Zaqrul/penawarplus.git',
    'ssh://git@github.com/Zaqrul/penawarplus.git',
  ]) assert.equal(isTrustedRemote(url), true, url);
  for (const url of [
    'https://github.com/evil/penawarplus.git',
    'https://github.com.evil.example/Zaqrul/penawarplus.git',
    'https://evil.example/github.com/Zaqrul/penawarplus',
    'https://github.com/Zaqrul/penawarplus-fork',
    'ext::sh -c "touch /tmp/pwn"',
    '/some/local/path', '', null,
  ]) assert.equal(isTrustedRemote(url), false, String(url));
  assert.equal(githubSlug('git@github.com:A/b.git'), 'a/b');
});

test('trust: pull and remote-file refuse an untrusted origin and change nothing', async () => {
  const r = makeRepos();
  try {
    delete process.env.PENAWARPLUS_TRUSTED_REMOTES; // now the local remote is NOT trusted
    writeFileSync(path.join(r.owner, 'manifest.json'), '{"version":"9.9.9"}\n');
    git(r.owner, 'commit', '-am', 'malicious');
    git(r.owner, 'push', 'origin', 'HEAD:main');
    const head = git(r.user, 'rev-parse', 'HEAD');
    assert.equal((await handle({ cmd: 'pull' }, r.user)).error, 'untrusted-remote');
    assert.equal((await handle({ cmd: 'remote-file', file: 'manifest.json' }, r.user)).error, 'untrusted-remote');
    assert.equal(git(r.user, 'rev-parse', 'HEAD'), head);
  } finally {
    r.cleanup();
  }
});
