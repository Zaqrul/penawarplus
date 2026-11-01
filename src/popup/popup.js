const $ = (id) => document.getElementById(id);
const send = (message) => chrome.runtime.sendMessage(message);

const when = (ts) => (ts ? new Date(ts).toLocaleString('ms-MY') : '—');

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
      return 'Helper git belum dipasang. Jalankan sekali dalam folder extension:\nnode native-host/install.js\nkemudian reload extension.';
    case 'not-a-git-repo':
      return 'Folder extension bukan repo git. Clone repo dengan git, kemudian "Load unpacked" folder itu.';
    case 'no-remote':
      return 'Repo git tiada remote "origin".';
    case 'detached-head':
      return 'Repo berada dalam detached HEAD. Checkout satu branch dahulu.';
    case 'git-failed':
      return 'git pull gagal:\n' + (res.output || '(tiada output)') + '\n(Ada perubahan tempatan yang bercanggah?)';
    case 'no-repo':
      return 'Helper git belum dipasang dan repo belum ditetapkan.\nPasang helper (node native-host/install.js) untuk repo private atau awam, atau isi owner/nama repo awam dalam Tetapan.';
    case 'timeout':
      return 'Helper tidak membalas (timeout).';
    default:
      return String((res && (res.error || res.detail)) || 'Ralat tidak diketahui');
  }
}

function renderStatus(state) {
  const u = state.updateState;
  const el = $('status');
  el.className = '';
  $('apply').hidden = true;

  if (!u) {
    el.textContent = `Versi ${state.version}. Belum disemak.`;
    el.classList.add('muted');
  } else if (u.error) {
    el.textContent = u.error === 'no-repo' ? describeError({ error: 'no-repo' }) : `Gagal menyemak: ${u.error}`;
    el.classList.add(u.error === 'no-repo' ? 'muted' : 'bad');
  } else if (u.available) {
    el.textContent = `Versi ${u.remoteVersion} tersedia (anda ${state.version}).`;
    el.classList.add('warn');
    $('apply').hidden = false;
  } else {
    el.textContent = `Terkini (v${state.version}). Disemak ${when(u.checkedAt)}.`;
    el.classList.add('muted');
  }
}

async function load() {
  const state = await send({ type: 'popup-state', host });
  $('version').textContent = 'v' + state.version;
  $('rules-version').textContent = 'Rule ' + state.rulesVersion;
  $('enabled').checked = state.enabled;
  renderStatus(state);
  if (state.lastUpdate && state.lastUpdate.changed) {
    say(`Dikemas kini ${when(state.lastUpdate.at)} (dari v${state.lastUpdate.from}).`);
  }
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab.url);
    if (/^https?:$/.test(url.protocol)) host = url.hostname;
  } catch (_) { /* chrome:// pages etc. */ }

  $('host').textContent = host || '(page ini tidak disokong)';
  $('enabled').disabled = !host;

  $('enabled').addEventListener('change', async (e) => {
    await send({ type: 'set-host-enabled', host, enabled: e.target.checked });
    $('reload-hint').hidden = false;
  });

  $('check').addEventListener('click', async () => {
    $('check').disabled = true;
    say('Menyemak…');
    await send({ type: 'check-update' });
    await load();
    say('');
    $('check').disabled = false;
  });

  $('rules').addEventListener('click', async () => {
    $('rules').disabled = true;
    say('Menarik rule…');
    const res = await send({ type: 'update-rules' });
    if (!res.ok) say(describeError(res), 'bad');
    else say(res.updated ? `Rule dikemas kini ke ${res.version}.` : `Rule sudah terkini (${res.version}).`);
    await load();
    $('rules').disabled = false;
  });

  $('apply').addEventListener('click', async () => {
    $('apply').disabled = true;
    say('Menjalankan git pull…');
    const res = await send({ type: 'apply-update' });
    if (!res.ok) {
      say(describeError(res), 'bad');
      $('apply').disabled = false;
    } else if (res.changed) {
      say('Berjaya. Extension akan reload sebentar lagi.');
    } else {
      say('Tiada perubahan untuk ditarik. Pastikan versi dalam manifest.json di repo sudah dinaikkan.');
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
