/**
 * Scriptlet (PAGE world, self-contained). Answers fetch() calls whose URL
 * matches `pattern` with an empty 200 response, so "was the ad request
 * blocked?" checks see a success. `pattern` is a substring, or /regex/.
 */
export function noFetchIf(pattern) {
  if (typeof pattern !== 'string' || pattern === '') return;
  const original = window.fetch;
  if (typeof original !== 'function') return;

  let test;
  const m = /^\/(.+)\/$/.exec(pattern);
  if (m) {
    let re;
    try { re = new RegExp(m[1]); } catch (_) { return; }
    test = (s) => re.test(s);
  } else {
    test = (s) => s.includes(pattern);
  }

  window.fetch = new Proxy(original, {
    apply(target, thisArg, args) {
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        if (test(url)) return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
      } catch (_) { /* fall through to the real fetch */ }
      return Reflect.apply(target, thisArg, args);
    },
  });
}
