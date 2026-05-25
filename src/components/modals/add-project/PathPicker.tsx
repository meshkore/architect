/**
 * PathPicker — absolute path input + a small "how to copy" tip block.
 * `existing` semantics: path is the folder itself. `new` semantics:
 * path is the PARENT directory; the wizard creates ./<projectName>/.
 */
import WizardStep from './WizardStep';

export default function PathPicker(props: {
  startKind: 'existing' | 'new';
  projectName: string;
  value: string;
  onInput: (v: string) => void;
  onSubmit: () => void;
}) {
  const isExisting = props.startKind === 'existing';
  const title = isExisting ? 'Where is the folder?' : 'Where do we put the new folder?';
  const placeholder = isExisting ? '/Users/me/projects/my-app' : '/Users/me/projects';
  const subtitle = isExisting
    ? 'Absolute path to the existing project folder. We can pre-fill the project name from its folder name on the next step.'
    : (
      <>
        Absolute path to the PARENT folder. We create{' '}
        <code class="font-mono text-emerald-300">./{props.projectName || 'my-project'}/</code>{' '}
        inside it.
      </>
    );

  return (
    <WizardStep title={title} subtitle={subtitle}>
      <input
        type="text"
        autofocus
        value={props.value}
        onInput={(e) => props.onInput(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); props.onSubmit(); } }}
        placeholder={placeholder}
        autocomplete="off"
        spellcheck={false}
        class="w-full bg-[rgba(11,18,32,0.6)] border border-gray-700/50 rounded-lg px-3.5 py-3 text-[14px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/60 focus:bg-[rgba(11,18,32,0.85)] placeholder:text-gray-500"
      />
      <div class="bg-blue-500/10 border border-blue-500/25 rounded-lg px-3 py-2.5 text-[12px] text-slate-300 leading-relaxed">
        <div class="font-semibold text-gray-200 mb-0.5">How to copy the absolute path</div>
        <div>· macOS: in Finder, ⌘+click the folder → <em class="not-italic text-blue-300">"Copy &lt;name&gt; as Pathname"</em></div>
        <div>· Windows: Shift+right-click the folder → <em class="not-italic text-blue-300">"Copy as path"</em></div>
        <div>· Linux / terminal: <code class="font-mono text-emerald-300">pwd</code> inside the folder</div>
      </div>
    </WizardStep>
  );
}
