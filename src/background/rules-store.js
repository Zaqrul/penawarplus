/**
 * Where rule sets come from, in increasing priority:
 *   1. bundled   rules/rules.json shipped inside the extension
 *   2. remote    newer copy pulled from the git repo (stored in chrome.storage.local)
 *   3. user      rules the user typed in the options page
 * Remote replaces bundled only when its version is >= the bundled one, so a
 * fresh `git pull` that raises the bundled version always wins over stale cache.
 */
import { validateRules, resolveSiteConfig, emptyRules } from './rules.js';
import { compareVersions } from './semver.js';
import { getLocal, setLocal, isHostDisabled } from './settings.js';

let bundledCache = null;
let ruleSetsCache = null;

async function loadBundled() {
  if (bundledCache) return bundledCache;
  try {
    const res = await fetch(chrome.runtime.getURL('rules/rules.json'));
    const checked = validateRules(await res.json());
    bundledCache = checked.ok ? checked.rules : emptyRules();
    if (!checked.ok) console.warn('[PenawarPlus] bundled rules invalid:', checked.errors);
  } catch (e) {
    console.warn('[PenawarPlus] cannot read bundled rules:', e);
    bundledCache = emptyRules();
  }
  return bundledCache;
}

export function invalidateRules() {
  ruleSetsCache = null;
}

export async function getRuleSets() {
  if (ruleSetsCache) return ruleSetsCache;
  const bundled = await loadBundled();
  const { remoteRules, userRulesText } = await getLocal(['remoteRules', 'userRulesText']);

  let base = bundled;
  if (remoteRules) {
    const checked = validateRules(remoteRules);
    if (checked.ok && compareVersions(checked.rules.version, bundled.version) >= 0) base = checked.rules;
  }
  const sets = [base];

  if (userRulesText) {
    try {
      const checked = validateRules(JSON.parse(userRulesText));
      if (checked.ok) sets.push(checked.rules);
    } catch (_) { /* invalid user rules are ignored; the options page shows the error */ }
  }
  ruleSetsCache = sets;
  return sets;
}

/** Version of the rule set currently in effect (bundled or remote). */
export async function getBaseRulesVersion() {
  return (await getRuleSets())[0].version;
}

export async function storeRemoteRules(rules) {
  await setLocal({ remoteRules: rules });
  invalidateRules();
}

/** Everything the injector and content scripts need to know about one host. */
export async function getSiteConfig(hostname) {
  if (await isHostDisabled(hostname)) return { enabled: false, scriptlets: [], remove: [], unlock: false };
  const config = resolveSiteConfig(await getRuleSets(), hostname);
  return { enabled: true, ...config };
}
