/** Dotted numeric versions only (1–4 parts), matching Chrome's manifest "version". */
export function parseVersion(v) {
  if (typeof v !== 'string' || !/^\d+(\.\d+){0,3}$/.test(v)) return null;
  return v.split('.').map(Number);
}

/** Returns 1, 0, -1, or null when either side is not a valid version. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
