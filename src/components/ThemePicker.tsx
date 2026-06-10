/**
 * ThemePicker — palette-icon button in the header that opens a
 * customizer panel (themes + colour overrides + font-size preset).
 *
 * 2026-06-10 operator rewrite: was a tiny popover, now a bigger 3-tab
 * surface so the operator can drive multiple groups independently
 * without scrolling a single column.
 *
 *   Tab "Theme"  — 4 preset cards (Emerald / Indigo / Amber / Mono).
 *   Tab "Colours" — per-spot override chips for the colour vars the
 *                  operator is most likely to want differently from
 *                  the preset (chat user byline, agent byline, accent).
 *   Tab "Sizes"  — 3 size presets (Compact / Default / Large), each
 *                  shows a small preview of the 5 type tokens.
 *
 * Reset link clears every override + reverts to Emerald / Default.
 */

import { createSignal, onCleanup, For, Show } from 'solid-js';
import { themeStore } from '~/state/theme';
import {
  THEME_OPTIONS,
  SIZE_OPTIONS,
  CHAT_USER_COLOR_CHIPS,
  THEMES,
  SIZE_PRESETS,
  type ThemeId,
  type SizeId,
} from '~/lib/theme-presets';

type Tab = 'theme' | 'colours' | 'sizes';

export default function ThemePicker() {
  const [open, setOpen] = createSignal(false);
  const [tab, setTab] = createSignal<Tab>('theme');
  let hostEl: HTMLDivElement | undefined;

  const close = (): void => setOpen(false);

  const onDocPointer = (e: PointerEvent): void => {
    if (!open()) return;
    const target = e.target as Node | null;
    if (target && hostEl && hostEl.contains(target)) return;
    close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  const toggle = (): void => {
    const next = !open();
    setOpen(next);
    if (next) {
      window.addEventListener('pointerdown', onDocPointer);
      window.addEventListener('keydown', onKey);
    } else {
      window.removeEventListener('pointerdown', onDocPointer);
      window.removeEventListener('keydown', onKey);
    }
  };
  onCleanup(() => {
    window.removeEventListener('pointerdown', onDocPointer);
    window.removeEventListener('keydown', onKey);
  });

  return (
    <div ref={hostEl} class="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        title="Theme & sizes"
        aria-label="Open theme picker"
        aria-expanded={open()}
        class="inline-flex items-center justify-center w-7 h-7 rounded border transition-colors"
        style={
          open()
            ? {
                color: 'var(--theme-accent-bright, #34d399)',
                'border-color': 'var(--theme-accent-bright, #34d399)',
                background: 'color-mix(in srgb, var(--theme-accent-bright) 12%, transparent)',
              }
            : {
                color: '#9ca3af',
                'border-color': 'transparent',
              }
        }
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2a10 10 0 0 0 0 20c1.7 0 3-1.3 3-3 0-1.5-1-2-1-3 0-1 .8-2 2-2h1a4 4 0 0 0 4-4 9 9 0 0 0-9-8Z" />
        </svg>
      </button>

      <Show when={open()}>
        <div
          class="absolute right-0 top-full mt-2 z-50 rounded-lg"
          style={{
            width: '360px',
            background: '#080c12',
            border: '1px solid rgba(120, 130, 150, 0.45)',
            'backdrop-filter': 'blur(12px)',
            /* Strong drop shadow so the panel reads CLEARLY above the
             * dim cockpit background. Operator field report 2026-06-10:
             * the prior popover blended with the page. */
            'box-shadow':
              '0 24px 48px -8px rgba(0, 0, 0, 0.75), 0 8px 16px -4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04) inset, 0 0 48px -4px color-mix(in srgb, var(--theme-accent-bright) 18%, transparent)',
          }}
          role="dialog"
          aria-label="Theme & sizes"
        >
          {/* Tab bar + close button */}
          <div class="flex items-stretch border-b border-gray-800/80" role="tablist">
            <TabButton id="theme" active={tab() === 'theme'} onClick={() => setTab('theme')}>Theme</TabButton>
            <TabButton id="colours" active={tab() === 'colours'} onClick={() => setTab('colours')}>Colours</TabButton>
            <TabButton id="sizes" active={tab() === 'sizes'} onClick={() => setTab('sizes')}>Sizes</TabButton>
            <button
              type="button"
              onClick={close}
              title="Close theme picker (Esc)"
              aria-label="Close"
              class="inline-flex items-center justify-center w-9 border-l border-gray-800/80 text-gray-500 hover:text-gray-100 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <Show when={tab() === 'theme'}>
            <ThemeTab />
          </Show>
          <Show when={tab() === 'colours'}>
            <ColoursTab />
          </Show>
          <Show when={tab() === 'sizes'}>
            <SizesTab />
          </Show>

          {/* Reset row */}
          <div class="px-3 py-2 flex justify-between items-center border-t border-gray-800/70">
            <span class="text-[10px] font-mono text-gray-600">
              Saved per browser
            </span>
            <button
              type="button"
              onClick={() => themeStore.resetAll()}
              class="text-[10px] font-mono uppercase tracking-wider text-gray-400 hover:text-gray-100 transition-colors"
            >
              Reset all
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

function TabButton(props: {
  id: Tab;
  active: boolean;
  onClick: () => void;
  children: any;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      class={`flex-1 py-2 text-[11px] font-mono uppercase tracking-wider transition-colors ${
        props.active
          ? 'text-gray-100 border-b-2 border-emerald-400'
          : 'text-gray-500 hover:text-gray-300 border-b-2 border-transparent'
      }`}
    >
      {props.children}
    </button>
  );
}

function ThemeTab() {
  return (
    <div class="px-3 py-3">
      <div class="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-2">
        Preset
      </div>
      <ul class="grid grid-cols-2 gap-1.5">
        <For each={THEME_OPTIONS}>
          {(opt) => (
            <li>
              <button
                type="button"
                onClick={() => themeStore.setThemeId(opt.id)}
                class="w-full flex items-center gap-2 px-2 py-2 rounded text-left text-xs transition-colors hover:bg-gray-800/60"
                style={
                  themeStore.themeId() === opt.id
                    ? {
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(120,130,150,0.40)',
                      }
                    : { border: '1px solid transparent' }
                }
                title={`Apply the ${opt.label} preset`}
              >
                <span class="flex gap-0.5 flex-shrink-0">
                  <For each={opt.swatches}>
                    {(c) => (
                      <span class="w-3 h-3 rounded-full" style={{ background: c }} />
                    )}
                  </For>
                </span>
                <span class="font-mono text-gray-200">{opt.label}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

function ColoursTab() {
  const setUserOverride = (hex: string): void =>
    themeStore.setOverride('--theme-byline-user', hex);
  const setAgentOverride = (hex: string): void =>
    themeStore.setOverride('--theme-byline-agent', hex);
  const setAccentOverride = (hex: string): void =>
    themeStore.setOverride('--theme-accent', hex);

  return (
    <div class="px-3 py-3 space-y-3">
      <ColourRow
        label="Chat — user bubble"
        varName="--theme-byline-user"
        onPick={setUserOverride}
        chips={CHAT_USER_COLOR_CHIPS}
      />
      <ColourRow
        label="Chat — agent bubble"
        varName="--theme-byline-agent"
        onPick={setAgentOverride}
        chips={[
          { hex: '#f3f4f6', label: 'White' },
          { hex: '#86efac', label: 'Emerald' },
          { hex: '#7dd3fc', label: 'Sky' },
          { hex: '#fde68a', label: 'Amber' },
          { hex: '#c4b5fd', label: 'Violet' },
          { hex: '#cbd5e1', label: 'Slate' },
        ]}
      />
      <ColourRow
        label="Accent (project chrome)"
        varName="--theme-accent"
        onPick={setAccentOverride}
        chips={[
          { hex: '#10b981', label: 'Emerald' },
          { hex: '#6366f1', label: 'Indigo' },
          { hex: '#f59e0b', label: 'Amber' },
          { hex: '#94a3b8', label: 'Slate' },
          { hex: '#ec4899', label: 'Pink' },
          { hex: '#22d3ee', label: 'Cyan' },
        ]}
      />
    </div>
  );
}

function ColourRow(props: {
  label: string;
  varName: string;
  onPick: (hex: string) => void;
  chips: readonly { hex: string; label: string }[];
}) {
  const selectedHex = (): string | undefined =>
    themeStore.overrides()[props.varName];
  return (
    <div>
      <div class="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-1.5">
        {props.label}
      </div>
      <div class="flex flex-wrap gap-1.5">
        <For each={props.chips}>
          {(chip) => {
            const selected = (): boolean => selectedHex() === chip.hex;
            return (
              <button
                type="button"
                onClick={() => props.onPick(chip.hex)}
                class="w-6 h-6 rounded-full transition-transform hover:scale-110"
                style={{
                  background: chip.hex,
                  border: selected()
                    ? '2px solid #fff'
                    : '2px solid rgba(255,255,255,0.15)',
                  'box-shadow': selected()
                    ? `0 0 0 2px ${chip.hex}66`
                    : 'none',
                }}
                title={chip.label}
                aria-label={`Set ${props.label} to ${chip.label}`}
              />
            );
          }}
        </For>
        <button
          type="button"
          onClick={() => themeStore.setOverride(props.varName, null)}
          class="w-6 h-6 rounded-full transition-transform hover:scale-110 flex items-center justify-center text-gray-500 hover:text-gray-200"
          style={{ border: '1px dashed rgba(160,160,160,0.40)' }}
          title="Clear override (use preset value)"
          aria-label={`Clear ${props.label} override`}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function SizesTab() {
  return (
    <div class="px-3 py-3 space-y-1.5">
      <For each={SIZE_OPTIONS}>
        {(opt) => (
          <button
            type="button"
            onClick={() => themeStore.setSizeId(opt.id)}
            class="w-full text-left px-2 py-2 rounded transition-colors hover:bg-gray-800/60"
            style={
              themeStore.sizeId() === opt.id
                ? {
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(120,130,150,0.40)',
                  }
                : { border: '1px solid transparent' }
            }
            title={opt.hint}
          >
            <div class="flex items-center justify-between gap-2 mb-1">
              <span class="font-mono text-[12px] text-gray-200">{opt.label}</span>
              <span class="text-[10px] text-gray-500">{opt.hint}</span>
            </div>
            <div class="flex items-baseline gap-3">
              <span
                class="text-gray-300"
                style={{ 'font-size': SIZE_PRESETS[opt.id]['--fs-title'] }}
                aria-label="title sample"
              >
                TITLE
              </span>
              <span
                class="text-gray-300"
                style={{ 'font-size': SIZE_PRESETS[opt.id]['--fs-button'] }}
                aria-label="button sample"
              >
                Button
              </span>
              <span
                class="text-gray-300"
                style={{ 'font-size': SIZE_PRESETS[opt.id]['--fs-body'] }}
                aria-label="body sample"
              >
                Body
              </span>
              <span
                class="text-gray-500 font-mono"
                style={{ 'font-size': SIZE_PRESETS[opt.id]['--fs-meta'] }}
                aria-label="meta sample"
              >
                meta
              </span>
              <span
                class="text-gray-300"
                style={{ 'font-size': SIZE_PRESETS[opt.id]['--fs-chat'] }}
                aria-label="chat sample"
              >
                chat
              </span>
            </div>
          </button>
        )}
      </For>
    </div>
  );
}
