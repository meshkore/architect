/**
 * GeneralConfigDrawer — right slide-over hosting the MACHINE-LEVEL settings
 * (GeneralConfigPanel). Opened by the gear button in the header, beside the
 * theme picker; both are cross-project surfaces that come in from the right
 * over the work area and hide on close, so they never take a permanent slot.
 *
 * MUST render through a <Portal> (mounts to document.body): the header it's
 * triggered from has `backdrop-blur-xl` (a `backdrop-filter`), and per the
 * CSS Filter Effects spec any element with an active `filter`/`backdrop-filter`
 * establishes a new containing block for its `position: fixed` descendants —
 * so a fixed-position drawer nested inside that header was being pinned to
 * the 48px header box instead of the viewport (visible bug: a narrow strip
 * near the top, page content showing through underneath). Portal escapes
 * that trap the same way Modal.tsx already does.
 *
 * Always mounted (no <Show>) so the close transition can actually play: the
 * backdrop fades and the panel slides out via `translate-x-full` instead of
 * vanishing instantly, then the wrapper turns `pointer-events-none` so it
 * never blocks clicks on the page behind it while hidden.
 */

import { createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import GeneralConfigPanel from '~/components/GeneralConfigPanel';

export default function GeneralConfigDrawer(props: { open: boolean; onClose: () => void }) {
  // Esc-to-close, only while open (listener attached/detached with the flag).
  createEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  return (
    <Portal>
      {/* z-[9999] — deliberately above every other overlay in the app
          (modals/panels here top out at z-[60]) so this sits above
          absolutely everything, as requested. */}
      <div
        class="fixed inset-0 z-[9999]"
        classList={{ 'pointer-events-none': !props.open }}
        aria-hidden={!props.open}
      >
        <div
          class="absolute inset-0 bg-black/70 transition-opacity duration-200 ease-out"
          classList={{ 'opacity-100': props.open, 'opacity-0': !props.open }}
          onClick={props.onClose}
          aria-hidden="true"
        />
        <aside
          class="absolute right-0 top-0 h-full w-full max-w-2xl bg-black border-l border-gray-800 shadow-2xl flex flex-col transition-transform duration-200 ease-out"
          classList={{ 'translate-x-0': props.open, 'translate-x-full': !props.open }}
          role="dialog"
          aria-label="General settings"
          aria-modal="true"
        >
          <header class="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-800 flex-shrink-0">
            <div class="min-w-0">
              <h2 class="text-[15px] font-semibold text-gray-100">General settings</h2>
              <p class="text-[11px] text-gray-500 mt-0.5 leading-snug">
                Machine-level — the one shared daemon on this Mac. Applies to
                every project.
              </p>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              class="text-gray-400 hover:text-gray-100 px-2 py-1 flex-shrink-0"
              aria-label="Close (Esc)"
              title="Close (Esc)"
            >✕</button>
          </header>
          <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            <GeneralConfigPanel />
          </div>
        </aside>
      </div>
    </Portal>
  );
}
