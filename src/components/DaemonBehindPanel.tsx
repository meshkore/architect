/**
 * DaemonBehindPanel — full-body block when the active daemon's version
 * is older than EXPECTED_DAEMON_VERSION but still meets MIN (it works,
 * but it's behind what this cockpit ships against).
 *
 * Operator framing 2026-06-12: "todo lo que respecta al daemon
 * bloquea el proyecto y por lo tanto todos sus mensajes van al
 * centro… el auto-update lanza una señal al daemon para que se
 * actualice, y si no, mostrar las instrucciones a mano".
 *
 * UX:
 *   - mount → if `autoUpdateEnabled` is true, fire `/self-update`
 *     immediately and show a spinner "Actualizando Ikamiro a py-X.Y.Z…"
 *   - daemon re-execs, WS drops, daemon-port-recovery (shipped earlier)
 *     reattaches once it comes back up. When `daemonStore.state.version`
 *     reaches EXPECTED, this panel unmounts naturally (gate flips false).
 *   - if `autoUpdateEnabled` is false → skip the auto-fire and go
 *     straight to manual instructions.
 *   - if auto-update fails OR takes longer than STUCK_AFTER_MS → reveal
 *     the manual fallback inline (paste-into-terminal command).
 *
 * The ProjectsRail (column outside <main>) stays clickable so the
 * operator can switch to a different project while this one updates.
 */

import { Show, createSignal, onMount, type JSX } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { EXPECTED_DAEMON_VERSION } from '~/lib/version';
import { log } from '~/lib/log';

const STUCK_AFTER_MS = 30_000;

export default function DaemonBehindPanel(): JSX.Element {
  const cluster = (): string =>
    daemonStore.state.health?.cluster_name
    ?? daemonStore.state.health?.identity
    ?? 'this project';
  const current = (): string => daemonStore.state.version?.raw ?? '?';
  const autoEnabled = (): boolean => daemonStore.state.autoUpdateEnabled;

  const [phase, setPhase] = createSignal<'idle' | 'updating' | 'failed' | 'manual'>('idle');
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [showManual, setShowManual] = createSignal(false);

  const fireUpdate = async (): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c) {
      setPhase('failed');
      setErrorMsg('No daemon client attached');
      return;
    }
    setPhase('updating');
    setErrorMsg(null);
    setShowManual(false);
    log.info('daemon-behind: firing /self-update', { cluster: cluster(), from: current() });
    // Arm the "stuck" timer BEFORE the request resolves. Without this,
    // a hung daemon (e.g. the request thread is blocked on a stuck
    // chat session) keeps the panel spinning forever — selfUpdate
    // never resolves so the post-await setTimeout never fires.
    const stuckTimer = setTimeout(() => setShowManual(true), STUCK_AFTER_MS);
    try {
      const r = await c.selfUpdate({});
      // status 0 = transport closed mid-update (the daemon killed itself
      // to re-exec). That's the SUCCESS shape — wait for WS to come back.
      // Any other !ok is a real error.
      if (!r.ok && r.status !== 0) {
        clearTimeout(stuckTimer);
        setPhase('failed');
        const detail = r.status === 409
          ? 'chat turn in progress — cancel the active conv before retrying'
          : (r.error ?? r.body ?? 'unknown');
        setErrorMsg(`Update returned ${r.status}: ${detail}`);
        return;
      }
      // Success path: daemon re-execs, WS drops, port-recovery
      // reattaches. The panel unmounts when version reaches EXPECTED.
      // Keep the stuck timer armed in case the re-exec hangs after the
      // request returned ok.
    } catch (e) {
      clearTimeout(stuckTimer);
      setPhase('failed');
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  onMount(() => {
    if (autoEnabled()) {
      void fireUpdate();
    } else {
      // Auto-update disabled — go straight to manual instructions.
      setPhase('manual');
    }
  });

  return (
    <section class="h-full flex items-center justify-center px-6 py-12 overflow-auto">
      <div class="max-w-xl w-full">
        <header class="mb-6">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/40 text-amber-300 text-xs font-medium mb-4">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
            <Show when={phase() === 'updating'} fallback="Daemon update available">Updating daemon</Show>
          </div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight mb-2">
            <Show
              when={phase() === 'updating'}
              fallback={<>Update <span class="font-mono text-amber-200">{cluster()}</span> to continue</>}
            >
              Actualizando <span class="font-mono text-amber-200">{cluster()}</span>…
            </Show>
          </h1>
          <p class="text-gray-400 leading-relaxed text-sm">
            <Show when={phase() === 'updating'} fallback={<>
              Daemon is running <span class="font-mono text-amber-300">{current()}</span>; this cockpit
              expects <span class="font-mono text-amber-300">{EXPECTED_DAEMON_VERSION}</span>.
              The auto-update watcher hasn't fired on its own — we'll trigger it manually.
            </>}>
              The daemon downloads the new script, hash-checks it, and re-execs in place. The cockpit will
              re-attach automatically when it comes back up.
            </Show>
          </p>
        </header>

        <Show when={phase() === 'updating'}>
          <section class="bg-gray-900/50 border border-amber-500/30 rounded-2xl p-6">
            <div class="flex items-center gap-3 text-amber-100">
              <span class="inline-block w-4 h-4 rounded-full border-2 border-amber-400/40 border-t-amber-300 animate-spin" />
              <span class="text-sm">
                {current()} → <span class="font-mono text-amber-200">{EXPECTED_DAEMON_VERSION}</span>
              </span>
            </div>
            <Show when={showManual()}>
              <div class="mt-5 pt-5 border-t border-gray-800">
                <p class="text-gray-400 text-xs leading-relaxed mb-3">
                  This is taking longer than usual. If you'd rather take over manually, run the
                  command below in the cluster's repo root.
                </p>
                <ManualBlock />
              </div>
            </Show>
          </section>
        </Show>

        <Show when={phase() === 'failed'}>
          <section class="bg-gray-900/50 border border-red-500/30 rounded-2xl p-6">
            <p class="text-red-200 text-sm mb-3">
              <span class="font-mono text-red-300">Auto-update failed.</span> {errorMsg()}
            </p>
            <div class="flex gap-2 mb-5">
              <button
                type="button"
                onClick={() => { void fireUpdate(); }}
                class="font-mono text-xs uppercase tracking-wider px-3 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-100 transition-colors"
              >
                Retry auto
              </button>
              <button
                type="button"
                onClick={() => setPhase('manual')}
                class="font-mono text-xs uppercase tracking-wider px-3 py-2 rounded-lg bg-gray-800/60 hover:bg-gray-800 border border-gray-700 text-gray-200 transition-colors"
              >
                Switch to manual
              </button>
            </div>
            <ManualBlock />
          </section>
        </Show>

        <Show when={phase() === 'manual'}>
          <section class="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
            <p class="text-gray-300 text-sm leading-relaxed mb-4">
              <Show when={!autoEnabled()} fallback="Auto-update is enabled, but the watcher needs a manual nudge. Run this in the cluster's repo root:">
                Auto-update is <span class="font-mono text-gray-400">disabled</span> in this cluster's <code class="font-mono text-amber-300">cluster.yaml</code>.
                To update manually, run this in the cluster's repo root:
              </Show>
            </p>
            <ManualBlock />
            <p class="text-gray-500 text-[11px] leading-relaxed mt-4">
              The cockpit will re-attach automatically once the daemon restarts on the new
              version — no reload needed (daemon-port-recovery, shipped 2026-06-12).
            </p>
          </section>
        </Show>

        <p class="text-gray-500 text-[11px] leading-relaxed mt-4 text-center">
          The projects rail on the left stays clickable — switch to another cluster while this one updates.
        </p>
      </div>
    </section>
  );
}

/** Shared "paste this into your terminal" block — same shape across
 *  the three sub-states (updating-stuck, failed, manual). */
function ManualBlock(): JSX.Element {
  const cmd = 'curl -fsSL https://meshkore.com/reference/cluster/scripts/daemon.py -o .meshkore/scripts/daemon.py && pkill -f \'\\.meshkore/scripts/daemon\\.py\' || true';
  const [copied, setCopied] = createSignal(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard denied */ }
  };
  return (
    <div class="rounded-lg border border-gray-800 bg-gray-950 p-3 font-mono text-[11px] text-gray-200 overflow-x-auto">
      <div class="flex items-start justify-between gap-2">
        <code class="whitespace-pre-wrap break-all leading-snug select-all">{cmd}</code>
        <button
          type="button"
          onClick={() => { void copy(); }}
          class="flex-shrink-0 text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-gray-700 hover:border-gray-600 text-gray-400 hover:text-gray-200 transition-colors"
        >
          {copied() ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  );
}
