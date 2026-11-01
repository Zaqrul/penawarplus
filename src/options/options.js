import { getSettings, setSettings, getLocal, setLocal } from '../background/settings.js';
import { REPO_RE, BRANCH_RE } from '../background/github.js';
import { validateRules, RULES_SCHEMA } from '../background/rules.js';

const $ = (id) => document.getElementById(id);

const EXAMPLE = {
  schema: RULES_SCHEMA,
  version: '1',
  sites: [
    {
      hosts: ['example.test'],
      scriptlets: [['set-constant', 'adBlockDetected', 'false']],
      remove: ['.adblock-modal'],
      unlock: true,
      note: 'Example only: replace with a real site and real names.',
    },
  ],
};

function flash(el, text, kind = '') {
  el.textContent = text;
  el.className = 'small ' + kind;
}

async function loadSettings() {
  const s = await getSettings();
  $('repo').value = s.repo;
  $('branch').value = s.branch;
  $('autoCheck').checked = s.autoCheck;
  $('autoRules').checked = s.autoRules;

  const { userRulesText } = await getLocal('userRulesText');
  $('userRules').value = userRulesText || '';
}

async function saveSettings() {
  const repo = $('repo').value.trim();
  const branch = $('branch').value.trim() || 'main';
  const msg = $('settings-msg');
  if (repo && !REPO_RE.test(repo)) return flash(msg, 'The repo must be in the form owner/name.', 'bad');
  if (!BRANCH_RE.test(branch) || branch.includes('..')) return flash(msg, 'Invalid branch name.', 'bad');

  await setSettings({
    repo,
    branch,
    autoCheck: $('autoCheck').checked,
    autoRules: $('autoRules').checked,
  });
  flash(msg, 'Saved.');
}

async function saveRules() {
  const msg = $('rules-msg');
  const text = $('userRules').value.trim();
  if (text === '') {
    await chrome.storage.local.remove('userRulesText');
    return flash(msg, 'Your rules were cleared.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return flash(msg, 'Invalid JSON: ' + e.message, 'bad');
  }
  const checked = validateRules(parsed);
  if (!checked.ok) return flash(msg, 'Rules rejected:\n- ' + checked.errors.join('\n- '), 'bad');

  await setLocal({ userRulesText: JSON.stringify(checked.rules, null, 2) });
  $('userRules').value = JSON.stringify(checked.rules, null, 2);
  flash(msg, `Saved (${checked.rules.sites.length} site entries). Refresh the affected pages.`);
}

async function showNativeStatus() {
  const el = $('native-status');
  const res = await chrome.runtime.sendMessage({ type: 'native-status' });
  if (res && res.ok) {
    el.textContent = `Installed. Folder: ${res.root}\nBranch: ${res.branch || '?'}` +
      (res.dirty ? ' (there are uncommitted local changes)' : '');
    el.style.whiteSpace = 'pre-wrap';
  } else if (res && res.error === 'not-a-git-repo') {
    el.textContent = 'The helper is installed, but the extension folder is not a git repository.';
    el.className = 'warn';
  } else {
    el.textContent = 'Not installed.';
    el.className = 'muted';
  }
}

$('save-settings').addEventListener('click', saveSettings);
$('save-rules').addEventListener('click', saveRules);
$('example-rules').addEventListener('click', () => {
  $('userRules').value = JSON.stringify(EXAMPLE, null, 2);
});

loadSettings();
showNativeStatus();
