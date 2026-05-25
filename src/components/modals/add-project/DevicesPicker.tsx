/**
 * DevicesPicker — single vs multi-device admission. Multi triggers the
 * device-auth setup note in the generated prompt.
 */
import WizardStep, { ChoiceButton } from './WizardStep';

export default function DevicesPicker(props: { onPick: (d: 'single' | 'multi') => void }) {
  return (
    <WizardStep
      title="Will you work from one device or several?"
      subtitle="Multi-device means other laptops, phones or VMs join the same cluster — needs device authentication setup."
    >
      <ChoiceButton
        title="Just this device"
        sub="Solo work · no cluster admission needed"
        onClick={() => props.onPick('single')}
      />
      <ChoiceButton
        title="Multiple devices"
        sub="The agent will set up device admission so other machines can join securely"
        onClick={() => props.onPick('multi')}
      />
    </WizardStep>
  );
}
