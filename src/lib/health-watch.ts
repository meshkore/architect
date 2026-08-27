/**
 * health-watch.ts — AX7 (UX-F6). "Poll `/health` until a daemon
 * answers", in one place.
 *
 * OfflinePanel has had this loop since the V86 wizard rewrite: a 2s
 * probe that reconnects the moment the daemon comes back, so the
 * operator never has to click anything. The BOOT no-daemon state had
 * nothing — `connect()` runs once from `App.onMount`, so starting the
 * daemon while that panel was open changed nothing on screen until the
 * operator hit "Retry detection" by hand.
 *
 * Same need, same loop, so it lives here and both callers use it.
 *
 * Cancellation is the load-bearing part: the returned stop function is
 * wired to `onCleanup` in both callers, and the in-flight probe
 * re-checks it AFTER every await (A-OFFLINE-RACE-01 — a probe that
 * resolves post-cancel used to fire a switch to a port the panel had
 * already moved off).
 */

import { daemonHttpBase } from '~/lib/transport';

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 800;
const DEFAULT_REPEAT_DELAY_MS = 5000;

export interface HealthWatchOptions {
  /** Ports to probe each round. Read fresh every round, so a caller
   *  whose target moves does not need to restart the watcher. */
  ports: () => readonly number[];
  /** First port whose `/health` answers 200. */
  onUp: (port: number) => void;
  /**
   * Diagnose the "something is bound but speaks plain HTTP" case: after
   * a failed HTTPS probe, retry over `http://` while `while()` holds.
   * Costs an extra request per round, so callers switch it off once
   * they have their answer.
   */
  httpOnlyCheck?: { while: () => boolean; onDetected: (port: number) => void };
  intervalMs?: number;
  timeoutMs?: number;
  /**
   * Keep polling after `onUp`. Needed when `onUp` merely ATTEMPTS a
   * connection (the boot gate's `connect()`), because a failed attempt
   * leaves the panel on screen and a stopped watcher would never look
   * again. Default false — the caller unmounts on success.
   */
  repeatAfterUp?: boolean;
  repeatDelayMs?: number;
}

/** Start watching. Returns the cancel function; calling it twice is safe. */
export function watchDaemonHealth(opts: HealthWatchOptions): () => void {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const repeatDelayMs = opts.repeatDelayMs ?? DEFAULT_REPEAT_DELAY_MS;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const answered = async (port: number): Promise<boolean> => {
    try {
      const r = await fetch(`${daemonHttpBase(port)}/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return r.ok;
    } catch {
      return false;
    }
  };

  const speaksPlainHttp = async (port: number): Promise<boolean> => {
    try {
      const r = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return r.ok;
    } catch {
      return false;
    }
  };

  const round = async (): Promise<void> => {
    if (cancelled) return;
    const ports = opts.ports();
    const results = await Promise.all(
      ports.map(async (p) => ({ port: p, up: await answered(p) })),
    );
    // Re-check AFTER the await: the caller may have unmounted or moved
    // to another port while these were in flight.
    if (cancelled) return;
    const live = results.find((r) => r.up);
    if (live) {
      opts.onUp(live.port);
      if (!opts.repeatAfterUp) return;
      timer = setTimeout(() => { void round(); }, repeatDelayMs);
      return;
    }
    const diag = opts.httpOnlyCheck;
    if (diag && diag.while()) {
      for (const p of ports) {
        if (cancelled) return;
        if (await speaksPlainHttp(p)) {
          if (cancelled) return;
          diag.onDetected(p);
          break;
        }
      }
    }
    if (cancelled) return;
    timer = setTimeout(() => { void round(); }, intervalMs);
  };

  void round();

  return () => {
    cancelled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
