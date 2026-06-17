/**
 * OfflinePanel — 2026-06-12 wizard rewrite, coherent with DaemonBehindPanel.
 *
 * Operator framing: "centrarlo, montarlo lo más simple posible, a modo
 * wizard. Si va automático el resto sobra. Solo si falla o no está
 * activo, mostrar las opciones de dispararlo o que el usuario lo haga."
 *
 * Flow:
 *   1. Default: centered spinner + "Watching /health on :PORT — Ns
 *      elapsed". The auto-reconnect runs in the background; when the
 *      daemon answers we hot-swap and the panel unmounts naturally.
 *   2. After STUCK_AFTER_MS, reveal "Start it myself" + "Hand it to
 *      Claude Code" inline below the spinner. The watcher keeps
 *      running — if the daemon comes back while the operator was
 *      reading the manual block, the panel still vanishes on its own.
 *   3. The two paths expand the relevant copy-paste commands in
 *      place (no new screen).
 *
 * Selection lives in `daemonStore.state.offlineSelection`. The rail
 * row stays highlighted so the operator can still hit the trash icon
 * to forget the project.
 */

import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { daemonStore, type OfflineSelection } from '~/state/daemon';
import { switchProject } from '~/components/ProjectsRailRow';
import { liveClusters } from '~/components/projects-rail/discovery';
import { daemonHttpBase } from '~/lib/transport';
import { log } from '~/lib/log';
import * as kp from '~/lib/known-projects';
import CommandBlock from '~/components/CommandBlock';
import {
  agentPrompt as buildAgentPrompt,
  cdCommandOrNull,
  startCommand as buildStartCommand,
} from '~/lib/start-command';

const WATCH_INTERVAL_MS = 2000;
const WATCH_TIMEOUT_MS = 800;
const STUCK_AFTER_MS = 15_000;

type Diagnose = 'unknown' | 'tls-missing';
type ManualMode = null | 'self' | 'agent';

export default function OfflinePanel(): JSX.Element {
  const sel = (): OfflineSelection | null => daemonStore.state.offlineSelection;
  const repoPath = createMemo<string | null>(() => {
    const s = sel();
    if (!s) return null;
    const entry = kp.list().find((p) =>
      (s.cluster_id ? p.cluster_id === s.cluster_id : !p.cluster_id && p.port === s.port),
    );
    return entry?.repo_path ?? null;
  });
  return (
    <Show when={sel()}>
      {(s) => <PanelBody sel={s()} repoPath={repoPath()} />}
    </Show>
  );
}

function PanelBody(props: { sel: OfflineSelection; repoPath: string | null }): JSX.Element {
  const [elapsedSec, setElapsedSec] = createSignal(0);
  const [diagnose, setDiagnose] = createSignal<Diagnose>('unknown');
  const [stuck, setStuck] = createSignal(false);
  const [mode, setMode] = createSignal<ManualMode>(null);

  // ── Auto-watcher. Polls /health every 2s, switches the moment it
  //    answers. Also diagnoses the "TLS missing" case (HTTP works but
  //    HTTPS doesn't). Always running — the manual options are layered
  //    ON TOP for cases where the operator wants to act directly.
  createEffect(() => {
    const port = props.sel.port;
    let cancelled = false;
    let probeTimer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    setElapsedSec(0);
    setStuck(false);
    const elapsedTimer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    const stuckTimer = setTimeout(() => setStuck(true), STUCK_AFTER_MS);

    const probe = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const r = await fetch(`${daemonHttpBase(port)}/health`, {
          signal: AbortSignal.timeout(WATCH_TIMEOUT_MS),
        });
        // A-OFFLINE-RACE-01 (V110) — re-check AFTER the await: the port
        // may have changed (sel update / reconcile effect) while the
        // fetch was in flight, and `cancelled` is only checked before
        // the loop. Without this the stale in-flight probe could fire a
        // switch to a now-wrong port.
        if (cancelled) return;
        if (r.ok) {
          log.info('[OfflinePanel] daemon answered — switching', { port });
          void switchProject(port, props.sel.key, {
            display: props.sel.display,
            cluster_id: props.sel.cluster_id,
            cluster_name: props.sel.cluster_name,
          });
          return;
        }
      } catch { /* not up yet */ }
      if (diagnose() === 'unknown' && !cancelled) {
        try {
          const r2 = await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(WATCH_TIMEOUT_MS),
          });
          if (r2.ok) {
            log.warn('[OfflinePanel] HTTP-only — TLS bundle missing', { port });
            setDiagnose('tls-missing');
          }
        } catch { /* nothing bound */ }
      }
      if (!cancelled) probeTimer = setTimeout(() => { void probe(); }, WATCH_INTERVAL_MS);
    };
    void probe();

    onCleanup(() => {
      cancelled = true;
      if (probeTimer !== null) clearTimeout(probeTimer);
      clearInterval(elapsedTimer);
      clearTimeout(stuckTimer);
    });
  });

  // Reactive port-migration reconciliation (unchanged from V86l).
  createEffect(() => {
    const cid = props.sel.cluster_id;
    if (!cid) return;
    const live = liveClusters().get(cid);
    if (!live || live.port === props.sel.port) return;
    log.info('[OfflinePanel] live discovery surfaced cluster at new port', {
      cluster_id: cid, stale: props.sel.port, live: live.port,
    });
    void switchProject(live.port, props.sel.key, {
      display: props.sel.display,
      cluster_id: props.sel.cluster_id,
      cluster_name: props.sel.cluster_name,
    });
  });

  // ── Commands ─────────────────────────────────────────────────────
  // A-STARTCMD-HELPER-01 — these now delegate to the shared
  // `~/lib/start-command` module so ReviveList / OfflinePanel / NoDaemon
  // all build the same strings.
  const target = (): { port: number; repo_path: string | null; cluster_id?: string; cluster_name?: string } => ({
    port: props.sel.port,
    repo_path: props.repoPath,
    cluster_id: props.sel.cluster_id ?? undefined,
    cluster_name: props.sel.cluster_name ?? undefined,
  });
  const cdCommand = (): string | null => cdCommandOrNull(target());
  const startCommand = (): string => buildStartCommand(target());
  const shutdownCommand = (): string =>
    `curl -s -X POST http://localhost:${props.sel.port}/shutdown -H "Authorization: Bearer $(cat .meshkore/credentials/portal-token)"`;
  const syncCommand = (): string => [
    'cp ~/Documents/Prj/asimovia/meshkore/.meshkore/scripts/daemon.py .meshkore/scripts/daemon.py',
    'cp -R ~/Documents/Prj/asimovia/meshkore/.meshkore/scripts/tls .meshkore/scripts/tls',
  ].join(' && \\\n');

  const agentPrompt = (): string => buildAgentPrompt(target());

  const cluster = (): string =>
    props.sel.cluster_name ?? props.sel.display ?? `port ${props.sel.port}`;

  return (
    <section class="h-full flex items-center justify-center px-6 py-12 overflow-auto">
      <div class="max-w-xl w-full">
        <header class="mb-6">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-500/10 border border-gray-500/40 text-gray-300 text-xs font-medium mb-4">
            <span class="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse-soft" />
            <Show when={diagnose() === 'tls-missing'} fallback="Daemon offline">TLS bundle missing</Show>
          </div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight mb-2">
            <Show
              when={diagnose() === 'tls-missing'}
              fallback={<>Esperando a <span class="font-mono text-gray-100">{cluster()}</span></>}
            >
              Reparando <span class="font-mono text-gray-100">{cluster()}</span>
            </Show>
          </h1>
          <p class="text-gray-400 leading-relaxed text-sm">
            <Show
              when={diagnose() === 'tls-missing'}
              fallback={<>
                The daemon on <span class="font-mono text-gray-300">:{props.sel.port}</span> isn't
                responding. The cockpit reconnects the moment <code class="font-mono text-gray-300">/health</code> answers.
              </>}
            >
              Something is bound to <span class="font-mono text-gray-300">:{props.sel.port}</span>{' '}
              but it's serving plain HTTP. The cockpit speaks HTTPS only — sync the TLS bundle and restart.
            </Show>
          </p>
        </header>

        <section class="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
          <div class="flex items-center gap-3 text-gray-200 text-sm">
            <span class="inline-block w-4 h-4 rounded-full border-2 border-gray-500/40 border-t-gray-200 animate-spin" />
            <span>
              Watching <code class="font-mono text-gray-300">/health</code> on{' '}
              <span class="font-mono text-gray-300">:{props.sel.port}</span> — {elapsedSec()}s elapsed
            </span>
          </div>

          <Show when={stuck()}>
            <div class="mt-5 pt-5 border-t border-gray-800 space-y-3">
              <p class="text-gray-400 text-xs leading-relaxed">
                Looks like the daemon isn't coming back on its own. Pick one of these — the watcher
                keeps running, so the panel vanishes as soon as <code class="font-mono">/health</code> answers.
              </p>
              <div class="flex gap-2">
                <ModeButton active={mode() === 'self'} onClick={() => setMode(mode() === 'self' ? null : 'self')}>
                  I'll start it myself
                </ModeButton>
                <ModeButton active={mode() === 'agent'} onClick={() => setMode(mode() === 'agent' ? null : 'agent')}>
                  Hand it to my Claude Code
                </ModeButton>
              </div>

              <Show when={mode() === 'self'}>
                <ManualSteps
                  tlsMissing={diagnose() === 'tls-missing'}
                  cdCommand={cdCommand()}
                  startCommand={startCommand()}
                  shutdownCommand={shutdownCommand()}
                  syncCommand={syncCommand()}
                />
              </Show>

              <Show when={mode() === 'agent'}>
                <CommandBlock multiline label="Paste this into Claude Code / Cursor / Cline">
                  {agentPrompt()}
                </CommandBlock>
              </Show>
            </div>
          </Show>
        </section>

        <p class="text-gray-500 text-[11px] leading-relaxed mt-4 text-center">
          Project gone for good? Use the trash icon on the rail row to forget it.
        </p>
      </div>
    </section>
  );
}

function ModeButton(props: { active: boolean; onClick: () => void; children: JSX.Element }): JSX.Element {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`flex-1 font-mono text-xs uppercase tracking-wider px-3 py-2 rounded-lg border transition-colors ${
        props.active
          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-100'
          : 'bg-gray-800/40 border-gray-700 text-gray-300 hover:bg-gray-800/80 hover:border-gray-600'
      }`}
    >
      {props.children}
    </button>
  );
}

function ManualSteps(props: {
  tlsMissing: boolean;
  cdCommand: string | null;
  startCommand: string;
  shutdownCommand: string;
  syncCommand: string;
}): JSX.Element {
  const steps = (): Array<{ label: string; code: string | null }> => {
    const out: Array<{ label: string; code: string | null }> = [];
    out.push({ label: 'Open a terminal in the project folder', code: props.cdCommand });
    if (props.tlsMissing) {
      out.push({ label: 'Shut down the half-broken daemon', code: props.shutdownCommand });
      out.push({ label: 'Sync daemon.py + TLS bundle', code: props.syncCommand });
    }
    out.push({ label: props.tlsMissing ? 'Start the daemon again' : 'Start the daemon', code: props.startCommand });
    return out;
  };
  return (
    <ol class="space-y-2">
      <For each={steps()}>
        {(s, i) => (
          <li class="flex gap-3 items-start">
            <span class="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-800 text-[10px] font-mono text-gray-400 mt-1">
              {i() + 1}
            </span>
            <div class="flex-1 min-w-0">
              <p class="text-gray-200 text-xs mb-1">{s.label}</p>
              <Show when={s.code}>
                <CommandBlock>{s.code!}</CommandBlock>
              </Show>
            </div>
          </li>
        )}
      </For>
    </ol>
  );
}
