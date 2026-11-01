/**
 * Update logic. Two independent channels:
 *
 *  - RULES (data): rules/rules.json from the repo, validated, then stored.
 *    Safe to run automatically.
 *
 *  - CODE (the extension itself): the native helper runs `git pull --ff-only`
 *    in the extension folder, then we call chrome.runtime.reload(). This only
 *    ever happens when the user clicks the button – never automatically.
 *
 * "Is there a newer version?" compares the "version" in the local manifest.json
 * with the one on the repo's upstream branch. A release = bump manifest.json
 * "version" and push (see README → Release checklist).
 *
 * Reading repo files, in order of preference:
 *   1. via the native helper (git fetch + git show). Uses the user's own git
 *      credentials, so PRIVATE repositories work.
 *   2. via raw.githubusercontent.com, only when the helper is not installed and
 *      a repo is set in Settings. Anonymous, so PUBLIC repositories only.
 */
import { REPO_RE, BRANCH_RE, rawUrl } from './github.js';
import { compareVersions } from './semver.js';
import { LIMITS, validateRules } from './rules.js';
import { getSettings, getLocal, setLocal } from './settings.js';
import { getBaseRulesVersion, storeRemoteRules } from './rules-store.js';
import { nativeRequest } from './native.js';

const FETCH_TIMEOUT_MS = 15_000;

async function fetchText(url, maxBytes) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctl.signal });
    if (!res.ok) {
      const hint = res.status === 404 ? ' (wrong repo/branch name, or a private repo without the git helper)' : '';
      throw new Error(`HTTP ${res.status}${hint}`);
    }
    const text = await res.text();
    if (text.length > maxBytes) throw new Error('File too large');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Explicit repo from Settings, or null. (With the helper, no repo setting is needed.) */
async function settingsTarget() {
  const s = await getSettings();
  if (!s.repo || !REPO_RE.test(s.repo) || !BRANCH_RE.test(s.branch) || s.branch.includes('..')) return null;
  return { repo: s.repo, branch: s.branch };
}

/**
 * Read one file from the repo's latest upstream state.
 * @returns {Promise<{text: string, source: string}>}  source = 'git' | 'owner/repo@branch'
 * @throws Error('no-repo') when neither route is available; otherwise a readable message.
 */
async function readRepoFile(file, maxBytes) {
  const viaGit = await nativeRequest({ cmd: 'remote-file', file }, 60_000);
  if (viaGit.ok) {
    if (viaGit.content.length > maxBytes) throw new Error('File too large');
    return { text: viaGit.content, source: 'git' };
  }

  // Helper installed but git itself failed (auth, network, no upstream…): say so plainly.
  if (viaGit.error !== 'host-unavailable') {
    throw new Error(viaGit.output ? `git: ${viaGit.output}` : `git: ${viaGit.error}`);
  }

  // No helper: anonymous fetch, public repos only.
  const target = await settingsTarget();
  if (!target) throw new Error('no-repo');
  return {
    text: await fetchText(rawUrl(target.repo, target.branch, file), maxBytes),
    source: `${target.repo}@${target.branch}`,
  };
}

function setBadge(available) {
  try {
    chrome.action.setBadgeText({ text: available ? '↑' : '' });
    if (available) chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
  } catch (_) { /* action API unavailable: ignore */ }
}

export async function getUpdateState() {
  const { updateState } = await getLocal('updateState');
  return updateState || null;
}

/** Compare the local version with the repo's manifest.json. Never throws. */
export async function checkForUpdate() {
  const current = chrome.runtime.getManifest().version;
  const state = { checkedAt: Date.now(), current, remoteVersion: null, available: false, error: null };
  try {
    const { text, source } = await readRepoFile('manifest.json', 64 * 1024);
    const remote = JSON.parse(text).version;
    const cmp = compareVersions(remote, current);
    state.remoteVersion = remote;
    state.source = source;
    state.available = cmp === 1;
    if (cmp === null) state.error = 'Invalid remote version';
  } catch (e) {
    state.error = String(e && e.message ? e.message : e);
  }
  setBadge(state.available);
  await setLocal({ updateState: state });
  return state;
}

/** Pull newer rules.json from the repo. Never throws. */
export async function updateRules() {
  try {
    const { text } = await readRepoFile('rules/rules.json', LIMITS.maxBytes);
    const checked = validateRules(JSON.parse(text));
    if (!checked.ok) return { ok: false, error: 'Invalid remote rules: ' + checked.errors[0] };

    const currentVersion = await getBaseRulesVersion();
    if (compareVersions(checked.rules.version, currentVersion) !== 1) {
      return { ok: true, updated: false, version: currentVersion };
    }
    await storeRemoteRules(checked.rules);
    await setLocal({ rulesUpdatedAt: Date.now() });
    return { ok: true, updated: true, version: checked.rules.version };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/** `git pull` via the native helper, then reload the extension. User-initiated only. */
export async function applyCodeUpdate() {
  const from = chrome.runtime.getManifest().version;
  const result = await nativeRequest({ cmd: 'pull' });
  if (!result.ok) return result;

  // The files on disk may already be newer than the running extension (pulled by hand,
  // or the browser was never reloaded). Then there is nothing to pull but a reload is due.
  let stale = false;
  if (!result.changed) {
    try {
      const disk = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json();
      stale = typeof disk.version === 'string' && disk.version !== from;
    } catch (_) { /* cannot read own manifest: fall back to "nothing to pull" */ }
  }
  const reload = !!result.changed || stale;
  if (stale) result.changed = true;

  await setLocal({ lastUpdate: { at: Date.now(), from, changed: reload, output: String(result.output || '').slice(0, 2000) } });
  if (reload) {
    // Reply to the popup first, then reload (reload kills this worker).
    setTimeout(() => chrome.runtime.reload(), 600);
  }
  return result;
}
