import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SCRIPTLETS } from '../src/scriptlets/index.js';

/**
 * Runs a scriptlet exactly the way chrome.scripting.executeScript does:
 * serialise the function to source text, then evaluate it in a fresh global
 * with only its string args. If a scriptlet used anything from module scope,
 * this would throw ReferenceError – which is the point of the test.
 */
function run(name, ruleArgs, globals = {}) {
  const def = SCRIPTLETS[name];
  const window = { ...globals };
  window.window = window;
  const context = vm.createContext(window);
  vm.runInContext(`(${def.fn.toString()})(...${JSON.stringify(def.args(ruleArgs))})`, context);
  return { window, context, ev: (code) => vm.runInContext(code, context) };
}

test('every registered scriptlet is self-contained (survives serialisation)', () => {
  const samples = {
    'set-constant': ['a.b', 'true'],
    'abort-on-property-read': ['a'],
    'abort-on-property-write': ['a'],
    'no-fetch-if': ['ads'],
    'prevent-setTimeout': ['x'],
    'prevent-setInterval': ['x'],
    'spoof-css': ['.b', 'display', 'block'],
  };
  assert.deepEqual(Object.keys(samples).sort(), Object.keys(SCRIPTLETS).sort(), 'add a sample for the new scriptlet');
  for (const [name, args] of Object.entries(samples)) {
    assert.doesNotThrow(() => run(name, args, { fetch() {}, setTimeout() {}, setInterval() {}, getComputedStyle() {} }), name);
  }
});

test('set-constant: existing property is overridden and cannot be reassigned', () => {
  const { ev } = run('set-constant', ['adblock.enabled', 'false'], { adblock: { enabled: true } });
  assert.equal(ev('adblock.enabled'), false);
  ev('adblock.enabled = true');
  assert.equal(ev('adblock.enabled'), false);
});

test('set-constant: works when the page creates the object later', () => {
  const { ev } = run('set-constant', ['detector.blocked', 'false']);
  ev('detector = { blocked: true, other: 1 }');
  assert.equal(ev('detector.blocked'), false);
  assert.equal(ev('detector.other'), 1);
});

test('set-constant: value tokens and numbers; unknown token is a no-op', () => {
  const { ev } = run('set-constant', ['x', 'trueFunc']);
  assert.equal(ev('x()'), true);
  assert.equal(run('set-constant', ['n', '42']).ev('n'), 42);
  const noop = run('set-constant', ['y', 'garbage-token']);
  assert.equal(noop.ev('typeof y'), 'undefined');
});

test('abort-on-property-read: reading throws, page keeps running otherwise', () => {
  const { ev } = run('abort-on-property-read', ['badProp']);
  assert.throws(() => ev('badProp'), /ReferenceError|penawarplus/);
  assert.equal(ev('1 + 1'), 2);
});

test('abort-on-property-write: writing throws, reading is fine', () => {
  const { ev } = run('abort-on-property-write', ['Fingerprint2'], { Fingerprint2: undefined });
  assert.throws(() => ev('Fingerprint2 = 1'));
  assert.equal(ev('typeof Fingerprint2'), 'undefined');
});

test('no-fetch-if: matching URLs get an empty 200, others reach the real fetch', async () => {
  const realCalls = [];
  const fetchStub = (url) => { realCalls.push(url); return Promise.resolve('REAL'); };
  const { ev } = run('no-fetch-if', ['adsbygoogle'], {
    fetch: fetchStub,
    Response: class { constructor(body, init) { this.body = body; this.status = init.status; } },
  });
  const blocked = await ev('fetch("https://x.test/adsbygoogle.js")');
  assert.equal(blocked.status, 200);
  assert.equal(await ev('fetch("https://x.test/app.js")'), 'REAL');
  assert.deepEqual(realCalls, ['https://x.test/app.js']);
});

test('no-fetch-if: /regex/ form and invalid regex', async () => {
  const stub = () => Promise.resolve('REAL');
  const R = class { constructor(b, i) { this.status = i.status; } };
  const re = run('no-fetch-if', ['/ads?\\.js$/'], { fetch: stub, Response: R });
  assert.equal((await re.ev('fetch("https://a/ad.js")')).status, 200);
  assert.equal(await re.ev('fetch("https://a/ad.json")'), 'REAL');
  const bad = run('no-fetch-if', ['/(/'], { fetch: stub, Response: R });
  assert.equal(await bad.ev('fetch("https://a/anything")'), 'REAL'); // untouched
});

test('prevent-setTimeout: neutralises only matching callbacks', () => {
  const scheduled = [];
  const { ev } = run('prevent-setTimeout', ['adblockDetected'], {
    setTimeout: (cb, ms) => { scheduled.push(cb); return scheduled.length; },
  });
  ev('setTimeout(function(){ adblockDetected(); }, 100)');
  ev('setTimeout(function(){ legit(); }, 100)');
  assert.equal(scheduled.length, 2);
  assert.match(scheduled[0].toString(), /^function \(\) \{\s*\}$/); // replaced by no-op
  assert.match(scheduled[1].toString(), /legit/);                    // untouched
});

test('prevent-setInterval: delay-only match', () => {
  const seen = [];
  const { ev } = run('prevent-setInterval', ['', '1500'], {
    setInterval: (cb, ms) => { seen.push([cb.toString(), ms]); },
  });
  ev('setInterval(function(){ a(); }, 1500)');
  ev('setInterval(function(){ b(); }, 20)');
  assert.match(seen[0][0], /^function \(\) \{\s*\}$/);
  assert.match(seen[1][0], /b\(\)/);
});

test('prevent-timer: refuses to match everything when given no filter', () => {
  const seen = [];
  const { ev } = run('prevent-setTimeout', [''], { setTimeout: (cb) => { seen.push(cb.toString()); } });
  ev('setTimeout(function(){ keep(); }, 5)');
  assert.match(seen[0], /keep/);
});
