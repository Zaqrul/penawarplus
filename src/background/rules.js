/**
 * Rule format, validation and matching. Pure functions – no chrome.* here,
 * so everything in this file is unit-tested under plain Node.
 *
 * A rule set looks like (see rules/rules.json and README):
 * {
 *   "schema": 1,
 *   "version": "2026.11.01",            // dotted numbers; higher wins on update
 *   "sites": [
 *     {
 *       "hosts": ["example.com"],        // matches the domain and subdomains; "*" = all
 *       "scriptlets": [["set-constant", "adBlockEnabled", "false"]],
 *       "remove": [".adblock-modal"],    // CSS selectors hidden on the page
 *       "unlock": true,                  // restore page scrolling
 *       "note": "free text"
 *     }
 *   ]
 * }
 *
 * Rules are DATA only. They can name registered scriptlets (src/scriptlets)
 * with string arguments but can never contain executable code.
 */
import { SCRIPTLETS } from '../scriptlets/index.js';
import { parseVersion } from './semver.js';

export const RULES_SCHEMA = 1;

export const LIMITS = Object.freeze({
  maxBytes: 512 * 1024,
  sites: 3000,
  hostsPerSite: 50,
  scriptletsPerSite: 20,
  argsPerScriptlet: 8,
  argLength: 300,
  selectorsPerSite: 50,
  selectorLength: 200,
  noteLength: 300,
});

const HOST_RE = /^(\*|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function emptyRules() {
  return { schema: RULES_SCHEMA, version: '0', sites: [] };
}

/**
 * Validate and sanitise a parsed rule set.
 * @returns {{ok: true, rules: object} | {ok: false, errors: string[]}}
 * Any problem rejects the whole set, so a bad update can never half-apply.
 */
export function validateRules(input) {
  const errors = [];
  const err = (msg) => { if (errors.length < 20) errors.push(msg); };

  if (!isPlainObject(input)) return { ok: false, errors: ['Rule set must be a JSON object'] };
  if (input.schema !== RULES_SCHEMA) err(`schema must be ${RULES_SCHEMA}`);
  if (!parseVersion(input.version)) err('version must be dotted numbers, e.g. "2026.11.01"');
  if (!Array.isArray(input.sites)) err('sites must be an array');
  if (errors.length) return { ok: false, errors };
  if (input.sites.length > LIMITS.sites) return { ok: false, errors: [`too many sites (max ${LIMITS.sites})`] };

  const sites = [];
  input.sites.forEach((site, i) => {
    const at = `sites[${i}]`;
    if (!isPlainObject(site)) return err(`${at} must be an object`);

    const hosts = site.hosts;
    if (!Array.isArray(hosts) || hosts.length === 0 || hosts.length > LIMITS.hostsPerSite) {
      return err(`${at}.hosts must be a non-empty array (max ${LIMITS.hostsPerSite})`);
    }
    const cleanHosts = [];
    for (const h of hosts) {
      const host = typeof h === 'string' ? h.trim().toLowerCase() : '';
      if (!HOST_RE.test(host)) return err(`${at}.hosts has invalid entry ${JSON.stringify(h)}`);
      cleanHosts.push(host);
    }

    const scriptlets = [];
    const rawScriptlets = site.scriptlets ?? [];
    if (!Array.isArray(rawScriptlets) || rawScriptlets.length > LIMITS.scriptletsPerSite) {
      return err(`${at}.scriptlets must be an array (max ${LIMITS.scriptletsPerSite})`);
    }
    for (const entry of rawScriptlets) {
      if (!Array.isArray(entry) || entry.length < 1 || entry.length > LIMITS.argsPerScriptlet + 1) {
        return err(`${at}.scriptlets entries must be ["name", ...args]`);
      }
      const [name, ...args] = entry;
      const def = SCRIPTLETS[name];
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(SCRIPTLETS, name)) {
        return err(`${at}: unknown scriptlet ${JSON.stringify(name)}`);
      }
      if (!args.every((a) => typeof a === 'string' && a.length <= LIMITS.argLength)) {
        return err(`${at}: ${name} args must be strings (max ${LIMITS.argLength} chars)`);
      }
      if (args.length < def.minArgs) return err(`${at}: ${name} needs at least ${def.minArgs} argument(s)`);
      if (name === 'spoof-css' && args.length % 2 === 0) {
        return err(`${at}: spoof-css needs a selector followed by property/value pairs`);
      }
      scriptlets.push([name, ...args]);
    }

    const remove = [];
    const rawRemove = site.remove ?? [];
    if (!Array.isArray(rawRemove) || rawRemove.length > LIMITS.selectorsPerSite) {
      return err(`${at}.remove must be an array (max ${LIMITS.selectorsPerSite})`);
    }
    for (const sel of rawRemove) {
      if (typeof sel !== 'string' || sel.trim() === '' || sel.length > LIMITS.selectorLength) {
        return err(`${at}.remove has an invalid selector`);
      }
      remove.push(sel.trim());
    }

    if (site.unlock !== undefined && typeof site.unlock !== 'boolean') return err(`${at}.unlock must be true/false`);
    if (site.note !== undefined && (typeof site.note !== 'string' || site.note.length > LIMITS.noteLength)) {
      return err(`${at}.note must be a short string`);
    }

    sites.push({
      hosts: cleanHosts,
      scriptlets,
      remove,
      unlock: site.unlock === true,
      ...(typeof site.note === 'string' ? { note: site.note } : {}),
    });
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, rules: { schema: RULES_SCHEMA, version: input.version, sites } };
}

/** "example.com" matches example.com and any subdomain; "*" matches everything. */
export function hostMatches(pattern, hostname) {
  if (pattern === '*') return true;
  return hostname === pattern || hostname.endsWith('.' + pattern);
}

/**
 * Merge every matching site entry from every rule set into one config.
 * @param {object[]} ruleSets validated rule sets (bundled/remote first, user last)
 */
export function resolveSiteConfig(ruleSets, hostname) {
  const host = String(hostname || '').toLowerCase();
  const seen = new Set();
  const config = { scriptlets: [], remove: [], unlock: false };
  for (const set of ruleSets) {
    for (const site of set.sites) {
      if (!site.hosts.some((p) => hostMatches(p, host))) continue;
      for (const s of site.scriptlets) {
        const key = JSON.stringify(s);
        if (!seen.has(key)) { seen.add(key); config.scriptlets.push(s); }
      }
      for (const sel of site.remove) if (!config.remove.includes(sel)) config.remove.push(sel);
      if (site.unlock) config.unlock = true;
    }
  }
  return config;
}
