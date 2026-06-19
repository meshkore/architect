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
 * cockpit shows the upgrade modal and offers `/self-update`.
 *
 * py-1.11.1 — bumped to py-1.11.0. Phase 2 of chat-state-rearchitecture
 * deleted the legacy fallback path; the cockpit now hard-depends on
 * `GET /chat/snapshot` + WS `conv.*` events. A pre-1.11 daemon would
 * leave the rail empty with no diagnostic — fail loud via the
 * outdated panel instead.
 *
 * py-1.12.6 — pluggable runners (cursor / claude-code), universal auth flow
 * (POST /auth/<platform>/start + runner.auth.* WS events for cursor,
 * claude-code, wrangler, gh, fly, vercel). RunnerAuthCard shown in chat.
 */
export const MIN_DAEMON_VERSION = 'py-1.11.0';

/**
 * EXPECTED_DAEMON_VERSION — the daemon version THIS COCKPIT BUNDLE
 * was built against. Used for the "ahead" detector: if the daemon
 * is *newer* than this, the cockpit may not understand new event
 * shapes or response fields, so we surface a "refresh recommended"
 * banner.
 *
 * **Auto-synced** at build time by `scripts/sync-daemon-version.mjs`
 * which reads DAEMON_VERSION from `.meshkore/scripts/daemon.py` and
 * rewrites this constant. Run via `npm run sync-version` (and via
 * `prebuild`). Without that step the cockpit would forever lag the
 * daemon by however many bumps happened since the last manual edit,
 * and operators get an infinite "Reload" loop (the new bundle has
 * the same stale EXPECTED → banner reappears).
 */
// 2026-06-13 — PINNED to py-1.14.3 (the version published to the CDN +
// running on all clusters). The canonical daemon.py is locally at
// py-1.14.4 because a daemon-modularize-2 refactor is in flight and
// UNPUBLISHED; auto-syncing to 1.14.4 here would make every cluster
// show DaemonBehindPanel and loop trying to self-update to a version
// the CDN doesn't serve. The modularize agent re-points this when it
// publishes 1.14.4. Build this with `npx vite build` (skips the
// prebuild sync) until then.
export const EXPECTED_DAEMON_VERSION = 'py-1.24.2';

/** Convenience: gate against the project's MIN. */
export function meetsMinimum(actual: string | DaemonVersion | undefined | null): boolean {
  return isDaemonAtLeast(actual, MIN_DAEMON_VERSION);
}

/**
 * V107.14 — Feature gate for the daemon's `/health.features` array.
 *
 * Some cockpit flows depend on daemon capabilities that landed AFTER
 * MIN_DAEMON_VERSION (the Run All architect's wake hook + chat-activity
 * surface, for example). A daemon at or above MIN can still lack these
 * features if it's an intermediate version (e.g. py-1.10.13 between
 * MIN=py-1.10.3 and the wake hook in py-1.10.22).
 *
 * Treating "missing required feature" as outdated lets us reuse the
 * single full-area DaemonOutdatedPanel + AutoUpdateFlow contract for
 * both the version-too-old AND feature-gapped cases. No inline
 * banners, no special cases — one trigger, one UX, one recovery path.
 *
 * To add a new gated feature: list it here AND ensure the daemon
 * version that ships it is at or above MIN_DAEMON_VERSION (otherwise
 * the version check already catches it).
 */
export const REQUIRED_DAEMON_FEATURES: readonly string[] = [
  'agents.architect-wake.v1',  // py-1.10.22 — architect resumes after subagent finishes
  'chat.snapshot.v1',          // py-1.11.0 — daemon-authoritative conv list + paginated messages
];

export function missingRequiredFeatures(features: readonly string[] | undefined | null): string[] {
  const have = new Set(features ?? []);
  return REQUIRED_DAEMON_FEATURES.filter((f) => !have.has(f));
}

export function isFeatureGapped(features: readonly string[] | undefined | null): boolean {
  return missingRequiredFeatures(features).length > 0;
}

/**
 * 2026-06-12 — Returns true when the daemon is STRICTLY older than
 * `EXPECTED_DAEMON_VERSION` (the cockpit's build target) but STILL
 * meets the hard minimum. This is the "behind but functional" band:
 * everything works, but the operator is missing new features that
 * just shipped. Drives the soft `DaemonBehindBanner` — a thin top
 * strip with an "Update now" button, NOT a full-body block.
 *
 * `DaemonOutdatedPanel` (full body) still handles the hard case
 * (daemon below MIN or feature-gapped). `DaemonAheadPanel` handles
 * the inverse (daemon ahead by ≥ minor).
 */
export function isDaemonBehind(actual: string | DaemonVersion | undefined | null): boolean {
  if (!meetsMinimum(actual)) return false; // hard-outdated supersedes
  return !isDaemonAtLeast(actual, EXPECTED_DAEMON_VERSION);
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
  // A-VERSION-UNIFY-01 (2026-06-16) — a minor/patch-ahead daemon NO LONGER
  // hard-blocks the cockpit. The daemon's semver policy is minor = ADDITIVE
  // (new OPTIONAL wire fields), major = breaking; an older cockpit safely
  // ignores unknown fields. Hard-blocking the full render on EVERY minor
  // bump forced a redeploy+reload on each daemon upgrade (operator friction,
  // 2026-06-15/16: the gate fired on py-1.16.1→1.17.0 even though the bump
  // was purely additive). The "reload to pick up the matching cockpit
  // bundle" nudge is handled separately + softly by cockpitOutdated
  // (lib/cockpit-version.ts). Only a MAJOR-ahead daemon — a genuine wire
  // break — trips the full-page DaemonAheadPanel now.
  return false;
}
