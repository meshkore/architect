import { JSX, Show, createEffect, createSignal } from 'solid-js';
import { Modal } from '../Modal';
import { daemonStore } from '~/state/daemon';
import { MIN_DAEMON_VERSION } from '~/lib/version';
import { ChoiceView } from './daemon-outdated/ChoiceView';
import { AgentView, AGENT_PROMPT } from './daemon-outdated/AgentView';
import { ManualView, SHELL_CMD } from './daemon-outdated/ManualView';
import { Header, runningVersion } from './daemon-outdated/Header';
import { LockPanel } from './daemon-outdated/LockPanel';
import { openAutoUpdateFlow, isAutoUpdating } from './AutoUpdateFlow';
import { log } from '~/lib/log';

type View = 'choice' | 'agent' | 'manual';

const [isOpen, setIsOpen] = createSignal(false);
const [dismissed, setDismissed] = createSignal(false);
const [view, setView] = createSignal<View>('choice');
const [rechecking, setRechecking] = createSignal(false);
const [recheckError, setRecheckError] = createSignal<string | null>(null);

export function openDaemonOutdatedModal(): void {
  setView('choice');
  setRecheckError(null);
  setDismissed(false);
  setIsOpen(true);
}

const closeModal = (): void => { setIsOpen(false); };
const dismissModal = (): void => { setIsOpen(false); setDismissed(true); };

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
  setDismissed(true);
  setIsOpen(false);
  openAutoUpdateFlow();
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

export function DaemonOutdatedHost(): JSX.Element {
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
        <LockPanel onShowOptions={openDaemonOutdatedModal} />
      </Show>
      <Modal
        isOpen={isOpen()}
        floating
        zIndex={55}
        onClose={(id) => {
          if (id === null) dismissModal();
          else closeModal();
        }}
      >
        <Body />
      </Modal>
    </>
  );
}
