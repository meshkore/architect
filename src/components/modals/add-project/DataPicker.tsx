/**
 * DataPicker — local-only vs cloud-sync. Cloud sets storage.mode=remote
 * in the generated cluster.yaml and adds a cluster.meshkore.com note.
 */
import WizardStep, { ChoiceButton } from './WizardStep';

export default function DataPicker(props: { onPick: (d: 'local' | 'cloud') => void }) {
  return (
    <WizardStep
      title="Where should project data live?"
      subtitle="Cloud sync lets you see the project from any device. Local-only means everything stays on this machine."
    >
      <ChoiceButton
        title="Local only"
        sub="Stays on this machine · architect talks to the daemon on localhost · free forever"
        onClick={() => props.onPick('local')}
      />
      <ChoiceButton
        title="Cloud sync"
        sub="Sync via cluster.meshkore.com so you can see this project from any device · free in v1, may become a paid service later"
        onClick={() => props.onPick('cloud')}
      />
    </WizardStep>
  );
}
