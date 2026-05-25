import { For, JSX, createSignal } from 'solid-js';
import { Modal, ModalButton } from '../components/Modal';

type ModalSpec = {
  key: number;
  title?: string;
  subtitle?: string;
  body?: string | (() => JSX.Element);
  buttons: ModalButton[];
  floating?: boolean;
  onMount?: (bodyEl: HTMLDivElement, close: (id: string | null) => void) => void;
  resolve: (id: string | null) => void;
};

export type McModalOpts = {
  title?: string;
  subtitle?: string;
  body?: string | (() => JSX.Element);
  buttons?: ModalButton[];
  floating?: boolean;
  onMount?: (bodyEl: HTMLDivElement, close: (id: string | null) => void) => void;
};

const [stack, setStack] = createSignal<ModalSpec[]>([]);
let nextKey = 1;

export function mcModal(opts: McModalOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const spec: ModalSpec = {
      key: nextKey++,
      title: opts.title,
      subtitle: opts.subtitle,
      body: opts.body,
      buttons: opts.buttons ?? [{ id: 'ok', label: 'OK', primary: true }],
      floating: opts.floating,
      onMount: opts.onMount,
      resolve,
    };
    setStack((s) => [...s, spec]);
  });
}

function closeSpec(key: number, id: string | null): void {
  const spec = stack().find((s) => s.key === key);
  if (!spec) return;
  setStack((s) => s.filter((x) => x.key !== key));
  spec.resolve(id);
}

export function mcAlert(
  message: string,
  opts: { title?: string; subtitle?: string; okLabel?: string } = {},
): Promise<string | null> {
  return mcModal({
    title: opts.title ?? 'Notice',
    subtitle: opts.subtitle,
    body: `<p class="leading-relaxed whitespace-pre-line">${esc(message)}</p>`,
    buttons: [{ id: 'ok', label: opts.okLabel ?? 'OK', primary: true }],
  });
}

export async function mcConfirm(
  message: string,
  opts: { title?: string; okLabel?: string; cancelLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  const id = await mcModal({
    title: opts.title ?? 'Confirm',
    body: `<p class="leading-relaxed whitespace-pre-line">${esc(message)}</p>`,
    buttons: [
      { id: 'no', label: opts.cancelLabel ?? 'Cancel' },
      {
        id: 'yes',
        label: opts.okLabel ?? 'Confirm',
        primary: !opts.danger,
        danger: opts.danger,
      },
    ],
  });
  return id === 'yes';
}

export async function mcPromptText(
  message: string,
  opts: {
    title?: string;
    default?: string;
    placeholder?: string;
    password?: boolean;
    okLabel?: string;
  } = {},
): Promise<string | null> {
  let value: string | null = null;
  const id = await mcModal({
    title: opts.title ?? 'Input',
    body: `
      <div class="space-y-2">
        <p class="leading-relaxed">${esc(message)}</p>
        <input id="mc-prompt-input" type="${opts.password ? 'password' : 'text'}" class="w-full bg-gray-950 border border-gray-800 rounded-md px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-emerald-500/40" placeholder="${esc(opts.placeholder ?? '')}" value="${esc(opts.default ?? '')}">
      </div>`,
    buttons: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'ok', label: opts.okLabel ?? 'OK', primary: true },
    ],
    onMount: (bodyEl, close) => {
      const inp = bodyEl.querySelector<HTMLInputElement>('#mc-prompt-input');
      if (!inp) return;
      inp.focus();
      inp.select();
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          value = inp.value;
          close('ok');
        }
      });
      const okBtn = bodyEl.parentElement?.querySelector<HTMLButtonElement>('[data-mc-btn="ok"]');
      okBtn?.addEventListener('click', () => {
        value = inp.value;
      });
    },
  });
  return id === 'ok' ? value : null;
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c] ?? c;
  });
}

export function ModalHost(): JSX.Element {
  return (
    <For each={stack()}>
      {(spec, i) => (
        <Modal
          isOpen={true}
          onClose={(id) => closeSpec(spec.key, id)}
          title={spec.title}
          subtitle={spec.subtitle}
          buttons={spec.buttons}
          floating={spec.floating}
          zIndex={50 + i() * 10}
          bodyRef={(el) => {
            if (typeof spec.body === 'string') el.innerHTML = spec.body;
            if (spec.onMount) {
              queueMicrotask(() =>
                spec.onMount?.(el, (id) => closeSpec(spec.key, id)),
              );
            }
          }}
        >
          {typeof spec.body === 'function' ? spec.body() : null}
        </Modal>
      )}
    </For>
  );
}
