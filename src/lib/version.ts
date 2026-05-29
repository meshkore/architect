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
 * V94 — bumped to `py-1.10.3`. The cockpit now hard-depends on:
 *   - /runs endpoints + run.* WS events (py-1.10.0)
 *   - /health.chat_active_convs (py-1.10.2)
 *   - roadmap-architect agent type (py-1.10.3)
 * Older daemons would silently no-op those calls, leaving the
 * operator with a broken UI and no diagnostic. Failing closed via
 * the outdated modal is the honest behaviour.
 */
export const MIN_DAEMON_VERSION = 'py-1.10.3';

/**
 * EXPECTED_DAEMON_VERSION — the daemon version THIS COCKPIT BUNDLE
 * was built against. Used for the "ahead" detector: if the daemon
 * is *newer* than this, the cockpit may not understand new event
 * shapes or response fields, so we surface a "refresh recommended"
 * banner. The operator's tab still works, but a refresh picks up
 * the matching cockpit bundle.
 *
 * Keep this equal to the daemon version of the LAST commit that
 * cockpit code statically depends on. If you bump the daemon and
 * the cockpit consumes a new field, bump this too in the same PR.
 */
export const EXPECTED_DAEMON_VERSION = 'py-1.10.3';

/** Convenience: gate against the project's MIN. */
export function meetsMinimum(actual: string | DaemonVersion | undefined | null): boolean {
  return isDaemonAtLeast(actual, MIN_DAEMON_VERSION);
}

/**
 * Returns true when the daemon is STRICTLY newer than the version
 * this cockpit bundle was built against. Triggers a soft "refresh"
 * nudge (not a hard block) so the operator doesn't keep running
 * against a daemon whose WS payload contract may have evolved.
 *
 * Major/minor only — patch-level bumps (bug fixes, no contract
 * changes) don't trip the nudge, matching daemon's semver intent.
 */
export function isDaemonAhead(actual: string | DaemonVersion | undefined | null): boolean {
  const a =
    typeof actual === 'string' || actual === null || actual === undefined
      ? parseDaemonVersion((actual as string | null) ?? null)
      : actual;
  const e = parseDaemonVersion(EXPECTED_DAEMON_VERSION);
  if (!a || !e) return false;
  if (a.major !== e.major) return a.major > e.major;
  return a.minor > e.minor;
}
