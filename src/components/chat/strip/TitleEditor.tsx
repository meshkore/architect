/**
 * TitleEditor — the rename row that replaces the strip while editing.
 *
 * V104 — the old design was input-only: commit-on-blur, Enter to save,
 * Escape to cancel, all invisible. The input keeps those keys (muscle
 * memory) but now shows explicit Cancel / Save buttons, and it no longer
 * commits on blur, so the operator can click elsewhere in the cockpit
 * without losing the draft.
 */

import { createSignal } from 'solid-js';

export default function TitleEditor(props: {
  initial: string;
  agentId?: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = createSignal(props.initial);
  const commit = (): void => props.onCommit(draft().trim());
  return (
    <>
      <input
        autofocus
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); props.onCancel(); }
        }}
        placeholder={props.agentId ? `Rename ${props.agentId}…` : 'Rename agent…'}
        class="flex-1 min-w-0 bg-gray-950 border border-emerald-500/40 rounded px-2 py-1 text-sm text-gray-100 placeholder-gray-600 focus:outline-none"
      />
      <button
        type="button"
        onClick={props.onCancel}
        class="px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider text-gray-400 hover:text-gray-200 border border-gray-800 hover:border-gray-700 transition-colors flex-shrink-0"
        title="Cancel — Escape"
      >Cancel</button>
      <button
        type="button"
        onClick={commit}
        class="px-2.5 py-1 rounded text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/40 transition-colors flex-shrink-0"
        title="Save — Enter"
      >Save</button>
    </>
  );
}
