import { For, JSX, Show, createEffect, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';

export type ModalButton = {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
};

export type ModalProps = {
  isOpen: boolean;
  onClose: (id: string | null) => void;
  title?: string;
  subtitle?: string;
  /** 2026-06-13 — when provided, renders in place of the `subtitle`
   *  string. Lets a caller put an inline-editable field (e.g. the
   *  agent title) directly in the modal header. */
  subtitleNode?: JSX.Element;
  buttons?: ModalButton[];
  floating?: boolean;
  zIndex?: number;
  children?: JSX.Element;
  bodyRef?: (el: HTMLDivElement) => void;
};

const FOOTER_BTN_BASE = 'px-3.5 py-2 rounded text-sm transition';

function btnCls(b: ModalButton): string {
  if (b.primary) {
    return `${FOOTER_BTN_BASE} bg-emerald-500 text-gray-950 font-semibold hover:bg-emerald-400`;
  }
  if (b.danger) {
    return `${FOOTER_BTN_BASE} bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25`;
  }
  return `${FOOTER_BTN_BASE} bg-gray-900 text-gray-300 border border-gray-800 hover:border-gray-700`;
}

export function Modal(props: ModalProps): JSX.Element {
  createEffect(() => {
    if (!props.isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose(null);
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  const onBackdropClick = (e: MouseEvent) => {
    if (props.floating) return;
    if (e.target === e.currentTarget) props.onClose(null);
  };

  return (
    <Show when={props.isOpen}>
      <Portal mount={document.body}>
        <div
          class={
            props.floating
              ? 'fixed inset-0 flex items-center justify-center p-4 pointer-events-none'
              : 'fixed inset-0 flex items-center justify-center p-4 bg-[rgba(2,4,12,0.78)] backdrop-blur'
          }
          /* dynamic: callers can stack modals via props.zIndex */
          style={{ 'z-index': String(props.zIndex ?? 50) }}
          onClick={onBackdropClick}
        >
          <div class="w-full max-w-2xl max-h-[90vh] bg-[#0b1220] border border-gray-700/40 rounded-2xl shadow-2xl grid grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden pointer-events-auto">
            <header class="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-gray-800/60">
              <div class="flex-1 min-w-0">
                <Show when={props.title}>
                  <h2 class="text-base font-semibold text-gray-100 truncate">{props.title}</h2>
                </Show>
                <Show when={props.subtitleNode} fallback={
                  <Show when={props.subtitle}>
                    <p class="text-xs text-gray-400 mt-0.5 truncate">{props.subtitle}</p>
                  </Show>
                }>
                  <div class="mt-1">{props.subtitleNode}</div>
                </Show>
              </div>
              <button
                type="button"
                aria-label="Close"
                class="text-gray-400 hover:text-gray-100 px-2 py-1 rounded transition"
                onClick={() => props.onClose(null)}
              >
                ✕
              </button>
            </header>
            <div
              class="px-5 py-4 overflow-y-auto min-h-0 text-gray-300"
              ref={(el) => props.bodyRef?.(el)}
            >
              {props.children}
            </div>
            <Show when={props.buttons && props.buttons.length > 0}>
              <footer class="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-800/60 bg-gray-950/40">
                <For each={props.buttons}>
                  {(b) => (
                    <button
                      type="button"
                      data-mc-btn={b.id}
                      class={btnCls(b)}
                      onClick={() => props.onClose(b.id)}
                    >
                      {b.label}
                    </button>
                  )}
                </For>
              </footer>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
