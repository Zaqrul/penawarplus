/**
 * Scriptlet (PAGE world, self-contained). For elements matching `selector`,
 * getComputedStyle() reports the given CSS values instead of the real ones.
 * Useful when a bait element is hidden by the adblocker and the page checks
 * `display` / `visibility`.
 *
 * pairs: property, value, property, value, ...   (e.g. "display", "block")
 */
export function spoofCss(selector, ...pairs) {
  if (typeof selector !== 'string' || selector === '') return;
  const camel = (s) => String(s).replace(/-[a-z]/g, (x) => x[1].toUpperCase());
  const overrides = new Map();
  for (let i = 0; i + 1 < pairs.length; i += 2) overrides.set(camel(pairs[i]), String(pairs[i + 1]));
  if (overrides.size === 0) return;

  const original = window.getComputedStyle;
  if (typeof original !== 'function') return;

  window.getComputedStyle = new Proxy(original, {
    apply(target, thisArg, args) {
      const style = Reflect.apply(target, thisArg, args);
      try {
        const el = args[0];
        if (!(el instanceof Element) || !el.matches(selector)) return style;
      } catch (_) {
        return style;
      }
      return new Proxy(style, {
        get(real, prop) {
          if (prop === 'getPropertyValue') {
            return (name) => (overrides.has(camel(name)) ? overrides.get(camel(name)) : real.getPropertyValue(name));
          }
          if (typeof prop === 'string' && overrides.has(prop)) return overrides.get(prop);
          const v = Reflect.get(real, prop, real);
          return typeof v === 'function' ? v.bind(real) : v;
        },
      });
    },
  });
}
