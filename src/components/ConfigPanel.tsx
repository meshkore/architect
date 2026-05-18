/**
 * ConfigPanel — read-only view over the current daemon configuration
 * (cluster meta + connection diagnostics). Useful for verifying that
 * the cockpit is actually talking to the daemon you think it is.
 */

import { Show, For } from 'solid-js';
import type { DaemonClient } from '~/lib/daemon-client';
import { store } from '~/state/store';

export default function ConfigPanel(props: { client: DaemonClient }) {
  return (
    <section class="min-w-0 max-w-3xl">
      <h2 class="text-sm font-mono uppercase tracking-wider text-gray-500 mb-4">Config &amp; diagnostics</h2>

      <Block title="Transport">
        <KV k="kind" v={props.client.transport.kind} />
        <KV k="httpBase" v={props.client.transport.httpBase} />
        <KV k="wsBase" v={props.client.transport.wsBase} />
        <KV k="label" v={props.client.transport.label} />
      </Block>

      <Block title="Cluster">
        <KV k="id" v={store.cluster().id ?? '—'} />
        <KV k="name" v={store.cluster().name ?? '—'} />
        <KV k="type" v={store.cluster().type ?? '—'} />
      </Block>

      <Block title="Live stream">
        <KV k="ws state" v={store.wsState()} />
        <KV k="events buffered" v={String(store.events().length)} />
        <KV k="snapshot generated_at" v={store.snapshot.generated_at ?? '—'} />
      </Block>

      <Block title="Recent events (last 8)">
        <ul class="space-y-1 text-[11px] font-mono">
          <For each={store.events().slice(-8).reverse()}>
            {(ev) => (
              <li class="flex gap-2 text-gray-500">
                <span class="text-gray-600 w-16 flex-shrink-0">{String(ev.ts ?? '').slice(11, 19)}</span>
                <span class="text-emerald-400">{ev.type}</span>
                <Show when={ev['conv']}>
                  <span class="text-gray-600">conv={String(ev['conv'])}</span>
                </Show>
              </li>
            )}
          </For>
          <Show when={store.events().length === 0}>
            <li class="text-gray-600">No events yet.</li>
          </Show>
        </ul>
      </Block>
    </section>
  );
}

function Block(props: { title: string; children: any }) {
  return (
    <div class="bg-gray-900/40 border border-gray-800/60 rounded-lg p-4 mb-4">
      <h3 class="text-xs font-mono uppercase tracking-wider text-gray-500 mb-3">{props.title}</h3>
      {props.children}
    </div>
  );
}

function KV(props: { k: string; v: string }) {
  return (
    <div class="flex gap-3 py-0.5">
      <span class="text-gray-600 font-mono text-xs min-w-[12rem]">{props.k}</span>
      <span class="text-gray-200 font-mono text-xs break-all">{props.v}</span>
    </div>
  );
}
