#!/usr/bin/env node
/**
 * sync-daemon-version.mjs
 * ───────────────────────
 * Reads `DAEMON_VERSION` from `.meshkore/scripts/daemon.py` (canonical
 * source of truth) and rewrites the cockpit's `EXPECTED_DAEMON_VERSION`
 * constant in `src/lib/version.ts` to match.
 *
 * Why this exists: the cockpit shows a "daemon ahead — Reload" banner
 * whenever the daemon version is > EXPECTED. Without this script,
 * every daemon bump silently desynced the cockpit constant — and
 * because the build embeds the OLD value into the bundle, hitting
 * Reload re-downloaded the same stale bundle, the banner reappeared,
 * operator stuck in a loop.
 *
 * Wired as the cockpit's `prebuild` step (package.json) so every
 * `npm run build` syncs first. Idempotent: writes only if the value
 * actually changed.
 *
 * Note: this script bumps EXPECTED_DAEMON_VERSION, NOT
 * MIN_DAEMON_VERSION. MIN is the floor the cockpit demands; that
 * needs a human decision (which versions to drop support for) and
 * stays operator-controlled.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

// CVS1 (2026-06-12) — Prefer the canonical daemon source over the
// cluster's auto-updated copy. Operator field report 2026-06-12:
// MeshKore Core cluster was down → its `.meshkore/scripts/daemon.py`
// stayed at py-1.12.24 from yesterday. The prebuild read that file
// and baked an EXPECTED_DAEMON_VERSION two minors behind into the
// production bundle, triggering a false "daemon ahead" banner.
//
// Lookup order:
//   1. daemon/daemon.py — canonical; updated SECONDS before every
//      deploy. Always matches what just shipped.
//   2. .meshkore/scripts/daemon.py — fallback for workspaces that
//      have only the cluster's local copy. Warning emitted because
//      stale risk reappears.
const canonicalDaemonPath = join(repoRoot, 'daemon', 'daemon.py');
const fallbackDaemonPath = join(repoRoot, '.meshkore', 'scripts', 'daemon.py');
const daemonPath = existsSync(canonicalDaemonPath)
  ? canonicalDaemonPath
  : fallbackDaemonPath;
if (daemonPath === fallbackDaemonPath) {
  console.warn(
    '[sync-daemon-version] canonical daemon/daemon.py missing — falling ' +
    "back to the cluster's local copy. EXPECTED_DAEMON_VERSION may be " +
    'stale if that cluster lags the CDN.',
  );
}
const versionPath = join(__dirname, '..', 'src', 'lib', 'version.ts');

function fail(msg) {
  console.error(`[sync-daemon-version] ${msg}`);
  process.exit(1);
}

let daemonSrc;
try {
  daemonSrc = readFileSync(daemonPath, 'utf8');
} catch (e) {
  fail(`cannot read ${daemonPath}: ${e.message}`);
}

const m = daemonSrc.match(/^DAEMON_VERSION\s*=\s*"([^"]+)"/m);
if (!m) fail(`DAEMON_VERSION marker not found in ${daemonPath}`);
const daemonVersion = m[1];

let versionSrc;
try {
  versionSrc = readFileSync(versionPath, 'utf8');
} catch (e) {
  fail(`cannot read ${versionPath}: ${e.message}`);
}

const before = versionSrc.match(/export const EXPECTED_DAEMON_VERSION\s*=\s*'([^']+)';/);
if (!before) fail(`EXPECTED_DAEMON_VERSION line not found in ${versionPath}`);

if (before[1] === daemonVersion) {
  console.log(`[sync-daemon-version] EXPECTED already at ${daemonVersion}, no change`);
  process.exit(0);
}

const next = versionSrc.replace(
  /export const EXPECTED_DAEMON_VERSION\s*=\s*'[^']+';/,
  `export const EXPECTED_DAEMON_VERSION = '${daemonVersion}';`,
);
writeFileSync(versionPath, next, 'utf8');
console.log(`[sync-daemon-version] ${before[1]} → ${daemonVersion}`);
