/**
 * version.ts — daemon version parsing + comparison + gate constant.
 *
 * Daemon versions are tagged `py-<major>.<minor>.<patch>` (e.g.
 * `py-1.7.0`). The cockpit reads the version from two places:
 *   - the `x-meshkore-daemon-version` HTTP header on every response,
 *   - the `version` field of `/health` JSON.
 *
 * Both feed `parseDaemonVersion`. `isDaemonAtLeast(actual, required)`
 * answers the gate question — does this daemon satisfy the minimum
 * the cockpit needs?
 *
 * MIN_DAEMON_VERSION is the single source of truth across the Solid
 * tree (and, after M9 cutover, the only place that ever set it). The
 * V80 monolith currently holds its own copy at `py-1.2.0`; bumping
 * happens here when we need new features (e.g. the agent-type system
 * needs `py-1.7.0`).
 */

export interface DaemonVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

/**
 * Parse a `py-<M>.<m>.<p>` (or bare `<M>.<m>.<p>`) string. Returns
 * null if the input doesn't match the expected shape.
 *
 * Accepts surrounding whitespace and tolerates a missing patch
 * segment (`py-1.7` → `1.7.0`).
 */
export function parseDaemonVersion(raw: string | undefined | null): DaemonVersion | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = /^(?:py-)?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  return { major, minor, patch, raw: s };
}

function compare(a: DaemonVersion, b: DaemonVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Returns true iff the daemon at `actual` is at least as new as
 * `required`. Unknown / unparseable inputs return false so we fail
 * closed (treat them as outdated and prompt the operator to update).
 */
export function isDaemonAtLeast(
  actual: string | DaemonVersion | undefined | null,
  required: string | DaemonVersion,
): boolean {
  const a =
    typeof actual === 'string' || actual === null || actual === undefined
      ? parseDaemonVersion((actual as string | null) ?? null)
      : actual;
  const r = typeof required === 'string' ? parseDaemonVersion(required) : required;
  if (!a || !r) return false;
  return compare(a, r) >= 0;
}

/**
 * MIN_DAEMON_VERSION — the lowest daemon version the cockpit promises
 * to support. When the connected daemon's version is lower, the
 * cockpit shows the V47 upgrade modal (M6.3) and offers `/self-update`.
 *
 * Current floor: `py-1.7.0` (introduces the agent_type system and
 * the AGENT_PROMPTS registry the cockpit relies on at chat dispatch).
 * Older daemons run without specialised role prompts; the cockpit
 * still works in degraded mode but the gate keeps that behaviour off
 * the happy path.
 */
export const MIN_DAEMON_VERSION = 'py-1.7.0';

/** Convenience: gate against the project's MIN. */
export function meetsMinimum(actual: string | DaemonVersion | undefined | null): boolean {
  return isDaemonAtLeast(actual, MIN_DAEMON_VERSION);
}
