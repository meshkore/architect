/**
 * NamePicker — single text field. Subtitle shifts based on startKind:
 * for "existing" the name is the cluster id only; for "new" it's also
 * the folder name. Enter triggers Continue when non-empty.
 */
import WizardStep from './WizardStep';

export default function NamePicker(props: {
  startKind: 'existing' | 'new' | null;
  value: string;
  onInput: (v: string) => void;
  onSubmit: () => void;
}) {
  const subtitle = props.startKind === 'existing'
    ? 'This becomes the cluster id (used by the daemon and the mesh). It can match the folder name or be anything else. Lowercase, hyphens, no spaces.'
    : 'This becomes the folder name AND the cluster id. Lowercase, hyphens, no spaces.';

  return (
    <WizardStep title="What's the project called?" subtitle={subtitle}>
      <input
        type="text"
        autofocus
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && props.value.trim()) { e.preventDefault(); props.onSubmit(); } }}
        placeholder="my-project"
        autocomplete="off"
        spellcheck={false}
        class="w-full bg-[rgba(11,18,32,0.6)] border border-gray-700/50 rounded-lg px-3.5 py-3 text-[14px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/60 focus:bg-[rgba(11,18,32,0.85)] placeholder:text-gray-500"
      />
    </WizardStep>
  );
}
