/**
 * lib/chunk-guard.ts — V93 defensive reload-on-chunk-failure.
 *
 * Problem: the cockpit ships as a Vite-bundled SPA with code-splitting.
 * Every deploy produces new chunk file names (content-hashed). An
 * operator with a tab open from a PREVIOUS deploy still holds the
 * old main bundle, which references chunk file names that the CDN
 * no longer serves. When the runtime triggers `await import(...)`
 * for one of those chunks (e.g. a lazy modal, a side-route),
 * `Failed to fetch dynamically imported module` lands as an
 * unhandled promise rejection AND the user-facing action silently
 * stops working.
 *
 * V93 first removed every dynamic import from the hot project-switch
 * path (state/daemon.ts) so the most common stale-deploy bug is gone
 * at the root. This module is the safety net for the remaining cases:
 * any rare `await import` we might add later is automatically caught.
 *
 * Strategy: install `error` and `unhandledrejection` listeners on
 * `window`. If the failure looks like a chunk-load issue, reload the
 * page ONCE (using sessionStorage to debounce — never loop).
 *
 * Why reload vs. a styled banner: the operator clicked something
 * and got nothing. Reloading takes ~1 s on a warm cache and gives
 * them the new bundle. A banner adds friction for a class of error
 * that only happens to stale tabs after a deploy — they're going
 * to reload anyway.
 */

const RELOAD_SENTINEL = 'mc-chunk-guard-reloaded';

function looksLikeChunkLoadError(message: string): boolean {
  // Vite/Rollup-emitted runtime errors come in a few shapes across
  // browsers; this regex covers the ones we've actually seen plus
  // the common variants documented by Vite issues.
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Loading chunk \d+ failed/i.test(message) ||
    /ChunkLoadError/i.test(message)
  );
}

function reloadOnce(message: string): void {
  try {
    if (sessionStorage.getItem(RELOAD_SENTINEL)) {
      // Already reloaded once this session — don't loop. The chunk
      // load is failing for a reason other than "stale bundle".
      // eslint-disable-next-line no-console
      console.error('[chunk-guard] suppressed second reload — chunk still missing after refresh', message);
      return;
    }
    sessionStorage.setItem(RELOAD_SENTINEL, String(Date.now()));
  } catch {
    /* private mode / sessionStorage disabled — proceed anyway */
  }
  // eslint-disable-next-line no-console
  console.warn('[chunk-guard] chunk-load failure detected — reloading once to pick up the new bundle', message);
  // Force a network revalidation; bypass any aggressive HTTP cache.
  try {
    window.location.reload();
  } catch {
    /* SSR safety — shouldn't happen in browser */
  }
}

export function installChunkGuard(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (ev) => {
    const msg = ev.message || (ev.error instanceof Error ? ev.error.message : '');
    if (msg && looksLikeChunkLoadError(msg)) reloadOnce(msg);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    const msg = r instanceof Error ? r.message : typeof r === 'string' ? r : '';
    if (msg && looksLikeChunkLoadError(msg)) reloadOnce(msg);
  });
}

/** Test seam — clear the once-per-session sentinel. Not used in prod. */
export function _resetChunkGuardForTest(): void {
  try { sessionStorage.removeItem(RELOAD_SENTINEL); } catch { /* ignore */ }
}
