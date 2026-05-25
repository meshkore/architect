/**
 * known-projects.ts — persistent rail of MeshKore projects.
 *
 * The architect cockpit's left rail shows every project it has ever
 * seen, regardless of whether the daemon is currently running. The
 * operator removes projects manually (drag-to-trash); auto-removal
 * is FORBIDDEN (V79o rule: rails never auto-disappear). This module
 * is the storage layer behind that rail.
 *
 * Storage keys (must match the V80 monolith so both can read the
 * same data during the migration overlap):
 *   - `mc-known-projects-v1`  — JSON array of project records
 *   - `mc-project-aliases-v1` — JSON map { <cluster_id|port:n>: <alias> }
 *
 * Record shape (`KnownProject`):
 *   {
 *     port: number,
 *     base: string,              // e.g. "http://localhost:5570"
 *     cluster_id?: string,
 *     cluster_name?: string,
 *     repo_path?: string,        // operator can attach the on-disk path
 *     last_seen: string,         // ISO timestamp from last successful probe
 *     status?: 'live' | 'stopped'
 *   }
 *
 * Dedup semantics (V77b/V78d):
 *   - Upsert by cluster_id first (stable across port changes).
 *   - Fallback to dedup by port when there is no cluster_id.
 *   - When upserting a new live record collapses against a known
 *     entry with a different port (same cluster_id), the new port
 *     wins and `last_seen` is bumped.
 *
 * TTL (V77b): records older than 30 days drop from `list()` results
 * automatically (so a long-vanished test daemon doesn't clutter the
 * rail forever). They're still in localStorage until the next write
 * triggers a sweep.
 */

const STORE_KEY = 'mc-known-projects-v1';
const ALIAS_KEY = 'mc-project-aliases-v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface KnownProject {
  port: number;
  base: string;
  cluster_id?: string;
  cluster_name?: string;
  repo_path?: string;
  last_seen: string;
  status?: 'live' | 'stopped';
}

function readRaw(): KnownProject[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isKnownProject);
  } catch {
    return [];
  }
}

function isKnownProject(v: unknown): v is KnownProject {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.port === 'number' && typeof r.base === 'string' && typeof r.last_seen === 'string';
}

function writeRaw(arr: KnownProject[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(arr));
  } catch {
    /* quota / private mode */
  }
}

function readAliases(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ALIAS_KEY);
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

function writeAliases(map: Record<string, string>): void {
  try {
    localStorage.setItem(ALIAS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function aliasKeyFor(p: KnownProject): string {
  return p.cluster_id && p.cluster_id.trim().length > 0 ? p.cluster_id : `port:${p.port}`;
}

function fresh(p: KnownProject): boolean {
  const t = Date.parse(p.last_seen);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < MAX_AGE_MS;
}

/**
 * Return all known projects, sorted most-recent first, dropping any
 * record older than `MAX_AGE_MS`.
 */
export function list(): KnownProject[] {
  return readRaw()
    .filter(fresh)
    .sort((a, b) => (b.last_seen.localeCompare(a.last_seen)));
}

/**
 * Smart upsert. Collapses by cluster_id first (stable); falls back to
 * port. Bumps `last_seen` to now. Returns the merged record.
 */
export function upsert(input: Partial<KnownProject> & { port: number; base: string }): KnownProject {
  const arr = readRaw();
  const now = new Date().toISOString();
  const incoming: KnownProject = {
    port: input.port,
    base: input.base,
    cluster_id: input.cluster_id,
    cluster_name: input.cluster_name,
    repo_path: input.repo_path,
    last_seen: now,
    status: input.status,
  };
  let idx = -1;
  if (incoming.cluster_id) {
    idx = arr.findIndex((p) => p.cluster_id === incoming.cluster_id);
  }
  if (idx < 0) {
    idx = arr.findIndex((p) => !p.cluster_id && p.port === incoming.port);
  }
  if (idx >= 0) {
    // Merge — let new fields win, but preserve `repo_path` if the
    // incoming record didn't bring one.
    const prev = arr[idx];
    if (!prev) {
      arr.push(incoming);
      writeRaw(arr);
      return incoming;
    }
    const merged: KnownProject = {
      ...prev,
      ...incoming,
      repo_path: incoming.repo_path ?? prev.repo_path,
    };
    arr[idx] = merged;
    writeRaw(arr);
    return merged;
  }
  arr.push(incoming);
  writeRaw(arr);
  return incoming;
}

/**
 * Forget a project. By cluster_id when supplied, else by port.
 * No-op if not found.
 */
export function forget(target: { cluster_id?: string; port?: number }): boolean {
  const arr = readRaw();
  let idx = -1;
  if (target.cluster_id) idx = arr.findIndex((p) => p.cluster_id === target.cluster_id);
  if (idx < 0 && typeof target.port === 'number') {
    idx = arr.findIndex((p) => !p.cluster_id && p.port === target.port);
  }
  if (idx < 0) return false;
  arr.splice(idx, 1);
  writeRaw(arr);
  return true;
}

/**
 * Attach an on-disk repo path to a known project. Used by the
 * "Browse to repo" action so the cockpit can later open a terminal
 * cwd'd into the project.
 */
export function attachRepoPath(target: { cluster_id?: string; port?: number }, repoPath: string): boolean {
  const arr = readRaw();
  let idx = -1;
  if (target.cluster_id) idx = arr.findIndex((p) => p.cluster_id === target.cluster_id);
  if (idx < 0 && typeof target.port === 'number') {
    idx = arr.findIndex((p) => !p.cluster_id && p.port === target.port);
  }
  if (idx < 0) return false;
  const prev = arr[idx];
  if (!prev) return false;
  arr[idx] = { ...prev, repo_path: repoPath };
  writeRaw(arr);
  return true;
}

/** Read the operator-set display alias for a project (if any). */
export function getAlias(p: KnownProject): string | undefined {
  const map = readAliases();
  return map[aliasKeyFor(p)];
}

/** Set or clear the operator-set display alias. Pass empty string to clear. */
export function setAlias(p: KnownProject, alias: string): void {
  const map = readAliases();
  const k = aliasKeyFor(p);
  if (alias.trim().length === 0) {
    delete map[k];
  } else {
    map[k] = alias.trim();
  }
  writeAliases(map);
}
