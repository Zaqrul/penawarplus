/**
 * The generic MAIN-world defences are registered dynamically (not in the
 * manifest) so that hosts the user switched off can be excluded. Registration
 * persists across browser restarts; we re-sync on install/startup and
 * whenever the disabled-hosts list changes.
 */
import { getSettings } from './settings.js';

const GENERIC_ID = 'penawarplus-generic';

export async function syncGenericScript() {
  try {
    const { disabledHosts } = await getSettings();
    const excludeMatches = disabledHosts.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]);
    const definition = {
      id: GENERIC_ID,
      js: ['src/content/generic-main.js'],
      matches: ['http://*/*', 'https://*/*'],
      excludeMatches,
      runAt: 'document_start',
      allFrames: true,
      world: 'MAIN',
      persistAcrossSessions: true,
    };
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [GENERIC_ID] });
    if (existing.length) await chrome.scripting.updateContentScripts([definition]);
    else await chrome.scripting.registerContentScripts([definition]);
  } catch (e) {
    console.error('[PenawarPlus] could not register generic script:', e);
  }
}
