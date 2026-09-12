/**
 * QuotaExceededNotice — pretty centered card replacing the raw
 * "[x error] API error 429 …" dump when a provider run dies on
 * rate-limit / out-of-credit. Amber card, reset time + countdown
 * when the text carries one; raw text kept in a <details> for proof.
 */

import { Show } from 'solid-js';
import { detectQuotaError, resetCountdown, type QuotaInfo } from './quota-error';

function fmtLocal(d: Date): string {
  return d.toLocaleString([], {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function QuotaExceededNotice(props: { text: string }) {
  const info = (): QuotaInfo | null => detectQuotaError(props.text);
  return (
    <Show when={info()}>
      {(q) => (
        <div class="w-full flex justify-center py-2">
          <div
            role="alert"
            class="max-w-[420px] w-full rounded-xl border border-amber-500/50 px-5 py-4 text-center shadow-lg"
            style={{ background: 'rgba(120, 53, 15, 0.28)' }}
          >
            <div class="text-2xl leading-none" aria-hidden="true">⏳</div>
            <p class="mt-2 font-semibold text-amber-200 text-[15px]">
              Cuota excedida · Rate limit
            </p>
            <Show when={q().provider}>
              <p class="mt-0.5 font-mono text-[11px] uppercase tracking-widest text-amber-100/60">
                {q().provider}
              </p>
            </Show>
            <Show
              when={q().resetsAt}
              fallback={
                <Show when={q().rawReset} fallback={
                  <p class="mt-1.5 text-[12.5px] text-amber-100/75">
                    Se renueva automáticamente — prueba de nuevo en unos minutos.
                  </p>
                }>
                  <p class="mt-1.5 text-[12.5px] text-amber-100/85">
                    Se renueva: <span class="font-mono">{q().rawReset}</span>
                  </p>
                </Show>
              }
            >
              {(d) => (
                <p class="mt-1.5 text-[12.5px] text-amber-100/85">
                  Se renueva: <span class="font-semibold text-amber-100">{fmtLocal(d())}</span>
                  <Show when={resetCountdown(d())}>
                    {(c) => <span class="text-amber-100/60"> ({c()})</span>}
                  </Show>
                </p>
              )}
            </Show>
            <details class="mt-2.5 text-left">
              <summary class="cursor-pointer font-mono text-[10.5px] text-amber-100/50 hover:text-amber-100/80">
                detalle del proveedor
              </summary>
              <pre class="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 font-mono text-[10.5px] leading-relaxed text-gray-400">
                {props.text}
              </pre>
            </details>
          </div>
        </div>
      )}
    </Show>
  );
}

export default QuotaExceededNotice;
