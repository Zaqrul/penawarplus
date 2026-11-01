import { getSettings, setSettings, getLocal, setLocal } from '../background/settings.js';
import { REPO_RE, BRANCH_RE } from '../background/github.js';
import { validateRules, RULES_SCHEMA } from '../background/rules.js';

const $ = (id) => document.getElementById(id);

const EXAMPLE = {
  schema: RULES_SCHEMA,
  version: '1',
  sites: [
    {
      hosts: ['contoh.example'],
      scriptlets: [['set-constant', 'adBlockDetected', 'false']],
      remove: ['.adblock-modal'],
      unlock: true,
      note: 'Contoh sahaja: tukar kepada site dan nama sebenar.',
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
  if (repo && !REPO_RE.test(repo)) return flash(msg, 'Repo mesti dalam bentuk owner/nama.', 'bad');
  if (!BRANCH_RE.test(branch) || branch.includes('..')) return flash(msg, 'Nama branch tidak sah.', 'bad');

  await setSettings({
    repo,
    branch,
    autoCheck: $('autoCheck').checked,
    autoRules: $('autoRules').checked,
  });
  flash(msg, 'Disimpan.');
}

async function saveRules() {
  const msg = $('rules-msg');
  const text = $('userRules').value.trim();
  if (text === '') {
    await chrome.storage.local.remove('userRulesText');
    return flash(msg, 'Rule sendiri dikosongkan.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return flash(msg, 'JSON tidak sah: ' + e.message, 'bad');
  }
  const checked = validateRules(parsed);
  if (!checked.ok) return flash(msg, 'Rule ditolak:\n- ' + checked.errors.join('\n- '), 'bad');

  await setLocal({ userRulesText: JSON.stringify(checked.rules, null, 2) });
  $('userRules').value = JSON.stringify(checked.rules, null, 2);
  flash(msg, `Disimpan (${checked.rules.sites.length} entri site). Refresh page yang berkenaan.`);
}

async function showNativeStatus() {
  const el = $('native-status');
  const res = await chrome.runtime.sendMessage({ type: 'native-status' });
  if (res && res.ok) {
    el.textContent = `Dipasang. Folder: ${res.root}\nBranch: ${res.branch || '?'}` +
      (res.dirty ? ' (ada perubahan tempatan yang belum di-commit)' : '');
    el.style.whiteSpace = 'pre-wrap';
  } else if (res && res.error === 'not-a-git-repo') {
    el.textContent = 'Helper dipasang, tetapi folder extension bukan repo git.';
    el.className = 'warn';
  } else {
    el.textContent = 'Belum dipasang.';
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
