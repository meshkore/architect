/**
 * lib/daemon — typed HTTP client over the meshcore daemon REST surface.
 *
 * The cockpit hits the daemon for every state read / mutation. This
 * package is the single source of truth for the request shapes and
 * response types. Higher-level state stores wrap it; components never
 * call fetch directly.
 *
 * Usage:
 *   const client = new DaemonClient(localTransport(5570, token));
 *   const h = await client.health();
 *   if (h.ok) log.info('daemon ready', h.data.identity, h.daemonVersion);
 *
 * All JSON methods return `Result<T>` (a discriminated union):
 *   - { ok: true, data, status, daemonVersion? }   on 2xx
 *   - { ok: false, status, body }                  on non-2xx or network error
 *
 * No exceptions thrown for ordinary HTTP errors — callers branch on
 * `result.ok`. Every method accepts an AbortSignal so the operator can
 * cancel an in-flight request when navigating away or switching cluster.
 *
 * ─── Layout ────────────────────────────────────────────────────────────
 *
 *   result.ts      Result<T> / TextResult / DaemonError
 *   core.ts        DaemonCore — the ONE fetch pipeline (headers, timeout,
 *                  401 self-heal, version fan-out) + the two sanctioned
 *                  client→store back-channel registrations
 *   types/         wire shapes by domain (system, config, chat, team,
 *                  runs, roadmap)
 *   methods/       one class per domain, chained by inheritance so
 *                  `DaemonClient` presents ONE flat method namespace:
 *                  core → system → config → roadmap → chat → team → runs
 *
 * `~/lib/daemon-client` re-exports this package verbatim; both specifiers
 * resolve to the same symbols.
 */

import { RunsMethods } from './methods/runs';

/** The cockpit's daemon handle. Every method is inherited from the
 *  domain classes; this type is the public surface consumers see. */
export class DaemonClient extends RunsMethods {}

export { DaemonCore, rewriteMeshkoreStaticPath, setDaemonVersionListener, setReauthHandler } from './core';
export type { HttpMethod } from './core';
export { DaemonError } from './result';
export type { Result, TextResult } from './result';
export type * from './types';
