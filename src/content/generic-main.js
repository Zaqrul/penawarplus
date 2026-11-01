/**
 * Always-on generic defences. Registered by the service worker as a
 * document_start MAIN-world script, so it runs inside the page BEFORE the
 * site's own scripts. Classic script (no imports): it is injected as-is.
 *
 * Four independent parts, each wrapped so a failure in one never affects
 * the others or the page:
 *   1. Globals that "can I run ads?" checks look for.
 *   2. Fake FuckAdBlock / BlockAdBlock objects that always report "no adblock".
 *   3. Bait elements: adblockers hide them, detectors measure them. We report
 *      a normal size / display for elements that look like ad bait.
 *   4. BlockAdBlock's eval-packed payload is neutralised on sight.
 *
 * Every replaced native is a Proxy around the original, so
 * Function.prototype.toString still prints "[native code]".
 *
 * Known limit: a site that ships its own copy of the detection library as a
 * global *function declaration* can still overwrite the fakes in part 2. Those
 * sites need a per-site rule (see README, "Menambah rule").
 */
(() => {
  'use strict';
  if (window.__penawarplus__) return;
  try {
    Object.defineProperty(window, '__penawarplus__', { value: true });
  } catch (_) { /* hostile page: carry on */ }

  const guard = (fn) => { try { fn(); } catch (_) { /* never break the page */ } };

  // ---------------------------------------------------------------- 1. globals
  guard(() => {
    window.canRunAds = true;
    window.canShowAds = true;
    window.isAdBlockActive = false;
    if (!window.adsbygoogle) window.adsbygoogle = { loaded: true, push() {} };
  });

  // ------------------------------------------------------- 2. fake detectors
  guard(() => {
    const fake = {
      setOption() { return fake; },
      check() { return true; },
      emitEvent() { return fake; },
      clearEvent() { return fake; },
      on(detected, fn) {
        if (!detected && typeof fn === 'function') setTimeout(fn, 0);
        return fake;
      },
      onDetected() { return fake; },
      onNotDetected(fn) {
        if (typeof fn === 'function') setTimeout(fn, 0);
        return fake;
      },
    };
    function FakeDetector() { return fake; } // `new FakeDetector()` yields `fake`

    const define = (name, getter) => guard(() => Object.defineProperty(window, name, {
      configurable: true,
      get: getter,
      set() { /* ignore the page's attempt to install the real thing */ },
    }));
    for (const name of ['FuckAdBlock', 'BlockAdBlock']) define(name, () => FakeDetector);
    for (const name of ['fuckAdBlock', 'blockAdBlock', 'sniffAdBlock']) define(name, () => fake);
  });

  // --------------------------------------------------------- 3. bait elements
  const BAIT = /(^|[\s_-])(ads?box|adsbox|ad-?banner|ad-?placement|ad-?slot|ad_?unit|adsbygoogle|banner_?ad|text-?ads?|pub_?\d+x\d+|adsense|google-?ads?|doubleclick|adbox|advert(isement)?s?)([\s_-]|$)/i;

  const isBait = (el) => {
    try {
      if (!(el instanceof Element)) return false;
      return BAIT.test((el.getAttribute('class') || '') + ' ' + (el.id || ''));
    } catch (_) {
      return false;
    }
  };

  // 3a. size probes: report 50 instead of 0 for bait elements
  guard(() => {
    for (const prop of ['offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth']) {
      for (const proto of [HTMLElement.prototype, Element.prototype]) {
        const desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc || !desc.get) continue;
        Object.defineProperty(proto, prop, {
          ...desc,
          get: new Proxy(desc.get, {
            apply(target, thisArg, args) {
              const value = Reflect.apply(target, thisArg, args);
              return value === 0 && isBait(thisArg) ? 50 : value;
            },
          }),
        });
        break; // patched on the first prototype that owns the getter
      }
    }
  });

  // 3b. style probes: undo display:none / visibility:hidden / opacity:0 on bait
  guard(() => {
    const original = window.getComputedStyle;
    if (typeof original !== 'function') return;
    const fixes = { display: ['none', 'block'], visibility: ['hidden', 'visible'], opacity: ['0', '1'] };

    window.getComputedStyle = new Proxy(original, {
      apply(target, thisArg, args) {
        const style = Reflect.apply(target, thisArg, args);
        if (!isBait(args[0])) return style;
        const fix = (prop, real) => (fixes[prop] && real === fixes[prop][0] ? fixes[prop][1] : real);
        return new Proxy(style, {
          get(real, prop) {
            if (prop === 'getPropertyValue') {
              return (name) => fix(String(name).toLowerCase(), real.getPropertyValue(name));
            }
            const value = Reflect.get(real, prop, real);
            if (typeof value === 'function') return value.bind(real);
            return typeof prop === 'string' ? fix(prop, value) : value;
          },
        });
      },
    });
  });

  // ------------------------------------------------------ 4. BlockAdBlock eval
  guard(() => {
    const original = window.eval;
    if (typeof original !== 'function') return;
    const signatures = ['blockadblock', 'babasbm', "getItem('babn')"];
    window.eval = new Proxy(original, {
      apply(target, thisArg, args) {
        const code = args[0];
        if (typeof code === 'string' && signatures.some((s) => code.includes(s))) return undefined;
        return Reflect.apply(target, thisArg, args);
      },
    });
  });
})();
