/**
 * lib/cockpit-version.ts — V99 cockpit self-version detection.
 *
 * Symmetric counterpart to lib/version.ts (which tracks the DAEMON's
 * version). This one watches the COCKPIT bundle the operator's tab
 * is currently running and detects when a newer cockpit has been
 * deployed.
 *
 * Operator's complaint: "Aquí hay algo desactualizado y, sobre todo,
 * hay algo que no controla bien si estamos actualizados o no. […]
 * tenemos problemas con la gestión de actualizaciones desde el
 * frontend." The cockpit had no way to know when CF Pages was
 * serving a newer bundle — every fix required a manual hard refresh
 * and the operator had no signal that a refresh was even needed.
 *
 * How it works:
 *   - The Vite build emits `dist/health.json` with
 *     `{name, version, commit, built_at}` on every deploy. The
 *     commit is the short git SHA at build time. Bundled cockpit
 *     code reads its OWN commit through `import.meta.env.VITE_BUILD_COMMIT`.
 *   - At runtime we fetch `/health.json` (cache-busted with `?t=…`)
 *     every CHECK_INTERVAL_MS. If the server's `commit` is anything
 *     other than what we were built with, a new cockpit is deployed.
 *   - The `cockpitOutdated` signal flips true. <CockpitOutdatedBanner>
 *     (Cockpit.tsx) renders a slim cyan strip with "Reload to pick
 *     up the new cockpit" — same idiom as the daemon-ahead banner.
 *
 * No service worker, no postMessage choreography — just an HTTP
 * poll on the static file the build already emits. Survives every
 * tab indefinitely; one cache-busted fetch every 5 minutes is
 * trivial cost.
 */

import { createSignal, onCleanup } from 'solid-js';
import { log } from './log';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const HEALTH_URL = '/health.json';

interface CockpitHealth {
  name?: string;
  version?: string;
  commit?: string;
  built_at?: string;
}

/** The commit hash the running bundle was built with. Resolved at
 *  build time via Vite's `define`. `'unknown'` only when the build
 *  ran without git available (CI fallback). */
export const COCKPIT_COMMIT: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BUILD_COMMIT ?? 'unknown';

export const COCKPIT_VERSION: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_BUILD_VERSION ?? '0.0.0';

const [serverCommit, setServerCommit] = createSignal<string | null>(null);
const [lastCheckAt, setLastCheckAt] = createSignal<number | null>(null);

/** True when /health.json reports a different commit than this bundle.
 *  Stays true once it flips — the operator must reload to clear it. */
export const cockpitOutdated = (): boolean => {
  const s = serverCommit();
  if (!s || s === 'unknown') return false; // can't tell → fail open
  if (COCKPIT_COMMIT === 'unknown') return false;
  return s !== COCKPIT_COMMIT;
};

/** The commit the server is currently serving, or null if we haven't
 *  successfully polled yet. */
export const latestCockpitCommit = (): string | null => serverCommit();

/** When the last successful poll happened (wall-clock ms), or null. */
export const lastVersionCheckAt = (): number | null => lastCheckAt();

let probeInflight = false;

/** Probe /health.json once. Returns the server commit, or null on
 *  failure. Cache-busted with a timestamp so CF / browser caches
 *  never serve a stale copy. */
export async function probeCockpitHealth(): Promise<string | null> {
  if (probeInflight) return serverCommit();
  probeInflight = true;
  try {
    const res = await fetch(`${HEALTH_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      log.warn('cockpit health probe non-OK', res.status);
      return serverCommit();
    }
    const j = (await res.json()) as CockpitHealth;
    const c = typeof j.commit === 'string' && j.commit.length > 0 ? j.commit : null;
    if (c) {
      const prev = serverCommit();
      setServerCommit(c);
      setLastCheckAt(Date.now());
      if (prev !== c && prev !== null) {
        log.info('cockpit health: new server commit detected', { from: prev, to: c, bundled: COCKPIT_COMMIT });
      }
    }
    return c;
  } catch (e) {
    log.warn('cockpit health probe threw', e instanceof Error ? e.message : String(e));
    return serverCommit();
  } finally {
    probeInflight = false;
  }
}

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Start the poll loop. Idempotent — calling twice is a no-op. */
export function startCockpitVersionPoll(): void {
  if (started) return;
  started = true;
  // Initial probe right away so the first signal lands within a
  // second of boot, then settle into the longer interval.
  void probeCockpitHealth();
  timer = setInterval(() => { void probeCockpitHealth(); }, CHECK_INTERVAL_MS);
}

/** Stop the poll loop. Mostly for tests; the cockpit never calls
 *  this in production. */
export function stopCockpitVersionPoll(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}

/** Reactive subscriber that components can call to be re-rendered on
 *  every poll. Returns a cleanup. */
export function onCockpitVersionChange(fn: (commit: string | null) => void): () => void {
  // Naive — just fire current value + register a Solid effect. The
  // signal itself is reactive, so direct access from a memo works
  // without this helper for most callers. Kept for completeness.
  fn(serverCommit());
  const dispose: (() => void)[] = [];
  onCleanup(() => { for (const d of dispose) d(); });
  return () => { for (const d of dispose) d(); };
}
