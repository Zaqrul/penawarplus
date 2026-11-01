/**
 * Scriptlet registry – the ONLY place that decides which page-world code a
 * rule may run. Rules (bundled, remote, or user-written) can only reference
 * these names with string arguments; they can never carry code themselves.
 * That keeps remote rule updates data-only, as Manifest V3 requires.
 *
 * To add a scriptlet: write a self-contained function in this folder, add an
 * entry below, add a test in tests/scriptlets.test.js, document it in README.
 *
 *   fn      – the self-contained function injected into the page
 *   minArgs – fewest string arguments a rule must supply
 *   args    – maps the rule's string args to fn's parameters
 */
import { propertyTrap } from './property-trap.js';
import { noFetchIf } from './no-fetch-if.js';
import { preventTimer } from './prevent-timer.js';
import { spoofCss } from './spoof-css.js';

export const SCRIPTLETS = {
  'set-constant': { fn: propertyTrap, minArgs: 2, args: (a) => ['constant', a[0], a[1]] },
  'abort-on-property-read': { fn: propertyTrap, minArgs: 1, args: (a) => ['abort-read', a[0]] },
  'abort-on-property-write': { fn: propertyTrap, minArgs: 1, args: (a) => ['abort-write', a[0]] },
  'no-fetch-if': { fn: noFetchIf, minArgs: 1, args: (a) => [a[0]] },
  'prevent-setTimeout': { fn: preventTimer, minArgs: 1, args: (a) => ['setTimeout', a[0], a[1]] },
  'prevent-setInterval': { fn: preventTimer, minArgs: 1, args: (a) => ['setInterval', a[0], a[1]] },
  'spoof-css': { fn: spoofCss, minArgs: 3, args: (a) => a },
};

export const SCRIPTLET_NAMES = Object.keys(SCRIPTLETS);
