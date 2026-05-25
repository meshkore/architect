import { JSX, createSignal } from 'solid-js';
export { AGENT_PROMPT } from './agent-prompt';

export type AgentViewProps = {
  prompt: string;
  onBack: () => void;
};

export function AgentView(props: AgentViewProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.warn('clipboard write failed', err);
    }
  };
  return (
    <>
      <div class="flex items-center gap-2 mb-2">
        <button
          type="button"
          class="text-[11px] text-gray-400 hover:text-emerald-300 flex items-center gap-1"
          onClick={props.onBack}
        >← back</button>
        <span class="text-[12px] text-gray-300 font-semibold">Paste this into your coding agent</span>
      </div>
      <p class="text-[11px] text-gray-500 mb-3 leading-relaxed">
        Works with Claude Code, Codex, Copilot, Cursor, Windsurf — any
        agent with shell access in this repo. Hit recheck when it confirms it's done.
      </p>
      <textarea
        readonly
        class="w-full bg-gray-950 border border-gray-800 rounded p-3 text-[11px] font-mono text-gray-200 leading-relaxed mb-3 h-60 resize-y"
        value={props.prompt}
      />
      <div class="flex gap-2">
        <button
          type="button"
          class="flex-1 px-3 py-2 rounded bg-gray-900 text-gray-300 border border-gray-800 text-sm hover:text-gray-100 transition"
          onClick={doCopy}
        >{copied() ? 'copied ✓' : 'Copy prompt'}</button>
      </div>
    </>
  );
}
