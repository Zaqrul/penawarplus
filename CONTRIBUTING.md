# Contributing

1. Fork, branch, change, and run `npm test` (no install step needed).
2. Keep the extension free of runtime dependencies, build steps and remote code; `tests/security.test.js` enforces this.
3. New site rules go in `rules/rules.json` with a `note` explaining why, and a bumped `version`.
4. Open a pull request. Changes to `src/`, `native-host/` and `manifest.json` get a careful review.

By contributing you agree your work is released under the MIT licence.
