/**
 * adopt.ts — auto-acquire a LOCAL daemon's bearer token from the launch URL,
 * so the operator never pastes a token for their own machine (2026-06-24).
 *
 * Security model. The bearer token guards the daemon's loopback shell-exec
 * endpoint against malicious WEBSITES open in the operator's browser. The
 * browser cannot read the mode-600 token file, so something on the machine
 * must hand it over. A daemon endpoint that served the token over loopback
 * would leak it to ANY other local user/process (loopback is multi-user; the
 * file is owner-only) — a real escalation. The safe channel is the one only
 * the operator controls: their terminal (which read the 600 file) → their
 * browser. The launch command opens the cockpit with
 * `?mk_adopt=<port>&mk_cluster=<id>&mk_token=<token>` (Jupyter-style). The
 * token travels operator-terminal → operator-browser ONLY; it is never served
 * over the network, so this adds ZERO exposure to remote sites or other local
 * users, and does not weaken the malicious-website defense. We persist it for
 * the cluster, point the boot probe at its port, and strip the params from the
 * URL + history immediately so the token doesn't linger in the address bar.
 *
 * Remote / hub clusters are unaffected — they keep the explicit token flow.
 */
import { clusterTokenKey, saveTokenForCluster } from '~/lib/tokens';
import { log } from '~/lib/log';

const ADOPT_KEYS = ['mk_adopt', 'mk_cluster', 'mk_token'] as const;

/** Returns the adopted port (so the boot probe targets it) or null. */
export function adoptTokenFromUrl(): number | null {
  let adoptedPort: number | null = null;
  try {
    const p = new URLSearchParams(window.location.search);
    const token = p.get('mk_token');
    const portRaw = p.get('mk_adopt');
    if (token && portRaw) {
      const port = parseInt(portRaw, 10);
      const clusterId = (p.get('mk_cluster') || '').trim() || null;
      if (Number.isFinite(port) && port > 0) {
        saveTokenForCluster(clusterTokenKey({ cluster_id: clusterId, port }), token);
        try { localStorage.setItem('meshcore-last-port', String(port)); } catch { /* private mode */ }
        adoptedPort = port;
        log.info('adopt: stored token from launch URL', { port, cluster: clusterId });
      }
    }
  } catch (e) {
    log.warn('adopt: failed to parse launch URL', e);
  } finally {
    // Strip mk_* params from the URL + history regardless of outcome, so the
    // token never lingers in the address bar / back-forward cache.
    try {
      const url = new URL(window.location.href);
      let changed = false;
      for (const k of ADOPT_KEYS) {
        if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true; }
      }
      if (changed) {
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    } catch { /* ignore */ }
  }
  return adoptedPort;
}
