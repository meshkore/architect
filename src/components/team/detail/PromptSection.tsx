/**
 * PromptSection — the member's init prompt, with a markdown preview
 * (MemberDetailPanel section 2).
 *
 * Preview renders through the shared `<Markdown>` so a failed CDN load
 * shows the raw prompt rather than an empty pane — the operator is
 * editing this text and must never be shown "nothing" for it.
 */

import { Show } from 'solid-js';
import { Markdown } from '~/components/ui/Markdown';
import { TabButton } from '~/components/ui/TabButton';
import { SectionSaveButton } from '~/components/ui/SectionSaveButton';

const PREVIEW_PROSE =
  'prose prose-sm prose-invert max-w-none bg-[#020617] border border-gray-700/40 rounded px-3 py-2 text-[13px] text-gray-200 min-h-[20rem] overflow-y-auto [&_h1]:text-[15px] [&_h2]:text-[13px] [&_h2]:font-semibold [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-emerald-300/90 [&_code]:bg-gray-900/60 [&_code]:px-1 [&_code]:rounded [&_a]:text-sky-300 [&_a]:underline';

export function PromptSection(props: {
  prompt: string;
  onPrompt: (v: string) => void;
  tab: 'edit' | 'preview';
  onTab: (t: 'edit' | 'preview') => void;
  saving: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  return (
    <section class="space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">Init prompt</h3>
        <div class="flex items-center gap-1.5">
          <div class="flex items-center gap-0.5">
            <TabButton tone="accent" active={props.tab === 'edit'} onClick={() => props.onTab('edit')}>
              Edit
            </TabButton>
            <TabButton tone="accent" active={props.tab === 'preview'} onClick={() => props.onTab('preview')}>
              Preview
            </TabButton>
          </div>
          <SectionSaveButton saving={props.saving} onClick={() => props.onSave({ prompt: props.prompt })} />
        </div>
      </div>
      <Show
        when={props.tab === 'edit'}
        fallback={<Markdown text={props.prompt} class={PREVIEW_PROSE} />}
      >
        <textarea
          rows={20}
          value={props.prompt}
          onInput={(e) => props.onPrompt(e.currentTarget.value)}
          class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-2 text-[12px] font-mono leading-relaxed text-gray-100 focus:outline-none focus:border-emerald-500/55 resize-y"
        />
      </Show>
    </section>
  );
}

export default PromptSection;
