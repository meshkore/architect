/**
 * DaemonOutdatedModal — V47 upgrade chooser.
 *
 * Three paths (auto / agent / manual) plus a persistent lock panel
 * that survives `Dismiss` until the daemon passes the version gate
 * again. Module-level signal store + `<DaemonOutdatedHost />` mounted
 * once at the App root; opens automatically when `daemonStore.outdated`
 * flips true, and also on explicit `openDaemonOutdatedModal()` calls
 * (ChatComposer fires that on a send blocked by the version gate).
 *
 * Floating modal: pointer-events-none outer so the rail + header stay
 * clickable (operator can switch to another project at any time).
 */

import { JSX, Show, createEffect, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Modal } from '../Modal';
import { daemonStore } from '~/state/daemon';
import { activeProject } from '~/state/projects';
import { MIN_DAEMON_VERSION } from '~/lib/version';
import { ChoiceView } from './daemon-outdated/ChoiceView';
import { AgentView, AGENT_PROMPT } from './daemon-outdated/AgentView';
import { ManualView, SHELL_CMD } from './daemon-outdated/ManualView';
import { openAutoUpdateFlow, isAutoUpdating } from './AutoUpdateFlow';
import { log } from '~/lib/log';

type View = 'choice' | 'agent' | 'manual';

const [isOpen, setIsOpen] = createSignal(false);
const [dismissed, setDismissed] = createSignal(false);
const [view, setView] = createSignal<View>('choice');
const [rechecking, setRechecking] = createSignal(false);
const [recheckError, setRecheckError] = createSignal<string | null>(null);

/** Open the modal. Resets to the choice view; clears `dismissed`. */
export function openDaemonOutdatedModal(): void {
  setView('choice');
  setRecheckError(null);
  setDismissed(false);
  setIsOpen(true);
}

function closeModal(): void {
  setIsOpen(false);
}

function dismissModal(): void {
  setIsOpen(false);
  setDismissed(true);
}

function clusterLabel(): string {
  const p = activeProject();
  return p?.cluster_name ?? p?.base ?? 'this project';
}

function runningVersion(): string {
  return daemonStore.state.version?.raw ?? daemonStore.state.health?.version ?? 'unknown';
}

async function doRecheck(): Promise<void> {
  setRechecking(true);
  setRecheckError(null);
  try {
    const ok = await daemonStore.recheckHealth();
    if (ok) {
      setIsOpen(false);
      setDismissed(false);
    } else {
      setRecheckError(
        'Still on ' + runningVersion() + ' — make sure the old process was killed before the new one started.',
      );
      setTimeout(() => setRecheckError(null), 4000);
    }
  } catch (err) {
    log.warn('[V47] recheck failed', err);
    setRecheckError('Recheck failed — see console.');
  } finally {
    setRechecking(false);
  }
}

function triggerAutoUpdate(): void {
  // Hand off to the M6.4 silent flow. Mark V47 dismissed so its
  // auto-open effect doesn't re-trigger behind the AutoUpdateFlow,
  // and so the LockPanel logic stays consistent once the flow ends.
  setDismissed(true);
  setIsOpen(false);
  openAutoUpdateFlow();
}

function Header(): JSX.Element {
  return (
    <div class="flex items-center gap-2 mb-3">
      <div class="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" width="16" height="16">
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </div>
      <div class="min-w-0">
        <h3 class="text-base font-semibold leading-tight text-gray-100">
          Update <span class="text-amber-300">{clusterLabel()}</span>'s daemon
        </h3>
        <p class="text-[11px] text-gray-500 font-mono truncate">
          {activeProject()?.base ?? ''} · running <span class="text-amber-300">{runningVersion()}</span>{' '}
          · needs <span class="text-emerald-300">{MIN_DAEMON_VERSION}</span>
        </p>
      </div>
    </div>
  );
}

function RecheckBar(): JSX.Element {
  return (
    <>
      <div class="flex gap-2 mt-4">
        <button
          type="button"
          disabled={rechecking()}
          onClick={() => void doRecheck()}
          class="flex-1 px-3 py-2 rounded bg-emerald-500 text-gray-950 text-sm font-semibold hover:bg-emerald-400 transition disabled:opacity-60"
        >{rechecking() ? 'rechecking…' : "I've updated — recheck"}</button>
        <button
          type="button"
          onClick={dismissModal}
          title="Leave this project locked — you can still switch to another from the rail"
          class="px-3 py-2 rounded bg-gray-900 text-gray-400 border border-gray-800 text-sm hover:text-gray-200 transition"
        >Dismiss</button>
      </div>
      <p class="text-[10px] text-gray-600 mt-3">
        Dismiss leaves <em>this</em> project read-only; other projects keep working normally.
      </p>
      <Show when={recheckError()}>
        <p class="text-[11px] text-amber-300 mt-2">{recheckError()}</p>
      </Show>
    </>
  );
}

function Body(): JSX.Element {
  return (
    <>
      <Header />
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
      <RecheckBar />
    </>
  );
}

function LockPanel(): JSX.Element {
  return (
    <Portal mount={document.body}>
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(6,10,18,0.94)] backdrop-blur-sm pointer-events-auto px-4">
        <div class="max-w-md w-full rounded-xl shadow-2xl p-6 text-center bg-[#0b1220] border border-gray-700/40">
          <div class="flex items-center justify-center gap-2 mb-3">
            <div class="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" width="18" height="18">
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
          </div>
          <h3 class="text-base font-semibold leading-tight text-gray-100">
            {clusterLabel()} is locked
          </h3>
          <p class="text-[11px] text-gray-500 font-mono mt-1 mb-4">
            daemon <span class="text-amber-300">{runningVersion()}</span>{' '}
            · cockpit needs <span class="text-emerald-300">{MIN_DAEMON_VERSION}</span>
          </p>
          <p class="text-[12px] text-gray-300 mb-4 leading-relaxed">
            Update this project's daemon to keep working on it.{' '}
            <strong>Other projects in the rail are unaffected</strong> — click any of them to switch.
          </p>
          <button
            type="button"
            class="px-4 py-2 rounded bg-emerald-500 text-gray-950 text-sm font-semibold hover:bg-emerald-400 transition"
            onClick={openDaemonOutdatedModal}
          >Show update options</button>
        </div>
      </div>
    </Portal>
  );
}

export function DaemonOutdatedHost(): JSX.Element {
  // Auto-open when the daemon flips to outdated (and we haven't been
  // dismissed yet). Clear everything when the gate goes green again.
  createEffect(() => {
    const outdated = daemonStore.state.outdated;
    if (outdated && !dismissed() && !isOpen()) {
      openDaemonOutdatedModal();
    }
    if (!outdated) {
      setIsOpen(false);
      setDismissed(false);
    }
  });

  return (
    <>
      <Show when={daemonStore.state.outdated && dismissed() && !isOpen() && !isAutoUpdating()}>
        <LockPanel />
      </Show>
      <Modal
        isOpen={isOpen()}
        floating
        zIndex={55}
        onClose={(id) => {
          // Backdrop / Esc / X — treat as dismiss (keep the lock panel up).
          if (id === null) dismissModal();
          else closeModal();
        }}
      >
        <Body />
      </Modal>
    </>
  );
}
