/**
 * DaemonOutdatedPanel — V97. Full-area mandatory block when the
 * active project's daemon is below MIN_DAEMON_VERSION.
 *
 * Replaces the V47 floating modal. Operator's requirement:
 *   "esa ventana no se debería poder cerrar, tiene que quedarse ahí
 *    sí o sí. Todo el contenido del proyecto no tiene sentido, todo
 *    el foco hay que ponerlo ahí. Incluso los módulos tampoco se
 *    deberían ver. Si el usuario quiere seguir trabajando en otro
 *    proyecto, clica en otro proyecto y sigue trabajando."
 *
 * Design:
 *  - Mounted by Cockpit when `daemonStore.state.outdated` is true,
 *    replacing the cockpit's normal main area. ProjectsRail (left)
 *    stays clickable — switching projects is the only "escape".
 *  - Header + version delta + three update paths (auto / agent / manual).
 *  - Continuous `recheckHealth()` poll every 5 s with a live "watching"
 *    indicator. The operator never has to click "I've updated";
 *    when the new daemon comes up, the panel unmounts on its own
 *    because state.outdated flips false.
 *  - No close, no dismiss, no Escape handler.
 */

import { JSX, Show, createSignal, onCleanup, onMount, createMemo } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { activeProject } from '~/state/projects';
import { MIN_DAEMON_VERSION } from '~/lib/version';
import { ChoiceView } from './modals/daemon-outdated/ChoiceView';
import { AgentView, AGENT_PROMPT } from './modals/daemon-outdated/AgentView';
import { ManualView, SHELL_CMD } from './modals/daemon-outdated/ManualView';
import { runningVersion } from './modals/daemon-outdated/Header';
import { openAutoUpdateFlow } from './modals/AutoUpdateFlow';
import { log } from '~/lib/log';

type View = 'choice' | 'agent' | 'manual';

const POLL_INTERVAL_MS = 5000;

function clusterLabelText(): string {
  const p = activeProject();
  return p?.cluster_name ?? p?.base ?? 'this project';
}

export default function DaemonOutdatedPanel(): JSX.Element {
  const [view, setView] = createSignal<View>('choice');
  const [lastCheckAt, setLastCheckAt] = createSignal<number | null>(null);
  const [checking, setChecking] = createSignal(false);
  const [checkError, setCheckError] = createSignal<string | null>(null);
  // Force the wallclock to re-render the "Ns ago" label every second.
  const [nowMs, setNowMs] = createSignal(Date.now());

  const elapsedLabel = createMemo<string>(() => {
    const t = lastCheckAt();
    if (!t) return 'about to check…';
    const ms = nowMs() - t;
    if (ms < 1500) return 'just now';
    const secs = Math.floor(ms / 1000);
    return secs + 's ago';
  });

  const poll = async (): Promise<void> => {
    if (checking()) return;
    setChecking(true);
    setCheckError(null);
    try {
      // recheckHealth re-reads /health on the active instance and
      // flips state.outdated/version reactively. When it returns
      // true, the parent `<Show when={outdated}>` in Cockpit hides
      // us automatically — no need to manage open/close locally.
      const ok = await daemonStore.recheckHealth();
      if (!ok) {
        setCheckError(
          'Still on ' + runningVersion() + ' — make sure the old process was killed before the new one started.',
        );
      }
    } catch (err) {
      log.warn('[V97] outdated panel recheck threw', err);
      setCheckError('Recheck failed — see console.');
    } finally {
      setLastCheckAt(Date.now());
      setChecking(false);
    }
  };

  onMount(() => {
    // Fire an immediate check on mount so the operator doesn't sit
    // waiting 5 s for the first poll.
    void poll();
    const intv = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    onCleanup(() => { clearInterval(intv); clearInterval(tick); });
  });

  const triggerAutoUpdate = (): void => { openAutoUpdateFlow(); };

  return (
    <section class="flex-1 flex flex-col min-h-0 overflow-y-auto bg-canvas">
      <div class="max-w-3xl mx-auto px-6 py-10 w-full">
        {/* Header — what's happening, why we're blocking */}
        <div class="flex items-center gap-3 mb-1">
          <div class="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" width="18" height="18">
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div class="min-w-0">
            <h1 class="text-lg font-semibold text-gray-100 truncate">
              {clusterLabelText()}'s daemon needs an update
            </h1>
            <p class="text-[12px] text-gray-500 font-mono">
              daemon <span class="text-amber-300">{runningVersion()}</span>
              {' '}· cockpit needs <span class="text-emerald-300">{MIN_DAEMON_VERSION}</span> or newer
            </p>
          </div>
        </div>
        <p class="text-[12px] text-gray-400 mt-3 leading-relaxed">
          This project is paused while the local daemon is out of date — the cockpit can't talk to it
          safely. Pick an update path below. <strong class="text-gray-200">Other projects keep working
          normally</strong>: click any row in the left rail to switch.
        </p>

        {/* Live "watching" indicator — the panel auto-polls every 5 s */}
        <div class="mt-5 mb-6 px-3 py-2.5 rounded-md border border-cyan-500/30 bg-cyan-500/5 flex items-center gap-3 text-[12px]">
          <span class="inline-flex items-center gap-0.5 flex-shrink-0" aria-hidden="true">
            <span class={`w-1.5 h-1.5 rounded-full ${checking() ? 'bg-cyan-300 animate-pulse-soft' : 'bg-cyan-500/60'}`} />
            <span class={`w-1.5 h-1.5 rounded-full ${checking() ? 'bg-cyan-300 animate-pulse-soft [animation-delay:150ms]' : 'bg-cyan-500/40'}`} />
            <span class={`w-1.5 h-1.5 rounded-full ${checking() ? 'bg-cyan-300 animate-pulse-soft [animation-delay:300ms]' : 'bg-cyan-500/30'}`} />
          </span>
          <span class="flex-1 min-w-0">
            <span class="text-cyan-200 font-medium">Watching for the new daemon</span>
            <span class="text-gray-500"> · checking every {POLL_INTERVAL_MS / 1000}s · last check {elapsedLabel()}</span>
          </span>
          <button
            type="button"
            disabled={checking()}
            onClick={() => { void poll(); }}
            class="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-cyan-500/40 hover:border-cyan-500/70 text-cyan-200 hover:text-cyan-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            title="Force an immediate /health probe — the auto-poll runs every 5 s anyway"
          >
            {checking() ? 'checking…' : 'check now'}
          </button>
        </div>
        <Show when={checkError()}>
          <p class="-mt-3 mb-4 text-[11px] text-amber-300">{checkError()}</p>
        </Show>

        {/* The three update paths — same content as the V47 modal */}
        <div class="rounded-lg border border-gray-800/70 bg-gray-950/40 px-5 py-4">
          <Show when={view() === 'choice'}>
            <ChoiceView
              supportsSelfUpdate={daemonStore.state.supportsSelfUpdate}
              onAuto={triggerAutoUpdate}
              onAgent={() => setView('agent')}
              onManual={() => setView('manual')}
            />
          </Show>
          <Show when={view() === 'agent'}>
            <AgentView
              prompt={AGENT_PROMPT(MIN_DAEMON_VERSION, runningVersion())}
              onBack={() => setView('choice')}
            />
          </Show>
          <Show when={view() === 'manual'}>
            <ManualView shellCmd={SHELL_CMD} onBack={() => setView('choice')} />
          </Show>
        </div>

        <p class="text-[10px] text-gray-600 mt-6 leading-relaxed">
          The cockpit re-checks the daemon's <span class="font-mono">/health</span> every
          {' '}{POLL_INTERVAL_MS / 1000}s. As soon as it reports {MIN_DAEMON_VERSION} or newer, this
          panel disappears on its own and the project comes back live. No button to click.
        </p>
      </div>
    </section>
  );
}
