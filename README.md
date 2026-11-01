# PenawarPlus

A Chrome / Brave (Manifest V3) extension that acts as the *antidote* to anti-adblock: it fakes the bait
that detectors look for, neutralises detector scripts, and hides "please disable your adblocker" walls.
It **complements** your existing adblocker (uBlock Origin, Brave Shields); it does not block ads itself.

## Install

```bash
git clone https://github.com/Zaqrul/penawarplus.git penawarplus
```

1. Open `chrome://extensions` (Brave: `brave://extensions`) and turn on **Developer mode**.
2. **Load unpacked** and pick the `penawarplus` folder.
3. *(Optional, for the git pull button)* `node native-host/install.js`. See [Updates](#updates).

The extension ID is always `apdappnkjceohidhneafhcoglhffnamk` because `manifest.json` contains a `key`.

## Structure

```
manifest.json            ← single source of truth for name & version
rules/rules.json         ← per-site rule DATA (the file you will change most often)
src/
  scriptlets/            ← code that runs inside the page; one file per job
    index.js             ← registry: the only list of code a rule may call
  background/            ← service worker (ES modules, no build step)
    rules.js             ← format, validation, host matching   (pure, tested)
    rules-store.js       ← bundled → remote → user rules
    updater.js           ← version check, rule fetch, git pull
    injector.js          ← injects scriptlets per site
    content-scripts.js   ← registers the generic script (can be disabled per site)
    native.js, github.js, semver.js, settings.js, index.js
  content/
    generic-main.js      ← always-on defences (page context, document_start)
    overlay-remover.js   ← hides warning walls, restores scrolling
  popup/, options/       ← UI
native-host/             ← small Node helper that runs `git pull`
tests/                   ← `npm test`
```

There is no bundler and no `npm install`: the files in the repo are the files the browser loads.

## Updates

There are **two channels**, because Manifest V3 forbids remote code and an extension cannot modify its own files:

| Channel | What | Needs | When |
|---|---|---|---|
| **Rules** (data) | `rules/rules.json` is read from the repo, validated and stored | Git helper (private repo) or just a network connection (public repo) | Automatically (~6 h) or via the *Update rules* button |
| **Code** (extension) | `git pull --ff-only` in the extension folder, then a reload | Native helper (installed once) | **Only when you press** *Update now* |

Button flow: popup → **Check for updates** compares the `version` in the local `manifest.json` with the one on
the repo branch → if it is newer, the **Update now** button appears → the helper runs
`git pull --ff-only` → the extension reloads itself. A `↑` badge on the icon means a new version is available.

### Install the git helper (once, Windows)

Requires Node.js and git on your PATH.

```bash
node native-host/install.js      # registers for Chrome, Brave, Edge (current user, no admin)
node native-host/uninstall.js    # removes it
```

Then reload the extension. *Settings* will show "Installed". The helper:
- only understands `ping`, `info`, `pull` and `remote-file` (files from a fixed list only); no arbitrary commands or paths;
- runs `git -C <extension folder> ...` without a shell and with `--ff-only` (it never merges or overwrites local work);
- can only be called by the extension ID above (`allowed_origins`).

macOS/Linux: the installer is not written yet; register `native-host/host.js` manually following the Chrome documentation.

### Private or public repo?

| | Git helper installed | No helper |
|---|---|---|
| Version check & rule fetch | `git fetch` + read `origin` (uses your git credentials) | `raw.githubusercontent.com`, no login |
| **Private** repo | works | **does not work** (404) |
| **Public** repo | works | works (enter `owner/name` in *Settings*) |
| *Update now* button | works | not available |

With the helper, no repo setting is needed: it uses the `origin` of the extension folder.
The check is read-only (`git fetch`); your files do not change until you press *Update now*.
The helper can only read `manifest.json` and `rules/rules.json` (fixed list).

## Adding rules for stubborn sites

Edit `rules/rules.json` (or paste into *Settings → Your own rules* to try something without committing):

```json
{
  "schema": 1,
  "version": "2026.11.02",
  "sites": [
    {
      "hosts": ["example.test"],
      "scriptlets": [
        ["set-constant", "adBlockDetected", "false"],
        ["no-fetch-if", "adsbygoogle"],
        ["spoof-css", ".ad-bait", "display", "block"]
      ],
      "remove": [".adblock-modal"],
      "unlock": true,
      "note": "why this rule exists"
    }
  ]
}
```

- `hosts`: a domain plus all its subdomains; `"*"` = every site.
- `scriptlets`: `["name", arg…]`; every arg is a string.
- `remove`: CSS selectors to hide. `unlock`: restore scrolling.
- **Bump `version`** so other users receive the rule update.

| Scriptlet | Args | Effect |
|---|---|---|
| `set-constant` | `chain`, `value` | `window.<chain>` always has that value. Values: `true false null undefined noopFunc trueFunc falseFunc emptyObj emptyArr`, a number, or `""` |
| `abort-on-property-read` | `chain` | A script that *reads* that property is stopped (ReferenceError) |
| `abort-on-property-write` | `chain` | A script that *writes* that property is stopped |
| `no-fetch-if` | `text` or `/regex/` | `fetch()` to a matching URL gets an empty 200 response |
| `prevent-setTimeout` / `prevent-setInterval` | `text or /regex/`, `delay` (optional) | Matching callbacks become no-ops |
| `spoof-css` | `selector`, `prop`, `value`, … | `getComputedStyle` reports a fake value for those elements |

Rules can only choose from this list. An invalid remote rule set is rejected **entirely** (never partially applied).

### Adding a new scriptlet

1. Write a **self-contained** function in `src/scriptlets/` (it is serialised, so it cannot reference anything outside its own body).
2. Register it in `src/scriptlets/index.js` (`fn`, `minArgs`, `args`).
3. Add a sample in `tests/scriptlets.test.js`. The test fails if you forget, and it runs the function in a sandbox to prove it really is self-contained.

## Release checklist

1. Change code/rules; `npm test` must pass.
2. Bump `version` in **`manifest.json`** (and `package.json`). Without this, users will not see the update button.
3. If rules changed, bump `version` in `rules/rules.json`.
4. `git commit` → `git push`.

## Known limits

- **Not yet tested in a real browser.** Tested: rule/scriptlet/host/`git pull`/`remote-file` logic (`npm test`, 29 tests) and `generic-main.js` in jsdom. Not yet tested: loading the extension, popup/options, `webNavigation` + `executeScript`, and native messaging in a real Chrome/Brave.
- **Timing race:** per-site scriptlets are injected through `webNavigation.onCommitted`; that is very early but can lose to some sites' first inline script. `generic-main.js` does not have this problem.
- **Detector scripts that declare a global `function FuckAdBlock(){}`** can overwrite the fake object; such sites need a dedicated rule.
- Sites that detect on the server side, or with unique code, will not be beaten by the generic defences.
- The generic defences are always on unless you disable the site in the popup; they cannot be excluded below domain level.
- No rules for real sites are included: `rules/rules.json` starts empty until rules have been tested on the sites concerned.

## Credits & licence

Techniques were studied from the documentation and open code of [uBlock Origin](https://github.com/gorhill/uBlock/wiki/Resources-Library),
[AdGuard Scriptlets](https://github.com/AdguardTeam/Scriptlets) and the [EasyList Adblock Warning Removal List](https://github.com/easylist/antiadblockfilters).
All code here was rewritten independently, so **no GPL code was copied**. If you later copy code or rules from a
GPL-3.0 project (for example rules from uAssets), this project must also be licensed GPL-3.0 and attribution included.
