/**
 * global-errors.ts — route UNCAUGHT errors into the log sink so they reach
 * the daemon debug stream (POST /debug/log), not just the browser console.
 *
 * Why this exists (field 2026-07-09): the cockpit only forwarded EXPLICIT
 * `log.*` calls to the daemon. A genuine crash — an uncaught exception or an
 * unhandled promise rejection, e.g. a reactive "Maximum call stack size
 * exceeded" — never left the browser, so the operator's daemon-side
 * observability (`GET /debug/tail`) showed nothing while the UI was dead. This
 * closes that gap: now the ONE debug stream captures the crash itself.
 *
 * Safeguards:
 *  - Throttled. A stack-overflow / render loop can fire `onerror` thousands of
 *    times per second; we cap emission to MAX_PER_WINDOW per WINDOW_MS and
 *    count the rest as `suppressed` so we never feed the very loop we're
 *    reporting.
 *  - Never throws. Any failure inside the handler is swallowed — an
 *    observability hook must not become a second fault.
 */
import { log } from './log';

const WINDOW_MS = 2_000;
const MAX_PER_WINDOW = 5;
let windowStart = 0;
let inWindow = 0;
let suppressed = 0;
let installed = false;

function allow(): boolean {
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    if (suppressed > 0) {
      // Best-effort note of how many we dropped in the prior window.
      try { log.warn('global-errors: suppressed burst', { suppressed }); } catch { /* ignore */ }
    }
    windowStart = now;
    inWindow = 0;
    suppressed = 0;
  }
  if (inWindow >= MAX_PER_WINDOW) { suppressed += 1; return false; }
  inWindow += 1;
  return true;
}

export function installGlobalErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e: ErrorEvent) => {
    try {
      if (!allow()) return;
      const err = e.error as Error | undefined;
      log.error('uncaught error', {
        message: e.message || err?.message || 'unknown',
        source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
        stack: err?.stack?.slice(0, 2000),
      });
    } catch { /* observability must never fault */ }
  });

  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    try {
      if (!allow()) return;
      const r = e.reason as unknown;
      const err = r instanceof Error ? r : undefined;
      log.error('unhandled rejection', {
        message: err?.message ?? (typeof r === 'string' ? r : JSON.stringify(r)?.slice(0, 400)),
        stack: err?.stack?.slice(0, 2000),
      });
    } catch { /* observability must never fault */ }
  });
}
