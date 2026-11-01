import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateRules, resolveSiteConfig, hostMatches } from '../src/background/rules.js';
import { compareVersions, parseVersion } from '../src/background/semver.js';
import { rawUrl } from '../src/background/github.js';

const base = (sites) => ({ schema: 1, version: '1.0', sites });

test('semver: ordering and invalid input', () => {
  assert.equal(compareVersions('0.2.1', '0.2.0'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1); // numeric, not lexicographic
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('2026.11.01', '2026.10.30'), 1);
  assert.equal(compareVersions('abc', '1.0'), null);
  assert.equal(parseVersion('1.2.3.4.5'), null);
  assert.equal(parseVersion('1.-2'), null);
});

test('github: rawUrl refuses malformed input', () => {
  assert.equal(
    rawUrl('zakru/penawarplus', 'main', 'rules/rules.json'),
    'https://raw.githubusercontent.com/zakru/penawarplus/main/rules/rules.json',
  );
  assert.throws(() => rawUrl('not a repo', 'main', 'x'));
  assert.throws(() => rawUrl('a/b', '../etc', 'x'));
  assert.throws(() => rawUrl('a/b', 'main', '../../x'));
  assert.throws(() => rawUrl('a/b', 'main', 'x?y=1'));
});

test('bundled rules/rules.json is valid', () => {
  const data = JSON.parse(readFileSync(new URL('../rules/rules.json', import.meta.url), 'utf8'));
  const checked = validateRules(data);
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
});

test('validate: accepts a full, well-formed site entry', () => {
  const checked = validateRules(base([{
    hosts: ['Example.COM'],
    scriptlets: [['set-constant', 'adblock', 'false'], ['spoof-css', '.bait', 'display', 'block']],
    remove: ['.modal'],
    unlock: true,
    note: 'x',
  }]));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.deepEqual(checked.rules.sites[0].hosts, ['example.com']); // lower-cased
});

test('validate: rejects every kind of bad input', () => {
  const bad = {
    'not an object': 'hello',
    'wrong schema': { schema: 2, version: '1', sites: [] },
    'bad version': { schema: 1, version: 'v1', sites: [] },
    'sites not array': { schema: 1, version: '1', sites: {} },
    'unknown scriptlet': base([{ hosts: ['a.com'], scriptlets: [['eval-anything', 'x']] }]),
    'prototype-name scriptlet': base([{ hosts: ['a.com'], scriptlets: [['constructor', 'x']] }]),
    'non-string arg': base([{ hosts: ['a.com'], scriptlets: [['set-constant', 'x', 5]] }]),
    'too few args': base([{ hosts: ['a.com'], scriptlets: [['set-constant', 'x']] }]),
    'spoof-css odd pairs': base([{ hosts: ['a.com'], scriptlets: [['spoof-css', '.b', 'display']] }]),
    'bad host (path)': base([{ hosts: ['a.com/path'] }]),
    'bad host (scheme)': base([{ hosts: ['https://a.com'] }]),
    'empty hosts': base([{ hosts: [] }]),
    'oversized arg': base([{ hosts: ['a.com'], scriptlets: [['no-fetch-if', 'x'.repeat(301)]] }]),
    'empty selector': base([{ hosts: ['a.com'], remove: ['  '] }]),
    'unlock not boolean': base([{ hosts: ['a.com'], unlock: 'yes' }]),
  };
  for (const [label, input] of Object.entries(bad)) {
    assert.equal(validateRules(input).ok, false, `should reject: ${label}`);
  }
});

test('hostMatches: domain, subdomain, wildcard, and look-alikes', () => {
  assert.equal(hostMatches('example.com', 'example.com'), true);
  assert.equal(hostMatches('example.com', 'www.example.com'), true);
  assert.equal(hostMatches('example.com', 'notexample.com'), false);
  assert.equal(hostMatches('example.com', 'example.com.evil.net'), false);
  assert.equal(hostMatches('*', 'anything.org'), true);
});

test('resolveSiteConfig: merges, dedupes, and ignores other hosts', () => {
  const a = validateRules(base([
    { hosts: ['example.com'], scriptlets: [['set-constant', 'a', 'true']], remove: ['.x'] },
    { hosts: ['other.com'], scriptlets: [['set-constant', 'b', 'true']] },
  ])).rules;
  const b = validateRules(base([
    { hosts: ['*'], scriptlets: [['set-constant', 'a', 'true']], remove: ['.x', '.y'], unlock: true },
  ])).rules;
  const config = resolveSiteConfig([a, b], 'www.example.com');
  assert.deepEqual(config.scriptlets, [['set-constant', 'a', 'true']]);
  assert.deepEqual(config.remove, ['.x', '.y']);
  assert.equal(config.unlock, true);
});
