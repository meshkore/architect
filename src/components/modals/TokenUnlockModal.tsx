/**
 * TokenUnlockModal (M6.2) — per-cluster paste prompt for v78g.
 *
 * Two entry points:
 *   • First connect / unauthorized — host page calls openTokenUnlockModal().
 *   • Mid-session 401 (e.g. /chat/dispatch refused) — onTokenRejected
 *     re-fires it with a `reason` banner so the operator knows what
 *     was rejected.
 *
 * Cancel does NOT disconnect. The project remains visible but read-only
 * until the operator pastes a working token; the v78g per-cluster map
 * keeps prior clusters' tokens intact while this one stays empty.
 *
 * Validates with GET /credentials before writing — a wrong token clears
 * the input and shows the daemon's reason. Saves through lib/tokens
 * (per-cluster). The legacy single-token slot is never written here.
 */

import { Show, createSignal, type JSX } from 'solid-js';
import { DaemonClient } from '~/lib/daemon-client';
import { localTransport } from '~/lib/transport';
import { clusterTokenKey, saveTokenForCluster, type ClusterIdentity } from '~/lib/tokens';
import { log } from '~/lib/log';

export interface TokenUnlockOpts {
  /** Cluster being unlocked. `port` is required so we can build a probe client. */
  project: ClusterIdentity & { port: number; cluster_name?: string | null };
  /** Why we re-opened (e.g. "Token rejected by /chat/dispatch"). */
  reason?: string;
  /** Fired once the operator pasted a token that /credentials accepted. */
  onUnlocked: (token: string) => void;
  /** Fired if the operator dismissed without unlocking. */
  onCancel?: () => void;
}

const [opts, setOpts] = createSignal<TokenUnlockOpts | null>(null);
const [value, setValue] = createSignal('');
const [error, setError] = createSignal('');
const [busy, setBusy] = createSignal(false);

export function openTokenUnlockModal(o: TokenUnlockOpts): void {
  setValue('');
  setError('');
  setBusy(false);
  setOpts(o);
}

/** Read the pending token prompt (for the Cockpit centre-zone gate). */
export function tokenPromptOpts(): TokenUnlockOpts | null {
  return opts();
}

/** Drop any pending token prompt — called on cluster switch so a stale
 *  prompt for project A doesn't linger over project B. */
export function clearTokenPrompt(): void {
  setOpts(null);
}

function dismiss(): void {
  const cur = opts();
  setOpts(null);
  cur?.onCancel?.();
}

async function validate(token: string, port: number): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const probe = new DaemonClient(localTransport(port, token));
    const r = await probe.credentials();
    if (r.ok) return { ok: true };
    if (r.status === 401 || r.status === 403) return { ok: false, message: 'Daemon rejected the token. Check .meshkore/credentials/portal-token and paste again.' };
    return { ok: false, message: `Daemon returned HTTP ${r.status}.` };
  } catch (e) {
    log.warn('TokenUnlockModal validate failed', e);
    return { ok: false, message: 'Could not reach the daemon to validate the token.' };
  }
}

async function submit(): Promise<void> {
  const cur = opts();
  if (!cur || busy()) return;
  const t = value().trim();
  if (!t) { setError('Paste a token first.'); return; }
  setBusy(true);
  setError('');
  const r = await validate(t, cur.project.port);
  setBusy(false);
  if (!r.ok) {
    setError(r.message);
    setValue('');
    return;
  }
  saveTokenForCluster(clusterTokenKey(cur.project), t);
  setOpts(null);
  cur.onUnlocked(t);
}

/**
 * TokenUnlockPanel — rendered INSIDE the Cockpit `<main>` (the centre project
 * zone), NOT as a full-screen overlay, so the left projects rail is never
 * hidden and the operator can switch to any of their other projects while a
 * token prompt is pending. `absolute inset-0` confines it to the centre; the
 * rail is a sibling of `<main>`, untouched. (2026-06-24 — moved off the
 * root ModalHost per "project dialogs occupy only the project space".)
 *
 * Local clusters auto-unlock (daemon GET /auth/local-token), so this is
 * effectively the CLOUD-daemon / remote case: connecting from a device with
 * no local daemon, where a real shared token is needed.
 */
export function TokenUnlockPanel(): JSX.Element {
  return (
    <Show when={opts()} keyed>
      {(o) => (
        <div class="absolute inset-0 z-50 flex items-center justify-center p-6 bg-canvas/80 backdrop-blur-sm overflow-auto">
          <div class="max-w-lg w-full bg-gray-900/90 border border-gray-700/60 rounded-2xl shadow-2xl p-6">
            <div class="flex items-start justify-between mb-1">
              <h2 class="text-lg font-semibold tracking-tight">Unlock cluster</h2>
              <button
                type="button"
                onClick={dismiss}
                class="text-gray-500 hover:text-gray-200 text-lg leading-none px-1"
                aria-label="Close"
              >×</button>
            </div>
            <p class="text-xs font-mono text-gray-400 mb-4">
              {o.project.cluster_name ?? o.project.cluster_id ?? `localhost:${o.project.port}`}
            </p>
            <div class="space-y-3">
              <Show when={o.reason}>
                <div class="px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs leading-relaxed">
                  {o.reason}
                </div>
              </Show>
              <p class="text-sm leading-relaxed text-gray-300">
                Paste the bearer token for{' '}
                <span class="font-mono text-emerald-300">
                  {o.project.cluster_id ?? `port:${o.project.port}`}
                </span>
                . It lives in <span class="font-mono text-emerald-300">.meshkore/credentials/portal-token</span> and stays in this browser (per-cluster).
              </p>
              <input
                type="password"
                value={value()}
                onInput={(e) => { setValue(e.currentTarget.value); if (error()) setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
                placeholder="Bearer token"
                autofocus
                disabled={busy()}
                class={`w-full bg-gray-950 border rounded-md px-3 py-2 text-[13px] font-mono focus:outline-none disabled:opacity-60 ${
                  error()
                    ? 'border-red-500/60 focus:border-red-400'
                    : 'border-gray-800 focus:border-emerald-500/50'
                }`}
              />
              <Show when={error()}>
                <p class="text-xs text-red-400 leading-snug">{error()}</p>
              </Show>
              <div class="flex items-center justify-between pt-1">
                <p class="text-[11px] text-gray-500 leading-relaxed max-w-[60%]">
                  Cancel keeps the project visible but read-only — your other clusters stay authenticated.
                </p>
                <div class="flex gap-2">
                  <button
                    type="button"
                    onClick={dismiss}
                    class="px-3 py-1.5 rounded-md text-sm text-gray-300 border border-gray-700/60 hover:border-gray-500/60 hover:text-gray-100"
                  >Cancel</button>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={busy()}
                    class="px-3.5 py-1.5 rounded-md text-sm font-medium bg-emerald-500/85 hover:bg-emerald-500 text-gray-950 disabled:opacity-60"
                  >{busy() ? 'Validating…' : 'Save & unlock'}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
