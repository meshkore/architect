/**
 * StartKindPicker — first wizard step. Operator chooses revive / existing
 * folder / brand-new project. The "revive" choice is suppressed when no
 * stopped projects are on record.
 */
import { Show } from 'solid-js';
import WizardStep, { ChoiceButton } from './WizardStep';

export default function StartKindPicker(props: {
  stoppedCount: number;
  onRevive: () => void;
  onExisting: () => void;
  onNew: () => void;
}) {
  return (
    <WizardStep title="What do you want to do?">
      <Show when={props.stoppedCount > 0}>
        <ChoiceButton
          title="Connect a project I had before"
          sub={`${props.stoppedCount} on record · daemon offline`}
          onClick={props.onRevive}
        />
      </Show>
      <ChoiceButton
        title="Add an existing folder"
        sub={
          <>I already have a folder with code on disk — no <code class="font-mono text-emerald-300">.meshkore/</code> yet</>
        }
        onClick={props.onExisting}
      />
      <ChoiceButton
        title="Start a brand-new project"
        sub="Empty — we create the folder + scaffold everything"
        onClick={props.onNew}
      />
    </WizardStep>
  );
}
