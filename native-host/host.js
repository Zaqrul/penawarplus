#!/usr/bin/env node
/**
 * PenawarPlus native messaging helper.
 *
 * The browser starts this process when the extension needs git. It understands
 * exactly four commands and takes no other input:
 *
 *   {cmd:"ping"}                 -> {ok, hostVersion}
 *   {cmd:"info"}                 -> {ok, root, head, branch, remote, dirty}
 *   {cmd:"pull"}                 -> {ok, before, after, changed, output}   (git pull --ff-only)
 *   {cmd:"remote-file", file}    -> {ok, content}   file must be in READABLE_FILES
 *
 * It only ever runs `git -C <extension folder> ...` with fixed arguments (never
 * through a shell) and the browser only lets the extension whose ID is listed
 * in allowed_origins talk to it.
 *
 * stdout carries the protocol (4-byte little-endian length + JSON), so never
 * write anything else to stdout.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOST_VERSION = 1;
export const MAX_MESSAGE_BYTES = 1024 * 1024;

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The extension folder = parent of native-host/. Overridable for tests. */
export const DEFAULT_ROOT = process.env.PENAWARPLUS_ROOT
  ? path.resolve(process.env.PENAWARPLUS_ROOT)
  : path.resolve(HERE, '..');

export function git(root, args, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', root, ...args],
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // fail instead of waiting for a password
      },
      (err, stdout, stderr) => resolve({
        ok: !err,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
      }),
    );
  });
}

export async function info(root = DEFAULT_ROOT) {
  if (!existsSync(path.join(root, '.git'))) return { ok: false, error: 'not-a-git-repo', root };
  const [head, branch, remote, status] = await Promise.all([
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(root, ['remote', 'get-url', 'origin']),
    git(root, ['status', '--porcelain']),
  ]);
  if (!head.ok) return { ok: false, error: 'git-failed', root, output: head.stderr };
  return {
    ok: true,
    root,
    head: head.stdout,
    branch: branch.ok ? branch.stdout : null,
    remote: remote.ok ? remote.stdout : null,
    dirty: status.ok && status.stdout !== '',
  };
}

export async function pull(root = DEFAULT_ROOT) {
  const before = await info(root);
  if (!before.ok) return before;
  if (before.branch === 'HEAD') return { ok: false, error: 'detached-head', root };
  if (!before.remote) return { ok: false, error: 'no-remote', root };

  const result = await git(root, ['pull', '--ff-only']);
  const after = await info(root);
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return {
    ok: result.ok,
    ...(result.ok ? {} : { error: 'git-failed' }),
    before: before.head,
    after: after.ok ? after.head : before.head,
    changed: after.ok && after.head !== before.head,
    output,
  };
}

/** The only repo files the extension may read through the helper. */
export const READABLE_FILES = Object.freeze(['manifest.json', 'rules/rules.json']);

/**
 * `git fetch`, then read one whitelisted file from the upstream branch WITHOUT
 * touching the working tree. Uses the user's own git credentials, so it works
 * for private repositories (unlike an anonymous raw.githubusercontent.com fetch).
 */
export async function remoteFile(file, root = DEFAULT_ROOT) {
  if (typeof file !== 'string' || !READABLE_FILES.includes(file)) return { ok: false, error: 'file-not-allowed' };
  const here = await info(root);
  if (!here.ok) return here;
  if (here.branch === 'HEAD') return { ok: false, error: 'detached-head', root };
  if (!here.remote) return { ok: false, error: 'no-remote', root };

  const fetched = await git(root, ['fetch', '--quiet', 'origin'], 45_000);
  if (!fetched.ok) return { ok: false, error: 'git-failed', output: fetched.stderr };

  const shown = await git(root, ['show', `@{upstream}:${file}`]);
  if (!shown.ok) return { ok: false, error: 'git-failed', output: shown.stderr };
  return { ok: true, content: shown.stdout };
}

export async function handle(message, root = DEFAULT_ROOT) {
  if (!message || typeof message.cmd !== 'string') return { ok: false, error: 'bad-request' };
  switch (message.cmd) {
    case 'ping': return { ok: true, hostVersion: HOST_VERSION };
    case 'info': return info(root);
    case 'pull': return pull(root);
    case 'remote-file': return remoteFile(message.file, root);
    default: return { ok: false, error: 'unknown-command' };
  }
}

export function encodeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** Incremental decoder for the length-prefixed stream. */
export function createDecoder(onMessage) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > MAX_MESSAGE_BYTES) throw new Error('message too large');
      if (buffer.length < 4 + length) return;
      const body = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      let parsed = null;
      try { parsed = JSON.parse(body.toString('utf8')); } catch (_) { /* leave null -> bad-request */ }
      onMessage(parsed);
    }
  };
}

function main() {
  let queue = Promise.resolve();
  const feed = createDecoder((message) => {
    queue = queue.then(async () => {
      const response = await handle(message).catch((e) => ({ ok: false, error: 'host-error', detail: String(e && e.message) }));
      process.stdout.write(encodeMessage(response));
    });
  });
  process.stdin.on('data', (chunk) => {
    try { feed(chunk); } catch (_) { process.exit(1); }
  });
  process.stdin.on('end', () => { queue.then(() => process.exit(0)); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
