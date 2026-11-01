import { hostMatches } from './rules.js';

const DEFAULTS = Object.freeze({
  disabledHosts: [], // hosts where PenawarPlus is switched off
  repo: '',          // "owner/name"; empty = detect from the local git remote
  branch: 'main',
  autoCheck: true,   // periodically check for a new version (never auto-installs code)
  autoRules: true,   // periodically refresh rules from the repo
});

export async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

export async function setSettings(patch) {
  await chrome.storage.sync.set(patch);
}

export async function isHostDisabled(hostname) {
  const { disabledHosts } = await getSettings();
  return disabledHosts.some((h) => hostMatches(h, hostname));
}

export async function setHostEnabled(hostname, enabled) {
  const { disabledHosts } = await getSettings();
  const next = enabled
    ? disabledHosts.filter((h) => h !== hostname)
    : [...new Set([...disabledHosts, hostname])];
  await setSettings({ disabledHosts: next });
  return next;
}

export async function getLocal(keys) {
  return chrome.storage.local.get(keys);
}

export async function setLocal(obj) {
  return chrome.storage.local.set(obj);
}
