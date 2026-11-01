/**
 * Injects per-site scriptlets into the page's own JS world.
 *
 * Timing note: webNavigation.onCommitted + injectImmediately runs the scriptlet
 * as early as the extension API allows, but it can still lose a race against a
 * site's very first inline script. The always-on generic defences
 * (src/content/generic-main.js) are registered as a document_start content
 * script instead, precisely because that path has no such race.
 */
import { SCRIPTLETS } from '../scriptlets/index.js';
import { getSiteConfig } from './rules-store.js';

export function registerInjector() {
  chrome.webNavigation.onCommitted.addListener(
    async (details) => {
      let host;
      try { host = new URL(details.url).hostname; } catch (_) { return; }
      if (!host) return;

      const config = await getSiteConfig(host);
      if (!config.enabled) return;

      for (const [name, ...args] of config.scriptlets) {
        const def = SCRIPTLETS[name];
        if (!def) continue; // unknown names are rejected at validation; belt and braces
        chrome.scripting
          .executeScript({
            target: { tabId: details.tabId, frameIds: [details.frameId] },
            world: 'MAIN',
            injectImmediately: true,
            func: def.fn,
            args: def.args(args),
          })
          .catch((e) => console.debug('[PenawarPlus] inject failed', name, host, e && e.message));
      }
    },
    { url: [{ schemes: ['http', 'https'] }] },
  );
}
