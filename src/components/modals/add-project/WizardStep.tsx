/**
 * WizardStep — shared step shell: heading + sub-text + body slot.
 * Used by every AddProjectWizard step so titles/spacing don't drift.
 */
import { JSX, Show } from 'solid-js';

export default function WizardStep(props: {
  title: string;
  subtitle?: JSX.Element;
  children?: JSX.Element;
}) {
  return (
    <div class="space-y-3">
      <h3 class="text-[18px] font-semibold text-gray-100 leading-snug">{props.title}</h3>
      <Show when={props.subtitle}>
        <p class="text-[12.5px] text-gray-400 leading-relaxed">{props.subtitle}</p>
      </Show>
      <div class="space-y-2.5">{props.children}</div>
    </div>
  );
}

export function ChoiceButton(props: {
  title: string;
  sub: JSX.Element;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="flex items-center gap-3.5 w-full bg-[rgba(11,18,32,0.6)] border border-gray-700/35 rounded-xl px-5 py-4 text-left transition hover:bg-[rgba(11,18,32,0.95)] hover:border-emerald-500/50 hover:translate-x-[2px]"
    >
      <div class="flex-1 min-w-0">
        <div class="text-[15px] font-semibold text-gray-200 mb-0.5">{props.title}</div>
        <div class="text-[12px] text-gray-400 leading-snug">{props.sub}</div>
      </div>
      <span class="text-gray-500 text-lg flex-shrink-0">→</span>
    </button>
  );
}
