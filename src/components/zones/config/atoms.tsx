import { Show } from 'solid-js';

export function Block(props: { title: string; subtitle?: string; children: any }) {
  return (
    <div class="bg-gray-900/40 border border-gray-800/60 rounded-lg p-4 mb-4">
      <h3 class="text-xs font-mono uppercase tracking-wider text-gray-500 mb-1">{props.title}</h3>
      <Show when={props.subtitle}><p class="text-[11px] text-gray-600 mb-3">{props.subtitle}</p></Show>
      {props.children}
    </div>
  );
}

export function KV(props: { k: string; v: string }) {
  return (
    <div class="flex gap-3 py-0.5">
      <span class="text-gray-600 font-mono text-xs min-w-[12rem]">{props.k}</span>
      <span class="text-gray-200 font-mono text-xs break-all">{props.v}</span>
    </div>
  );
}

export function BtnRow(props: { children: any }) {
  return <div class="flex flex-wrap gap-2 mt-3">{props.children}</div>;
}

/** Pill toggle switch — gray track when off, theme-accent when on, circle
 *  slides left/right. Follows the active theme (`--theme-accent-bright`),
 *  not a hardcoded color, so it matches whichever palette the operator
 *  picked in ThemePicker. */
export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      class="relative inline-flex flex-shrink-0 items-center h-5 w-9 rounded-full transition-colors duration-150 disabled:opacity-50"
      style={{ background: props.checked ? 'var(--theme-accent-bright, #34d399)' : 'rgba(107,114,128,0.5)' }}
    >
      <span
        class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-150"
        style={{ transform: props.checked ? 'translateX(19px)' : 'translateX(3px)' }}
      />
    </button>
  );
}

export function Btn(props: { onClick: () => void; disabled?: boolean; danger?: boolean; children: any }) {
  const klass = props.danger
    ? 'border-red-500/30 hover:border-red-500/60 text-red-300 hover:text-red-200'
    : 'border-gray-800 hover:border-emerald-500/30 text-gray-300 hover:text-emerald-300';
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      class={`px-3 py-1.5 rounded bg-gray-900 border text-[12px] font-mono disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${klass}`}
    >
      {props.children}
    </button>
  );
}
