/**
 * DaemonOutdatedPanel — wizard layout (py-1.11.1-cockpit).
 *
 * One step visible at a time. No long copy. The flow is:
 *
 *   updating (default on mount)
 *     ┌─ auto-update spinner + 1-line status + elapsed counter
 *     ├─ after AUTO_TIMEOUT_MS without success → reveal "Take over manually"
 *     └─ on success → state.outdated flips false → panel unmounts
 *
 *   stuck (after AUTO_TIMEOUT_MS or operator chose "take over")
 *     ┌─ 2 buttons: "Paste-ready agent prompt" / "One-line shell command"
 *     └─ choosing one → agent | manual sub-step
 *
 *   failed (auto-update returned an error)
 *     ┌─ reason (1 line) + "Retry auto" + "Switch to manual"
 *
 *   agent / manual
 *     ┌─ minimal view: title + box + copy + back link
 *
 * Polling (every POLL_INTERVAL_MS):
 *   1. recheckHealth on the active client (cheap; catches in-place restarts)
 *   2. if still outdated → discoverProjects({ fullScan: true }) + try
 *      switching to any port advertising the same cluster_id. This is what
 *      makes the panel close ON ITS OWN after the daemon swap, even if the
 *      AutoUpdateFlow modal already exited and the operator just sits there.
 *
 * ProjectsRail (left) stays clickable so the operator can keep working on
 * other projects while this one waits.
 */

import { JSX, Show, createSignal, onCleanup, onMount, createMemo, createEffect } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { activeProject, projectsStore } from '~/state/projects';
import { MIN_DAEMON_VERSION, meetsMinimum, isFeatureGapped } from '~/lib/version';
import { daemonHttpBase } from '~/lib/transport';
import { AgentView, AGENT_PROMPT } from './modals/daemon-outdated/AgentView';
import { ManualView, SHELL_CMD } from './modals/daemon-outdated/ManualView';
import { runningVersion } from './modals/daemon-outdated/Header';
import { discoverProjects } from '~/components/projects-rail/discovery';
import {
  openAutoUpdateFlow,
  autoUpdateOutcome,
  autoUpdateLastErrorReason,
} from './modals/AutoUpdateFlow';
import { log } from '~/lib/log';

type SubStep = 'agent' | 'manual' | null;

const POLL_INTERVAL_MS = 5000;
// How long we let the silent auto-update try before suggesting a manual path.
// Picked empirically: the happy path lands in 6-10s; we give 60s of margin
// before nudging the operator to take over.
const AUTO_TIMEOUT_MS = 60_000;

function clusterLabelText(): string {
  const p = activeProject();
  return p?.cluster_name ?? p?.base ?? 'this project';
}

/** Anonymous /health probe on a candidate port. Used by the poll to
 *  decide whether switching is worth the round-trip. ~600 ms timeout
 *  to keep the poll cycle snappy. Null on any error. */
async function probeHealth(
  port: number,
): Promise<{ version?: string; features?: string[] } | null> {
  const url = `${daemonHttpBase(port)}/health`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(600) });
    if (!r.ok) return null;
    const d = (await r.json()) as { version?: string; features?: string[] };
    return d;
  } catch {
    return null;
  }
}

export default function DaemonOutdatedPanel(): JSX.Element {
  const [subStep, setSubStep] = createSignal<SubStep>(null);
  const [mountedAt] = createSignal<number>(Date.now());
  const [nowMs, setNowMs] = createSignal(Date.now());

  // Derived phase used in the render switch.
  const phase = createMemo<'updating' | 'stuck' | 'failed' | 'sub'>(() => {
    if (subStep() !== null) return 'sub';
    const o = autoUpdateOutcome();
    if (o === 'failed') return 'failed';
    if (o === 'running') return 'updating';
    // outcome is 'idle' — either we just mounted (auto-trigger pending),
    // or the operator dismissed and we're waiting for the auto-recover.
    // After AUTO_TIMEOUT_MS we surface the manual options.
    return nowMs() - mountedAt() > AUTO_TIMEOUT_MS ? 'stuck' : 'updating';
  });

  const elapsedSec = createMemo<number>(
    () => Math.max(0, Math.floor((nowMs() - mountedAt()) / 1000)),
  );

  /**
   * Poll: recheck the current client, then port-scan to catch a daemon
   * that moved ports during self-update. If a port for the same cluster
   * is now advertising MIN+, switch to it — the panel unmounts as soon
   * as outdated flips false.
   *
   * Order matters: we PROBE the candidate's /health BEFORE switching,
   * so we don't bounce active across a stale daemon that happens to
   * carry the same cluster_id. Switching only when we know the
   * candidate is already on MIN+ keeps state.outdated honest.
   */
  const poll = async (): Promise<void> => {
    try {
      const stillOutdated = !(await daemonStore.recheckHealth());
      if (!stillOutdated) return; // panel unmounts naturally
      await discoverProjects({ fullScan: true }).catch(() => undefined);
      const cluster = activeProject()?.cluster_id;
      if (!cluster) return;
      const currentPort = daemonStore.state.health?.port;
      const candidates = projectsStore.state.list.filter(
        (p) => p.cluster_id === cluster && p.port !== currentPort,
      );
      for (const cand of candidates) {
        const probed = await probeHealth(cand.port);
        if (!probed) continue;
        if (!meetsMinimum(probed.version) || isFeatureGapped(probed.features)) continue;
        const ok = await daemonStore.switchToPort(cand.port).catch(() => false);
        if (ok) {
          log.info('outdated panel: auto-switched to fresh daemon port', { port: cand.port, version: probed.version });
          return;
        }
      }
    } catch (err) {
      log.warn('outdated panel poll threw', err);
    }
  };

  // Auto-trigger the silent self-update on mount (operator's "do it for
  // me by default" expectation). Only ONCE per mount — re-tries are
  // explicit operator actions from this point on.
  onMount(() => {
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    const pollTimer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
    const kickoff = setTimeout(() => {
      log.info('outdated panel: auto-triggering silent self-update');
      openAutoUpdateFlow();
    }, 300);
    // First poll a bit before the regular tick so the operator doesn't
    // wait 5s on initial mount.
    const earlyPoll = setTimeout(() => { void poll(); }, 1500);
    onCleanup(() => {
      clearInterval(tick);
      clearInterval(pollTimer);
      clearTimeout(kickoff);
      clearTimeout(earlyPoll);
    });
  });

  // If the auto-update outcome flips to failed, leave the sub-step alone
  // (it's null by default) so the failed view shows. If it flips back to
  // running (operator clicked Retry from failed), reset the sub-step.
  createEffect(() => {
    if (autoUpdateOutcome() === 'running' && subStep() !== null) {
      setSubStep(null);
    }
  });

  const retryAuto = (): void => { openAutoUpdateFlow(); };

  return (
    <section class="flex-1 flex flex-col min-h-0 overflow-y-auto bg-canvas">
      <div class="max-w-md mx-auto px-6 py-12 w-full">
        {/* Compact header — one line, no preamble. */}
        <div class="flex items-center gap-3 mb-6">
          <div class="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" width="16" height="16">
              <path d="M12 9v4M12 17h.01" />
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div class="min-w-0">
            <h1 class="text-sm font-semibold text-gray-100 truncate">
              {clusterLabelText()} — daemon update
            </h1>
            <p class="text-[11px] text-gray-500 font-mono mt-0.5">
              <span class="text-amber-300">{runningVersion()}</span>
              {' → '}
              <span class="text-emerald-300">{MIN_DAEMON_VERSION}+</span>
            </p>
          </div>
        </div>

        {/* The wizard panel — exactly one step visible. */}
        <div class="rounded-lg border border-gray-800/70 bg-gray-950/40 px-5 py-5">
          <Show when={phase() === 'updating'}>
            <UpdatingStep elapsedSec={elapsedSec()} />
          </Show>

          <Show when={phase() === 'stuck'}>
            <StuckStep
              elapsedSec={elapsedSec()}
              onAgent={() => setSubStep('agent')}
              onManual={() => setSubStep('manual')}
              onRetryAuto={retryAuto}
            />
          </Show>

          <Show when={phase() === 'failed'}>
            <FailedStep
              reason={autoUpdateLastErrorReason() ?? null}
              onAgent={() => setSubStep('agent')}
              onManual={() => setSubStep('manual')}
              onRetryAuto={retryAuto}
            />
          </Show>

          <Show when={phase() === 'sub' && subStep() === 'agent'}>
            <AgentView
              prompt={AGENT_PROMPT(MIN_DAEMON_VERSION, runningVersion())}
              onBack={() => setSubStep(null)}
            />
          </Show>

          <Show when={phase() === 'sub' && subStep() === 'manual'}>
            <ManualView shellCmd={SHELL_CMD} onBack={() => setSubStep(null)} />
          </Show>
        </div>

        {/* Single line at the bottom — what the cockpit is doing. */}
        <p class="text-[10px] text-gray-600 mt-5 leading-relaxed text-center">
          Watching <code class="font-mono">/health</code> every {POLL_INTERVAL_MS / 1000}s · panel closes
          on its own when the new daemon answers.
        </p>
      </div>
    </section>
  );
}

/** Phase 1 — auto-update in progress (or about to start). Spinner only. */
function UpdatingStep(props: { elapsedSec: number }): JSX.Element {
  return (
    <div class="flex flex-col items-center text-center py-4">
      <span class="inline-flex items-center gap-1 mb-4" aria-hidden="true">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-300 animate-pulse-soft" />
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-300 animate-pulse-soft [animation-delay:150ms]" />
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-300 animate-pulse-soft [animation-delay:300ms]" />
      </span>
      <p class="text-[13px] text-emerald-200 font-medium mb-1">Updating automatically…</p>
      <p class="text-[11px] text-gray-500">{props.elapsedSec}s elapsed</p>
    </div>
  );
}

/** Phase 2 — taking longer than expected. Surface 2 manual options. */
function StuckStep(props: {
  elapsedSec: number;
  onAgent: () => void;
  onManual: () => void;
  onRetryAuto: () => void;
}): JSX.Element {
  return (
    <div class="flex flex-col gap-3">
      <div class="text-center pb-2 border-b border-gray-800/60">
        <p class="text-[12px] text-amber-200">Taking longer than expected ({props.elapsedSec}s).</p>
        <button
          type="button"
          onClick={props.onRetryAuto}
          class="mt-2 text-[10px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 underline underline-offset-2"
        >
          retry the silent update
        </button>
      </div>
      <ManualButtons onAgent={props.onAgent} onManual={props.onManual} />
    </div>
  );
}

/** Phase 3 — auto-update returned an error. Short reason + paths. */
function FailedStep(props: {
  reason: string | null;
  onAgent: () => void;
  onManual: () => void;
  onRetryAuto: () => void;
}): JSX.Element {
  return (
    <div class="flex flex-col gap-3">
      <div class="text-center pb-3 border-b border-gray-800/60">
        <p class="text-[12px] text-amber-300 font-medium">Auto-update failed.</p>
        <Show when={props.reason}>
          <p class="text-[10px] text-gray-400 font-mono mt-1 break-words">{props.reason}</p>
        </Show>
        <button
          type="button"
          onClick={props.onRetryAuto}
          class="mt-2 text-[10px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 underline underline-offset-2"
        >
          retry the silent update
        </button>
      </div>
      <ManualButtons onAgent={props.onAgent} onManual={props.onManual} />
    </div>
  );
}

/** The two manual paths as compact, side-by-side buttons. Shared by
 *  StuckStep and FailedStep so the operator only ever sees one button
 *  layout regardless of how they got here. */
function ManualButtons(props: { onAgent: () => void; onManual: () => void }): JSX.Element {
  return (
    <div class="grid grid-cols-1 gap-2">
      <button
        type="button"
        onClick={props.onAgent}
        class="text-left px-3 py-2.5 rounded-md border border-gray-800 bg-gray-900 hover:border-gray-700 transition"
      >
        <div class="text-[12px] font-semibold text-emerald-300">Paste a prompt to your AI agent</div>
        <div class="text-[10px] text-gray-500 mt-0.5">Claude Code, Codex, Cursor… one paste, agent runs it.</div>
      </button>
      <button
        type="button"
        onClick={props.onManual}
        class="text-left px-3 py-2.5 rounded-md border border-gray-800 bg-gray-900 hover:border-gray-700 transition"
      >
        <div class="text-[12px] font-semibold text-gray-200">Run one shell command</div>
        <div class="text-[10px] text-gray-500 mt-0.5">Open a terminal in the project, paste, done.</div>
      </button>
    </div>
  );
}
