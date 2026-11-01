/**
 * Isolated-world content script. Hides "please disable your adblocker" walls
 * and gives the page its scrolling back.
 *
 * What to hide comes from two places:
 *   - rule selectors for this site (from the service worker, which also says
 *     whether PenawarPlus is switched off here), and
 *   - a conservative heuristic: a big, high z-index, fixed/absolute element
 *     whose text mentions adblock. Elements are HIDDEN (display:none), never
 *     deleted, so a mistake is harmless and reversible by toggling the site off.
 */
(() => {
  'use strict';

  const WALL_TEXT = /ad[\s-]?block|ads?\s?blocker|disable (your )?(ad|content) ?block|whitelist (us|this site)|pemblokir iklan|matikan.{0,20}(adblock|iklan)|nyahaktifkan.{0,20}iklan|bloqueador de anuncios|bloqueur de pub/i;
  const WATCH_MS = 20_000; // stop observing the DOM after this long
  const MARK = 'data-penawarplus-hidden';

  let config = { enabled: true, remove: [], unlock: false };
  let scheduled = false;

  const hide = (el) => {
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute(MARK, '');
  };

  const isWall = (el) => {
    if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return false;
    if (el.hasAttribute(MARK)) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (!['fixed', 'sticky', 'absolute'].includes(cs.position)) return false;
    if (!(parseInt(cs.zIndex, 10) >= 999)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < innerWidth * 0.4 || r.height < innerHeight * 0.25) return false;
    return WALL_TEXT.test(el.innerText || '');
  };

  /** A text-less, full-screen fixed sibling of a wall is its dimming backdrop. */
  const hideBackdrops = (wall) => {
    const parent = wall.parentElement;
    if (!parent) return;
    for (const sib of parent.children) {
      if (sib === wall || !(sib instanceof HTMLElement) || sib.hasAttribute(MARK)) continue;
      const cs = getComputedStyle(sib);
      const r = sib.getBoundingClientRect();
      if (
        cs.position === 'fixed' && parseInt(cs.zIndex, 10) >= 900 &&
        r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9 &&
        (sib.innerText || '').trim() === ''
      ) hide(sib);
    }
  };

  const unlock = () => {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') el.style.setProperty('overflow', 'auto', 'important');
      if (cs.position === 'fixed') el.style.setProperty('position', 'static', 'important');
      el.style.removeProperty('filter');
      for (const c of [...el.classList]) {
        if (/(no-?scroll|modal-?open|overflow-?hidden|scroll-?lock|locked)/i.test(c)) el.classList.remove(c);
      }
    }
  };

  const sweep = () => {
    scheduled = false;
    if (!config.enabled || !document.body) return;
    let changed = false;

    for (const selector of config.remove) {
      let nodes = [];
      try { nodes = document.querySelectorAll(selector); } catch (_) { /* bad selector: skip */ }
      for (const el of nodes) {
        if (!el.hasAttribute(MARK)) { hide(el); changed = true; }
      }
    }

    // Only inspect likely containers, not every node on the page.
    for (const el of document.querySelectorAll('body > *, body > * > *')) {
      if (isWall(el)) {
        hide(el);
        hideBackdrops(el);
        changed = true;
      }
    }

    if (changed || config.unlock) unlock();
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(sweep, 150);
  };

  const start = () => {
    if (!config.enabled) return;
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), WATCH_MS);
    schedule();
  };

  try {
    chrome.runtime.sendMessage({ type: 'site-config' }, (reply) => {
      if (chrome.runtime.lastError) { void chrome.runtime.lastError; }
      else if (reply && typeof reply === 'object') config = { ...config, ...reply };
      start();
    });
  } catch (_) {
    start(); // extension context invalidated: fall back to heuristics only
  }
})();
