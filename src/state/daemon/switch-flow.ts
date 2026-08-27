/**
 * state/daemon/switch-flow.ts — "make project X the active one".
 *
 * AX15 / ST-4: extracted from the 154-line `switchToPortDetailed` that
 * lived in `state/daemon.ts`. Same flow, now four named steps —
 * reuse → probe → resolve token → attach — with the daemon store
 * passed in as `SwitchDeps` so this module never imports it back.
 *
 * Everything here is about ONE port and ONE project id. The daemon is
 * centralized (FC-2): one process serves many projects on one port and
 * the `X-MeshKore-Project` header selects which, so the project id —
 * not the port — identifies an instance.
 */

import { DaemonClient, type HealthResponse } from '~/lib/daemon-client';
import { daemonHttpBase, localTransport } from '~/lib/transport';
import { clusterTokenKey, tokenForCluster, saveTokenForCluster } from '~/lib/tokens';
import { verifyDaemonIdentity } from '~/lib/auth';
import { log } from '~/lib/log';

/**
 * `cancelled` = the operator abandoned the token prompt (or switched
 * away from it). It is NOT a failure to surface as an offline row.
 * `cluster-mismatch` = the daemon answered with a DIFFERENT project
 * than the one we asked for (AX10 / OB-F8).
 */
export type SwitchOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'no-daemon' | 'tls' | 'unknown' | 'cancelled' | 'cluster-mismatch';
      detail?: string;
    };

/** What the daemon store asks a token-prompt UI to do. Structural, so
 *  the modal component can satisfy it without this module knowing it. */
export interface TokenPromptRequest {
  project: { port: number; cluster_id: string | null; cluster_name: string | null };
  reason?: string;
  /** Operator pasted a token that the daemon accepted. */
  onUnlocked: (token: string) => void;
  /** Operator explicitly dismissed the prompt (× / Cancel). */
  onCancel?: () => void;
  /** The prompt was dropped without an operator decision — they moved
   *  to another project. Must settle the switch promise but must NOT
   *  attach anything (AX9 / OB-F3). */
  onDismissed?: () => void;
}

export interface TokenPromptPort {
  open(req: TokenPromptRequest): void;
  clear(): void;
}

export interface SwitchDeps {
  /** An already-attached instance for this project (or port), if any. */
  findExisting(port: number, projectId?: string): { key: string } | null;
  /** Flip the pointer to an existing instance (revives a dead socket). */
  activate(key: string): void;
  /** Token of the currently-active client — the legacy last-resort fallback. */
  currentToken(): string;
  attach(client: DaemonClient, health: HealthResponse): void;
  fetchLocalToken(port: number): Promise<string | null>;
  tokenPrompt: TokenPromptPort;
}

const PROBE_TIMEOUT_MS = 5000;

/** Step 1 — /health for the requested project. Bounded: an unbounded
 *  probe (TLS stall, saturated pool) left the switch promise pending
 *  forever and the row permanently un-clickable. */
async function probeHealth(
  port: number,
  projectId?: string,
): Promise<{ ok: true; health: HealthResponse } | { ok: false; outcome: SwitchOutcome }> {
  const probeUrl = `${daemonHttpBase(port)}/health`;
  try {
    const r = await fetch(probeUrl, {
      headers: projectId ? { 'X-MeshKore-Project': projectId } : {},
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!r.ok) {
      log.warn('switchToPort probe failed', { port, status: r.status });
      return { ok: false, outcome: { ok: false, reason: 'no-daemon', detail: `HTTP ${r.status}` } };
    }
    const health = (await r.json()) as HealthResponse;
    // AX10 (OB-F8) — a daemon older than DC-4 ignores X-MeshKore-Project and
    // answers for its OWN default project. Attaching that under the row the
    // operator clicked silently binds the wrong cluster. Only enforceable when
    // we actually asked for a project: a bare /health legitimately reports the
    // shared daemon's home cluster.
    if (projectId && health.cluster_id && health.cluster_id !== projectId) {
      log.error('switchToPort REFUSED — daemon answered for a different project', {
        port, requested: projectId, got: health.cluster_id,
      });
      return {
        ok: false,
        outcome: {
          ok: false,
          reason: 'cluster-mismatch',
          detail: `daemon on :${port} answered for "${health.cluster_id}", not "${projectId}" — it is older than the per-project header (DC-4)`,
        },
      };
    }
    return { ok: true, health };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn('switchToPort fetch threw', { port, error: msg });
    // ERR_SSL_PROTOCOL_ERROR / ERR_CERT_* surface as a plain TypeError in
    // fetch — sniff the message to tell TLS apart from a closed port.
    const isTls = /ssl|tls|cert/i.test(msg);
    return { ok: false, outcome: { ok: false, reason: isTls ? 'tls' : 'no-daemon', detail: msg } };
  }
}

/**
 * Switch the cockpit to the project served at `port`. Returns as soon
 * as the instance is attached (or the attempt has definitively failed);
 * the token-prompt branch resolves later, when the operator decides.
 */
export async function runSwitchToPort(
  deps: SwitchDeps,
  port: number,
  projectId?: string,
): Promise<SwitchOutcome> {
  log.info('switchToPort requested', { port, projectId });

  // ── Step 0 — already attached? Pointer swap, no network. ──────────
  const existing = deps.findExisting(port, projectId);
  if (existing) {
    deps.activate(existing.key);
    return { ok: true };
  }

  // ── Step 1 — probe. ───────────────────────────────────────────────
  const probe = await probeHealth(port, projectId);
  if (!probe.ok) return probe.outcome;
  const { health } = probe;

  // ── Step 2 — resolve a token for this cluster. ────────────────────
  const tokenKey = clusterTokenKey({ cluster_id: health.cluster_id ?? null, port });
  const token = tokenForCluster(tokenKey) || deps.currentToken();

  // D-TLS-02 — challenge-response identity check before we attach. A
  // mismatch suggests an impersonated endpoint (DNS poisoned + valid TLS
  // cert); we refuse rather than hand it a bearer token.
  const verify = await verifyDaemonIdentity(daemonHttpBase(port), token, health.features ?? []);

  if (verify.kind === 'no-token') {
    // LOCAL auto-unlock (py-1.27.6) — a token for your OWN local daemon is
    // pointless friction; the daemon hands it to the same-origin cockpit over
    // loopback. Only a remote/cloud daemon reaches the prompt below.
    const localTok = await deps.fetchLocalToken(port);
    if (localTok) {
      saveTokenForCluster(tokenKey, localTok);
      log.info('switchToPort — auto-unlocked local cluster', { port, cluster: health.cluster_id });
      return runSwitchToPort(deps, port, projectId);
    }
    log.info('switchToPort — no token for cluster, opening unlock dialog', { port, cluster: health.cluster_id });
    return new Promise<SwitchOutcome>((resolve) => {
      deps.tokenPrompt.open({
        project: {
          port,
          cluster_id: health.cluster_id ?? null,
          cluster_name: health.cluster_name ?? null,
        },
        onUnlocked: () => {
          void runSwitchToPort(deps, port, projectId).then(resolve);
        },
        onCancel: () => {
          // Explicit dismissal — attach with an empty token so the project is
          // at least visible (read-only); they can unlock later from the rail.
          deps.attach(new DaemonClient(localTransport(port, '')), health);
          resolve({ ok: true });
        },
        onDismissed: () => {
          // AX9 (OB-F3) — the prompt was dropped because the operator moved to
          // ANOTHER project. Settle so the row's in-flight guard clears (it
          // used to hold forever, making the row un-clickable until reload),
          // but do NOT attach: that would yank focus back to the project they
          // just left.
          resolve({ ok: false, reason: 'cancelled' });
        },
      });
    });
  }

  if (verify.kind === 'mismatch') {
    // FC-2 — a mismatch on a LOCAL daemon is almost always a STALE token (the
    // daemon re-minted, or a different daemon held this port before), NOT a
    // real MITM. Re-fetch and retry ONCE; refuse only if the fresh token is
    // identical (genuinely wrong) or unavailable (remote daemon / opt-out).
    const freshTok = await deps.fetchLocalToken(port);
    if (freshTok && freshTok !== token) {
      saveTokenForCluster(tokenKey, freshTok);
      log.info('switchToPort — stale token replaced via local auto-unlock; retrying', { port, cluster: health.cluster_id });
      return runSwitchToPort(deps, port, projectId);
    }
    log.error('switchToPort REFUSED — auth challenge failed (possible MITM)', { port, cluster: health.cluster_id });
    deps.tokenPrompt.open({
      project: {
        port,
        cluster_id: health.cluster_id ?? null,
        cluster_name: health.cluster_name ?? null,
      },
      reason:
        'Auth challenge failed — the daemon at ' +
        `https://daemon.meshkore.com:${port} couldn't prove ownership of the stored ` +
        'token. Likely causes: stale local token, or someone impersonating the daemon on ' +
        'this network. Paste a fresh token from .meshkore/credentials/portal-token, ' +
        'or move to a trusted network.',
      onUnlocked: () => { void runSwitchToPort(deps, port, projectId); },
    });
    return { ok: false, reason: 'unknown', detail: 'auth mismatch' };
  }

  // ── Step 3 — attach. ──────────────────────────────────────────────
  // FC-1/FC-2 — carry the project id so the daemon routes this client's
  // requests to the right ProjectContext.
  const client = new DaemonClient(
    localTransport(port, token, projectId ?? health.cluster_id ?? undefined),
  );
  deps.attach(client, health);
  log.info('switchToPort attached', { port, cluster_id: health.cluster_id ?? null, identity: verify.kind });
  return { ok: true };
}
