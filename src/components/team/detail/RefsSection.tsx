/**
 * RefsSection — the paths/URLs a member should consult
 * (MemberDetailPanel section 3).
 *
 * Blank rows are kept while editing (the operator adds an empty row,
 * then types) and only trimmed away at save time, so an accidental
 * empty entry never reaches the frontmatter.
 */

import { For, Show } from 'solid-js';
import { SectionSaveButton } from '~/components/ui/SectionSaveButton';

export function RefsSection(props: {
  refs: string[];
  onRefs: (next: string[]) => void;
  saving: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const setAt = (i: number, v: string) => props.onRefs(props.refs.map((r, j) => (j === i ? v : r)));
  const removeAt = (i: number) => props.onRefs(props.refs.filter((_, j) => j !== i));

  return (
    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">References</h3>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => props.onRefs([...props.refs, ''])}
            class="text-[11px] font-mono text-emerald-300/80 hover:text-emerald-200"
          >+ add</button>
          <SectionSaveButton
            saving={props.saving}
            onClick={() => props.onSave({ refs: props.refs.map((r) => r.trim()).filter(Boolean) })}
          />
        </div>
      </div>
      <div class="space-y-1.5">
        <For each={props.refs}>
          {(r, i) => (
            <div class="flex gap-1.5">
              <input
                type="text"
                value={r}
                onInput={(e) => setAt(i(), e.currentTarget.value)}
                placeholder=".meshkore/context/stack.md"
                class="flex-1 bg-[#020617] border border-gray-700/40 rounded px-2 py-1 text-[12px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
              />
              <button
                type="button"
                onClick={() => removeAt(i())}
                class="px-2 text-gray-500 hover:text-red-300"
                title="Remove"
                aria-label="Remove reference"
              >✕</button>
            </div>
          )}
        </For>
        <Show when={props.refs.length === 0}>
          <p class="text-[11px] text-gray-600 italic">No references.</p>
        </Show>
      </div>
    </section>
  );
}

export default RefsSection;
