/**
 * InputStep — step 1 of NewMemberDialog: name, emoji, free-text mission.
 *
 * The paragraph the operator writes here is what the daemon's LLM
 * normaliser turns into a structured profile, so the placeholder names
 * the four things the normaliser can actually act on.
 */

import { Show } from 'solid-js';

const INPUT_CLASS =
  'w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[13px] text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500/55';
const LABEL_CLASS = 'block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5';

export function InputStep(props: {
  name: string;
  onName: (v: string) => void;
  emoji: string;
  onEmoji: (v: string) => void;
  rawText: string;
  onRawText: (v: string) => void;
  canSubmit: boolean;
}) {
  return (
    <div class="space-y-4">
      <div class="flex gap-3">
        <div class="flex-1">
          <label class={LABEL_CLASS}>Name</label>
          <input
            type="text"
            autofocus
            value={props.name}
            onInput={(e) => props.onName(e.currentTarget.value)}
            placeholder="e.g. SEO writer"
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
      <div>
        <label class={LABEL_CLASS}>Describe what this team member does</label>
        <textarea
          rows={10}
          value={props.rawText}
          onInput={(e) => props.onRawText(e.currentTarget.value)}
          placeholder="Its mission, the docs it should know, the credentials it can access, its limits."
          class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-2 text-[13px] leading-relaxed text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500/55 resize-y"
        />
      </div>
      <Show when={!props.canSubmit}>
        <p class="text-[11px] text-gray-500">A name and a description are required.</p>
      </Show>
    </div>
  );
}

export default InputStep;
