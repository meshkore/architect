/**
 * ThemePicker — small palette-icon button that opens a popover with
 * the theme presets + a chat-user colour override.
 *
 * Hosted in `Header.tsx` next to the daemon-live chip. Operator
 * request 2026-06-10:
 *
 *   "Cuando acabes, podemos poner ahí un pequeño icono que marque
 *    varias paletas de colores? Hay gente a quien no le gusta el
 *    verde."
 *
 * Initiative `cockpit-themes`, task THM-04.
 */

import { createSignal, onCleanup, For, Show } from 'solid-js';
import { themeStore } from '~/state/theme';
import {
  THEME_OPTIONS,
  CHAT_USER_COLOR_CHIPS,
  type ThemeId,
} from '~/lib/theme-presets';

export default function ThemePicker() {
  const [open, setOpen] = createSignal(false);
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

  const pickPreset = (id: ThemeId): void => {
    themeStore.setThemeId(id);
    close();
  };
  const pickUserChip = (hex: string): void => {
    themeStore.setOverride('--theme-byline-user', hex);
  };
  const resetAll = (): void => {
    themeStore.resetOverrides();
  };

  return (
    <div ref={hostEl} class="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        title="Theme & palette"
        aria-label="Open theme picker"
        class="inline-flex items-center justify-center w-7 h-7 rounded border border-transparent hover:border-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
      >
        {/* Palette icon */}
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
          class="absolute right-0 top-full mt-2 z-50 w-64 rounded-lg shadow-xl"
          style={{
            background: 'rgba(10, 13, 18, 0.98)',
            border: '1px solid rgba(120, 130, 150, 0.30)',
            'backdrop-filter': 'blur(6px)',
          }}
          role="dialog"
          aria-label="Theme picker"
        >
          {/* Presets */}
          <div class="px-3 py-2.5 border-b border-gray-800/60">
            <div class="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-2">
              Preset
            </div>
            <ul class="grid grid-cols-2 gap-1.5">
              <For each={THEME_OPTIONS}>
                {(opt) => (
                  <li>
                    <button
                      type="button"
                      onClick={() => pickPreset(opt.id)}
                      class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors hover:bg-gray-800/60"
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
                            <span
                              class="w-3 h-3 rounded-full"
                              style={{ background: c }}
                            />
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

          {/* Chat user-bubble colour */}
          <div class="px-3 py-2.5 border-b border-gray-800/60">
            <div class="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-2">
              Chat — user bubble
            </div>
            <div class="flex flex-wrap gap-1.5">
              <For each={CHAT_USER_COLOR_CHIPS}>
                {(chip) => {
                  const selected = (): boolean =>
                    themeStore.overrides()['--theme-byline-user'] === chip.hex;
                  return (
                    <button
                      type="button"
                      onClick={() => pickUserChip(chip.hex)}
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
                      aria-label={`Set user bubble colour to ${chip.label}`}
                    />
                  );
                }}
              </For>
            </div>
          </div>

          {/* Reset */}
          <div class="px-3 py-2 flex justify-between items-center">
            <span class="text-[10px] font-mono text-gray-600">
              Saved per browser
            </span>
            <button
              type="button"
              onClick={resetAll}
              class="text-[10px] font-mono uppercase tracking-wider text-gray-400 hover:text-gray-100 transition-colors"
            >
              Reset overrides
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
