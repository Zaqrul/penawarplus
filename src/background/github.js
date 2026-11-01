/** GitHub helpers. Pure functions, unit-tested. */

export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const BRANCH_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

/** Build a raw.githubusercontent.com URL (public repos only), refusing anything malformed. */
export function rawUrl(repo, branch, path) {
  if (!REPO_RE.test(repo)) throw new Error('Repo mesti dalam bentuk owner/nama');
  if (!BRANCH_RE.test(branch) || branch.includes('..')) throw new Error('Nama branch tidak sah');
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes('..')) throw new Error('Path tidak sah');
  return `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
}
