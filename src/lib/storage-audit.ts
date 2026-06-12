/**
 * storage-audit.ts — SRL4 — localStorage hygiene at boot.
 *
 * The architect's localStorage should contain ONLY per-browser
 * preferences. Conversation state, agent state, queue, partial
 * assistant text — all live in the daemon and arrive via
 * `/chat/snapshot` (SRL2). This module enforces that contract:
 * any `mc-*` / `meshkore-*` / `meshcore-*` key NOT in the allowlist
 * gets dropped at boot.
 *
 * Why a denylist would be worse: every release we'd have to remember
 * which legacy keys to garbage-collect. With an allowlist, anything
 * new sticks ONLY when explicitly registered here — automatic
 * cleanup of forgotten or pre-py-1.13.1 caches.
 */

import { log } from '~/lib/log';

/** Exact keys (no prefix). */
const ALLOWED_EXACT = new Set<string>([
  // Projects rail (per-browser bookmark list + aliases + order)
  'mc-known-projects-v1',
  'mc-project-aliases-v1',
  'mc-projects-order-v1',
  // Theme + layout (per-browser preferences)
  'mc-theme-v1',
  'mc-layout-v1',
  'mc-panel-order-v1',
  'mc-panel-widths-v1',
  // uiStore per-browser preferences (state/ui.ts KEYS). 2026-06-13 —
  // these were being WIPED on every boot because the allowlist
  // predated them: rail widths, collapsed state, active tab/zone,
  // filters, etc. didn't survive a refresh. Operator field report:
  // "si reduzco una columna, si la muevo… debes guardarlo en el
  // localStorage". Each must match KEYS in state/ui.ts exactly.
  'mc-active-tab',
  'mc-active-zone',
  'mc-projects-rail-mode',
  'mc-projects-rail-width',
  'mc-chat-rail-width',
  'mc-nav-filter',
  'mc-ws-tab',
  'mc-initiative-group-by-phase',
  'mc-modules-pill',
  'mc-modules-collapsed',
  // Auth (per-browser tokens)
  'meshkore-tokens-v1',
  'meshcore-token', // legacy single-cluster token; tokens-v1 supersedes
  'meshcore-last-port',
  // Comms / logging preferences
  'mc-daemon-via-tls',
  'mc-daemon-token',
  'mc-debug-stream',
  'mc-log-mode',
  'meshcore-rail-order',
]);

/** Prefix-based per-cluster keys. */
const ALLOWED_PREFIXES = [
  'mc-view-v1::',        // expanded initiatives/modules per cluster
  'mc-last-conv-v1::',   // last selected conv per cluster
  'mc-conv-meta-v1::',   // convMeta cache (daemon snapshot is source of truth;
                          // chatStore.hydrateFromSnapshot prunes stale entries
                          // every boot — kept for fast first-paint only)
];

/** Audit prefixes — drop any key starting with one of these that isn't allowed. */
const AUDIT_PREFIXES = ['mc-', 'meshkore-', 'meshcore-'];

export interface AuditReport {
  kept: string[];
  dropped: string[];
}

/** Walk localStorage; drop unknown `mc-*` / `meshkore-*` / `meshcore-*`
 *  keys. Returns the report for the boot log. Never throws. */
export function auditLocalStorage(): AuditReport {
  const kept: string[] = [];
  const dropped: string[] = [];
  let keys: string[];
  try {
    keys = Object.keys(localStorage);
  } catch {
    // Some browsers throw on localStorage access (private window).
    return { kept, dropped };
  }
  for (const key of keys) {
    const matchesAuditPrefix = AUDIT_PREFIXES.some((p) => key.startsWith(p));
    if (!matchesAuditPrefix) continue; // not ours, leave alone
    if (ALLOWED_EXACT.has(key)) {
      kept.push(key);
      continue;
    }
    if (ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
      kept.push(key);
      continue;
    }
    try {
      localStorage.removeItem(key);
      dropped.push(key);
    } catch {
      // Quota / disabled; the audit is best-effort.
    }
  }
  if (dropped.length > 0) {
    log.info('[storage-audit] dropped stale keys', { dropped, kept_count: kept.length });
  } else {
    log.debug('[storage-audit] all keys allowed', { kept_count: kept.length });
  }
  return { kept, dropped };
}
