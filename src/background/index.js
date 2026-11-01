/** Service worker entry point: wires listeners only; logic lives in sibling modules. */
import { syncGenericScript } from './content-scripts.js';
import { registerInjector } from './injector.js';
import { getSiteConfig, getBaseRulesVersion, invalidateRules } from './rules-store.js';
import { getSettings, setHostEnabled, isHostDisabled, getLocal } from './settings.js';
import { checkForUpdate, updateRules, applyCodeUpdate, getUpdateState } from './updater.js';
import { nativeRequest } from './native.js';

const ALARM = 'penawarplus-periodic';

registerInjector();

async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM))) {
    chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 360 });
  }
}

/** Scheduled work: only read-only checks and data-only rule refreshes. */
async function runScheduled() {
  const settings = await getSettings();
  if (settings.autoCheck) await checkForUpdate();
  if (settings.autoRules) await updateRules();
}

chrome.runtime.onInstalled.addListener(async () => {
  await syncGenericScript();
  await ensureAlarm();
  runScheduled().catch(() => {});
});

chrome.runtime.onStartup.addListener(async () => {
  await syncGenericScript();
  await ensureAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) runScheduled().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.disabledHosts) syncGenericScript();
  if (area === 'local' && (changes.remoteRules || changes.userRulesText)) invalidateRules();
});

const hostOf = (url) => {
  try { return new URL(url).hostname; } catch (_) { return ''; }
};

/** Message handlers. Each returns a JSON-serialisable value. */
const handlers = {
  // From the overlay-remover content script.
  async 'site-config'(_msg, sender) {
    const { enabled, remove, unlock } = await getSiteConfig(hostOf(sender.url));
    return { enabled, remove, unlock };
  },

  // From the popup.
  async 'popup-state'(msg) {
    const host = typeof msg.host === 'string' ? msg.host : '';
    const [updateState, rulesVersion, local] = await Promise.all([
      getUpdateState(),
      getBaseRulesVersion(),
      getLocal(['lastUpdate', 'rulesUpdatedAt']),
    ]);
    return {
      version: chrome.runtime.getManifest().version,
      rulesVersion,
      host,
      enabled: host ? !(await isHostDisabled(host)) : false,
      updateState,
      lastUpdate: local.lastUpdate || null,
      rulesUpdatedAt: local.rulesUpdatedAt || null,
    };
  },
  async 'set-host-enabled'(msg) {
    if (typeof msg.host !== 'string' || !msg.host) return { ok: false };
    await setHostEnabled(msg.host, !!msg.enabled);
    return { ok: true };
  },
  'check-update': () => checkForUpdate(),
  'update-rules': () => updateRules(),
  'apply-update': () => applyCodeUpdate(),
  'native-status': () => nativeRequest({ cmd: 'info' }, 10_000),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; // async response
});
