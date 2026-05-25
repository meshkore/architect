/**
 * tokens.ts — per-cluster bearer token storage.
 *
 * The cockpit can talk to several daemons (MeshKore Core, Ikamiro,
 * any operator project). Each one mints its own bearer token; we must
 * keep them straight so switching projects doesn't ask for a token
 * the operator already pasted.
 *
 * Storage shape (localStorage key `meshkore-tokens-v1`):
 *
 *   {
 *     "meshkore-main": "<token>",
 *     "ikamiro":        "<token>",
 *     "port:5577":      "<token>"  // fallback when cluster_id unknown
 *   }
 *
 * Legacy fallback: the pre-V78g monolith used a single
 * `meshcore-token` key. When we don't find a per-cluster token, we
 * fall back to the legacy value so operators don't lose access on
 * the upgrade. Once they paste a fresh token, the per-cluster slot
 * fills in and the legacy value becomes irrelevant.
 *
 * V78g rule reminder: NEVER write to the legacy key from this file —
 * only read it as a fallback. We don't want to grow it accidentally.
 */

const STORE_KEY = 'meshkore-tokens-v1';
const LEGACY_KEY = 'meshcore-token';

/** Minimal project shape needed to derive a token key. */
export interface ClusterIdentity {
  cluster_id?: string | null;
  port?: number;
}

/**
 * Derive the localStorage map key for a cluster.
 * Prefers `cluster_id` (stable across port changes). Falls back to
 * `port:<n>` only when we have no cluster_id yet (e.g. before /health
 * returns).
 */
export function clusterTokenKey(project: ClusterIdentity): string {
  if (project.cluster_id && project.cluster_id.trim().length > 0) {
    return project.cluster_id.trim();
  }
  if (typeof project.port === 'number') return `port:${project.port}`;
  return 'unknown';
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function writeMap(m: Record<string, string>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(m));
  } catch {
    /* private mode / quota — best-effort */
  }
}

function readLegacy(): string {
  try {
    return localStorage.getItem(LEGACY_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Look up a token for a cluster key. Returns `''` if neither the
 * per-cluster slot nor the legacy fallback have one.
 */
export function tokenForCluster(key: string): string {
  const m = readMap();
  const t = m[key];
  if (typeof t === 'string' && t.length > 0) return t;
  return readLegacy();
}

/** Persist a token for a cluster key. Replaces any prior value. */
export function saveTokenForCluster(key: string, token: string): void {
  const m = readMap();
  m[key] = token;
  writeMap(m);
}

/** Forget a single cluster's token (e.g. operator clicked "Forget token"). */
export function clearTokenForCluster(key: string): void {
  const m = readMap();
  delete m[key];
  writeMap(m);
}

/**
 * Return every cluster key that has a token stored. Used by the
 * about / debug pane to list "authenticated clusters".
 */
export function knownTokenKeys(): string[] {
  return Object.keys(readMap());
}
