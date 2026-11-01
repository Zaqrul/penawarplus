/**
 * Scriptlet (runs in the PAGE's JS world). Must stay fully self-contained:
 * chrome.scripting.executeScript serialises this function with toString(),
 * so it cannot reference anything outside its own body.
 *
 * mode:
 *   'constant'    – property always reads as `rawValue` (writes ignored)
 *   'abort-read'  – reading the property throws ReferenceError
 *   'abort-write' – writing the property throws ReferenceError
 *
 * `chain` is a dotted path from window, e.g. "adBlock.enabled". Intermediate
 * objects that do not exist yet are trapped and the trap is installed when
 * the page creates them.
 */
export function propertyTrap(mode, chain, rawValue) {
  if (typeof chain !== 'string' || chain === '') return;

  const constants = {
    true: true,
    false: false,
    null: null,
    undefined: undefined,
    '': '',
    emptyObj: {},
    emptyArr: [],
    noopFunc: function () {},
    trueFunc: function () { return true; },
    falseFunc: function () { return false; },
  };
  let value;
  if (mode === 'constant') {
    if (Object.prototype.hasOwnProperty.call(constants, rawValue)) {
      value = constants[rawValue];
    } else if (rawValue !== undefined && rawValue !== '' && !isNaN(Number(rawValue))) {
      value = Number(rawValue);
    } else {
      return; // unknown value token: do nothing rather than guess
    }
  }

  const isObjLike = (v) => v !== null && (typeof v === 'object' || typeof v === 'function');
  const fail = () => { throw new ReferenceError('penawarplus: ' + chain); };

  const install = (owner, props) => {
    const head = props[0];
    const rest = props.slice(1);
    try {
      if (rest.length === 0) {
        if (mode === 'constant') {
          Object.defineProperty(owner, head, {
            configurable: true,
            enumerable: true,
            get: () => value,
            set: () => {},
          });
        } else if (mode === 'abort-read') {
          Object.defineProperty(owner, head, {
            configurable: true,
            get: fail,
            set: () => {},
          });
        } else if (mode === 'abort-write') {
          let stored = owner[head];
          Object.defineProperty(owner, head, {
            configurable: true,
            get: () => stored,
            set: fail,
          });
        }
        return;
      }
      const current = owner[head];
      if (isObjLike(current)) {
        install(current, rest);
        return;
      }
      let stored = current;
      Object.defineProperty(owner, head, {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (v) => {
          stored = v;
          if (isObjLike(v)) install(v, rest);
        },
      });
    } catch (_) {
      /* property is non-configurable or access threw: leave it alone */
    }
  };

  install(window, chain.split('.'));
}
