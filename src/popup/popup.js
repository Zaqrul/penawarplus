const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);

const when = (ts) => (ts ? new Date(ts).toLocaleString() : '—');

let host = '';

function say(text, kind = '') {
  const el = $('message');
  el.textContent = text;
  el.className = 'small ' + kind;
}

/** Turn an error result from the service worker/native helper into a message the user can act on. */
function describeError(res) {
  switch (res && res.error) {
    case 'host-unavailable':
      return 'The git helper is not installed. Run this once in the extension folder:\nnode native-host/install.js\nthen reload the extension.';
    case 'not-a-git-repo':
      return 'The extension folder is not a git repository. Clone the repo with git, then "Load unpacked" that folder.';
    case 'no-remote':
      return 'The git repository has no "origin" remote.';
    case 'untrusted-remote':
      return 'Refused: the "origin" remote (' + (res.remote || '?') + ') is not a trusted PenawarPlus repository. Forks must opt in with PENAWARPLUS_TRUSTED_REMOTES.';
    case 'detached-head':
      return 'The repository is in a detached HEAD state. Check out a branch first.';
    case 'git-failed':
      return 'git failed:\n' + (res.output || '(no output)') + '\n(Local changes in the way?)';
    case 'no-repo':
      return 'The git helper is not installed and no repository is set.\nInstall the helper (node native-host/install.js) for private or public repos, or enter a public owner/name in Settings.';
    case 'timeout':
      return 'The helper did not respond (timeout).';
    default:
      return String((res && (res.error || res.detail)) || 'Unknown error');
  }
}

function renderStatus(state) {
  const u = state.updateState;
  const el = $('status');
  el.className = '';
  $('apply').hidden = true;

  if (!u) {
    el.textContent = `Version ${state.version}. Not checked yet.`;
    el.classList.add('muted');
  } else if (u.error) {
    el.textContent = u.error === 'no-repo' ? describeError({ error: 'no-repo' }) : `Check failed: ${u.error}`;
    el.classList.add(u.error === 'no-repo' ? 'muted' : 'bad');
  } else if (u.available) {
    el.textContent = `Version ${u.remoteVersion} is available (you have ${state.version}).`;
    el.classList.add('warn');
    $('apply').hidden = false;
  } else {
    el.textContent = `Up to date (v${state.version}). Checked ${when(u.checkedAt)}.`;
    el.classList.add('muted');
  }
}

async function load() {
  const state = await send({ type: 'popup-state', host });
  $('version').textContent = 'v' + state.version;
  $('rules-version').textContent = 'Rules ' + state.rulesVersion;
  $('enabled').checked = state.enabled;
  renderStatus(state);
  if (state.lastUpdate && state.lastUpdate.changed) {
    say(`Updated ${when(state.lastUpdate.at)} (from v${state.lastUpdate.from}).`);
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab.url);
    if (/^https?:$/.test(url.protocol)) host = url.hostname;
  } catch (_) { /* chrome:// pages etc. */ }

  $('host').textContent = host || '(this page is not supported)';
  $('enabled').disabled = !host;

  $('enabled').addEventListener('change', async (e) => {
    await send({ type: 'set-host-enabled', host, enabled: e.target.checked });
    $('reload-hint').hidden = false;
  });

  $('check').addEventListener('click', async () => {
    $('check').disabled = true;
    say('Checking…');
    await send({ type: 'check-update' });
    await load();
    say('');
    $('check').disabled = false;
  });

  $('rules').addEventListener('click', async () => {
    $('rules').disabled = true;
    say('Fetching rules…');
    const res = await send({ type: 'update-rules' });
    if (!res.ok) say(describeError(res), 'bad');
    else say(res.updated ? `Rules updated to ${res.version}.` : `Rules are already up to date (${res.version}).`);
    await load();
    $('rules').disabled = false;
  });

  $('apply').addEventListener('click', async () => {
    $('apply').disabled = true;
    say('Running git pull…');
    const res = await send({ type: 'apply-update' });
    if (!res.ok) {
      say(describeError(res), 'bad');
      $('apply').disabled = false;
    } else if (res.changed) {
      say('Done. The extension will reload in a moment.');
    } else {
      say('Nothing to pull. Make sure the version in manifest.json was bumped in the repo.');
      $('apply').disabled = false;
    }
  });

  $('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  await load();
}

init();
