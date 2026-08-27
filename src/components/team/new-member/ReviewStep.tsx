/**
 * ReviewStep — step 3 of NewMemberDialog: confirm/tweak the drafted
 * profile before it is written.
 *
 * Reached on BOTH paths — a successful draft and a failed one (the
 * dialog falls through with the raw text as the prompt and safe
 * defaults), so every field here must be editable, never read-only
 * "confirmation" of what the normaliser decided.
 */

import { For, Show } from 'solid-js';
import { ClientModelEffortPicker, type EngineChoice } from '~/components/team/ClientModelEffortPicker';

const INPUT_CLASS =
  'w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[13px] text-gray-100 focus:outline-none focus:border-emerald-500/55';
const LABEL_CLASS = 'block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5';

export function ReviewStep(props: {
  name: string;
  onName: (v: string) => void;
  emoji: string;
  onEmoji: (v: string) => void;
  engine: EngineChoice;
  onEngine: (next: EngineChoice) => void;
  refs: string[];
  onRefs: (next: string[]) => void;
  prompt: string;
  onPrompt: (v: string) => void;
}) {
  const setRefAt = (i: number, v: string) => props.onRefs(props.refs.map((r, j) => (j === i ? v : r)));
  const removeRef = (i: number) => props.onRefs(props.refs.filter((_, j) => j !== i));

  return (
    <div class="space-y-4">
      <div class="flex gap-3">
        <div class="flex-1">
          <label class={LABEL_CLASS}>Name</label>
          <input
            type="text"
            value={props.name}
            onInput={(e) => props.onName(e.currentTarget.value)}
            class={INPUT_CLASS}
          />
        </div>
        <div class="w-24">
          <label class={LABEL_CLASS}>Emoji</label>
          <input
            type="text"
            value={props.emoji}
            onInput={(e) => props.onEmoji(e.currentTarget.value)}
            maxLength={4}
            class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[16px] text-center text-gray-100 focus:outline-none focus:border-emerald-500/55"
          />
        </div>
      </div>

      <ClientModelEffortPicker value={props.engine} onChange={props.onEngine} labels />

      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label class="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">References</label>
          <button
            type="button"
            onClick={() => props.onRefs([...props.refs, ''])}
            class="text-[11px] font-mono text-emerald-300/80 hover:text-emerald-200"
          >+ add</button>
        </div>
        <div class="space-y-1.5">
          <For each={props.refs}>
            {(r, i) => (
              <div class="flex gap-1.5">
                <input
                  type="text"
                  value={r}
                  onInput={(e) => setRefAt(i(), e.currentTarget.value)}
                  placeholder=".meshkore/context/stack.md"
                  class="flex-1 bg-[#020617] border border-gray-700/40 rounded px-2 py-1 text-[12px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
                />
                <button
                  type="button"
                  onClick={() => removeRef(i())}
                  class="px-2 text-gray-500 hover:text-red-300"
                  title="Remove"
                  aria-label="Remove reference"
                >✕</button>
              </div>
            )}
          </For>
          <Show when={props.refs.length === 0}>
            <p class="text-[11px] text-gray-600 italic">No references. Add paths/URLs the member should consult.</p>
          </Show>
        </div>
      </div>

      <div>
        <label class={LABEL_CLASS}>Init prompt</label>
        <textarea
          rows={12}
          value={props.prompt}
          onInput={(e) => props.onPrompt(e.currentTarget.value)}
          class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-2 text-[12px] font-mono leading-relaxed text-gray-100 focus:outline-none focus:border-emerald-500/55 resize-y"
        />
      </div>
    </div>
  );
}

export default ReviewStep;
