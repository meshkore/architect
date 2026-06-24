import { Show, createSignal } from 'solid-js';
import { Modal, type ModalButton } from '~/components/Modal';
import * as kp from '~/lib/known-projects';
import { projectsStore } from '~/state/projects';
import StepSwitch, { type Step } from './add-project/StepSwitch';
import { basename, type AddProjectAnswers } from './add-project/genPrompt';

const STEP_LABEL: Record<Step, number | null> = {
  START: 1, REVIVE: 2, NAME: 2, PATH: 3, DEVICES: 4, DATA: 5, PROMPT: 6,
};

const [open, setOpen] = createSignal(false);
export function openAddProjectWizard(): void { setOpen(true); }
export function closeAddProjectWizard(): void { setOpen(false); }

export function AddProjectWizardHost() {
  return (
    <Show when={open()}>
      <AddProjectWizard onClose={() => setOpen(false)} />
    </Show>
  );
}

function AddProjectWizard(props: { onClose: () => void }) {
  const [step, setStep] = createSignal<Step>('START');
  const [history, setHistory] = createSignal<Step[]>([]);
  const [answers, setAnswers] = createSignal<AddProjectAnswers>({
    startKind: null, projectName: '', path: '', devices: null, data: null,
  });
  const patch = (p: Partial<AddProjectAnswers>) => setAnswers({ ...answers(), ...p });
  const go = (next: Step) => { setHistory([...history(), step()]); setStep(next); };
  const back = () => {
    const h = history();
    if (!h.length) return;
    setHistory(h.slice(0, -1));
    setStep(h[h.length - 1]!);
  };

  const stopped = (): kp.KnownProject[] => {
    const livePorts = new Set(
      projectsStore.state.list.filter((p) => p.status === 'live').map((p) => p.port),
    );
    return kp.list().filter((k) => !livePorts.has(k.port));
  };

  const advanceFromPath = () => {
    const a = answers();
    if (a.startKind === 'existing') {
      if (a.path && !a.projectName) patch({ projectName: basename(a.path) });
      go('NAME');
    } else {
      go('DEVICES');
    }
  };

  const continueDisabled = () => step() === 'NAME' && !answers().projectName.trim();
  const onContinue = () => {
    const a = answers();
    if (step() === 'NAME') {
      if (!a.projectName.trim()) return;
      go(a.startKind === 'existing' ? 'DEVICES' : 'PATH');
    } else if (step() === 'PATH') {
      advanceFromPath();
    }
  };
  const onSkipPath = () => {
    patch({ path: '' });
    if (answers().startKind === 'existing') go('NAME'); else go('DEVICES');
  };

  const buttons = (): ModalButton[] => {
    const s = step();
    if (s === 'NAME') return [{ id: 'continue', label: 'Continue →', primary: true }];
    if (s === 'PATH') return [
      { id: 'skip', label: 'Skip — let the agent ask' },
      { id: 'continue', label: 'Continue →', primary: true },
    ];
    if (s === 'PROMPT') return [{ id: 'close', label: 'Close — keep scanning' }];
    return [];
  };

  const onModalClose = (id: string | null) => {
    if (id === 'continue') { if (!continueDisabled()) onContinue(); return; }
    if (id === 'skip') { onSkipPath(); return; }
    props.onClose();
  };

  const stepTag = () => {
    const n = STEP_LABEL[step()];
    return n ? `step ${n}` : '';
  };

  return (
    <Modal isOpen={true} onClose={onModalClose} title="Add a project" zIndex={55} buttons={buttons()}>
      <div class="min-h-[280px] flex flex-col">
        <Show when={history().length > 0}>
          <button
            type="button"
            onClick={back}
            class="self-start mb-3 px-2.5 py-1 rounded-md text-[11px] text-gray-400 border border-gray-700/40 hover:border-gray-500/60 hover:text-gray-200 transition"
          >← Back</button>
        </Show>
        <Show when={history().length === 0 && stepTag()}>
          <div class="mb-3 font-mono text-[10px] uppercase tracking-[0.10em] text-gray-500">{stepTag()}</div>
        </Show>
        <StepSwitch
          step={step()}
          answers={answers()}
          stopped={stopped()}
          patch={patch}
          go={go}
          advanceFromPath={advanceFromPath}
          onContinueName={onContinue}
        />
      </div>
    </Modal>
  );
}
