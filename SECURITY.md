# Security policy

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on
https://github.com/Zaqrul/penawarplus. Do not open a public issue for security problems.

## Threat model

The extension runs on every website and can update itself from this repository, so the
repository is the main thing to protect. The defences, all enforced by `npm test`:

- **No remote code.** Rules fetched at runtime are *data only*, strictly validated, and can
  only select from the scriptlets registered in `src/scriptlets/index.js`. A rule set with any
  invalid entry is rejected as a whole.
- **No dynamic code in the extension.** Tests fail on `eval`, `new Function`, `innerHTML`,
  `document.write`, `importScripts`, remote `<script>`/stylesheets, or any network host other than GitHub.
- **Minimal manifest.** Permissions are pinned by a test; no `web_accessible_resources`,
  `externally_connectable` or `update_url`; no relaxed CSP.
- **Code updates are manual.** Code changes only when the user presses *Update now*, which runs
  `git pull --ff-only`. The native helper understands four fixed commands, never uses a shell,
  reads only a whitelist of files, and answers only to this extension's ID.
- **Pinned origin.** The helper refuses to pull or fetch unless the folder's `origin` is
  `Zaqrul/penawarplus`. Forks must opt in with the `PENAWARPLUS_TRUSTED_REMOTES` environment variable.

## For maintainers

- Enable 2FA on the GitHub account; a stolen account is the realistic way to ship malicious code.
- Review every change to `src/`, `native-host/` and `manifest.json` before pushing; `CODEOWNERS` marks them.
- Never add runtime dependencies. If you must, pin exact versions and review them.
- Keep `main` protected (no force-push, no deletion).

## For users

- Install only from the official repository: https://github.com/Zaqrul/penawarplus
- Before pressing *Update now*, you can read what changed: `git fetch && git log -p HEAD..@{upstream}`.
- Forks are not trusted by the update helper unless you explicitly allow them.
