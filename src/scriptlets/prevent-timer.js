/**
 * Scriptlet (PAGE world, self-contained). Neutralises setTimeout/setInterval
 * callbacks whose source matches `pattern` (substring or /regex/) and/or whose
 * delay equals `delay`. At least one of the two must be given.
 *
 * method: 'setTimeout' | 'setInterval'
 */
export function preventTimer(method, pattern, delay) {
  if (method !== 'setTimeout' && method !== 'setInterval') return;
  const hasPattern = typeof pattern === 'string' && pattern !== '';
  const hasDelay = typeof delay === 'string' && delay !== '' && !isNaN(Number(delay));
  if (!hasPattern && !hasDelay) return;

  const original = window[method];
  if (typeof original !== 'function') return;

  let matchSource = () => true;
  if (hasPattern) {
    const m = /^\/(.+)\/$/.exec(pattern);
    if (m) {
      let re;
      try { re = new RegExp(m[1]); } catch (_) { return; }
      matchSource = (s) => re.test(s);
    } else {
      matchSource = (s) => s.includes(pattern);
    }
  }
  const fnToString = Function.prototype.toString;

  window[method] = new Proxy(original, {
    apply(target, thisArg, args) {
      try {
        const cb = args[0];
        const source = typeof cb === 'function' ? fnToString.call(cb) : String(cb);
        const delayOk = !hasDelay || Number(args[1]) === Number(delay);
        if (delayOk && matchSource(source)) args[0] = function () {};
      } catch (_) { /* never break the page's timers */ }
      return Reflect.apply(target, thisArg, args);
    },
  });
}
