import { Match, Switch } from 'solid-js';
import StartKindPicker from './StartKindPicker';
import NamePicker from './NamePicker';
import PathPicker from './PathPicker';
import DevicesPicker from './DevicesPicker';
import DataPicker from './DataPicker';
import NewPromptScreen from './NewPromptScreen';
import ReviveList from './ReviveList';
import * as kp from '~/lib/known-projects';
import type { AddProjectAnswers } from './genPrompt';

export type Step = 'START' | 'REVIVE' | 'NAME' | 'PATH' | 'DEVICES' | 'DATA' | 'PROMPT';

export default function StepSwitch(props: {
  step: Step;
  answers: AddProjectAnswers;
  stopped: kp.KnownProject[];
  patch: (p: Partial<AddProjectAnswers>) => void;
  go: (next: Step) => void;
  advanceFromPath: () => void;
  onContinueName: () => void;
}) {
  return (
    <Switch>
      <Match when={props.step === 'START'}>
        <StartKindPicker
          stoppedCount={props.stopped.length}
          onRevive={() => props.go('REVIVE')}
          onExisting={() => { props.patch({ startKind: 'existing' }); props.go('PATH'); }}
          onNew={() => { props.patch({ startKind: 'new' }); props.go('NAME'); }}
        />
      </Match>
      <Match when={props.step === 'REVIVE'}>
        <ReviveList stopped={props.stopped} />
      </Match>
      <Match when={props.step === 'NAME'}>
        <NamePicker
          startKind={props.answers.startKind}
          value={props.answers.projectName}
          onInput={(v) => props.patch({ projectName: v })}
          onSubmit={props.onContinueName}
        />
      </Match>
      <Match when={props.step === 'PATH'}>
        <PathPicker
          startKind={props.answers.startKind!}
          projectName={props.answers.projectName}
          value={props.answers.path}
          onInput={(v) => props.patch({ path: v })}
          onSubmit={props.advanceFromPath}
        />
      </Match>
      <Match when={props.step === 'DEVICES'}>
        <DevicesPicker onPick={(d) => { props.patch({ devices: d }); props.go('DATA'); }} />
      </Match>
      <Match when={props.step === 'DATA'}>
        <DataPicker onPick={(d) => { props.patch({ data: d }); props.go('PROMPT'); }} />
      </Match>
      <Match when={props.step === 'PROMPT'}>
        <NewPromptScreen answers={props.answers} />
      </Match>
    </Switch>
  );
}
