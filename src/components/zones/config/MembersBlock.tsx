import { createEffect, createSignal, For, Show } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { mcAlert } from '~/lib/modal';
import { log } from '~/lib/log';
import { Block, Btn } from './atoms';

interface AdmissionEntry { id: string; identity?: string; hostname?: string; requested_at?: string }

function asEntries(rows: unknown[] | undefined): AdmissionEntry[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is AdmissionEntry =>
    !!r && typeof r === 'object' && typeof (r as AdmissionEntry).id === 'string');
}

export function MembersBlock() {
  const [pending, setPending] = createSignal<AdmissionEntry[]>([]);
  const [stub, setStub] = createSignal<string | null>(null);

  async function refresh() {
    const c = daemonStore.state.client;
    if (!c) return;
    const r = await c.admissionList();
    if (r.ok) {
      setPending(asEntries(r.data.pending));
      setStub(null);
      return;
    }
    // 501 is the daemon saying "this flow isn't implemented here" — a
    // capability gap to explain, not a failure to alarm about.
    if (r.status === 501) { setStub('Admission flow not implemented yet on this daemon.'); return; }
    setStub(`/admission/list → ${r.status}`);
    log.warn('admission refresh', { status: r.status });
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    const c = daemonStore.state.client;
    if (!c) return;
    const r = await c.admissionDecide(action, id);
    if (!r.ok) { void mcAlert(`${action} failed: ${r.status}`, { title: 'Error' }); return; }
    void refresh();
  }

  // V107.2 — Reactive refresh on project swap. `daemonStore.state.client`
  // is the canonical swap signal. Reset local state + refetch every time
  // it changes (including first mount). Previously used onMount which
  // froze the panel on the first cluster's admission list.
  createEffect(() => {
    const c = daemonStore.state.client;
    setPending([]);
    setStub(null);
    if (!c) return;
    void refresh();
  });

  return (
    <Block title="Members & admission" subtitle="Approve / reject device join requests.">
      <Show when={stub()}><p class="text-[12px] text-gray-500 leading-relaxed">{stub()}</p></Show>
      <Show when={!stub() && pending().length === 0}><p class="text-[12px] text-gray-600">No pending admission requests.</p></Show>
      <Show when={!stub() && pending().length > 0}>
        <ul class="space-y-2">
          <For each={pending()}>{(e) => (
            <li class="flex items-center gap-3 bg-gray-950 border border-gray-800 rounded-md px-3 py-2">
              <div class="flex-1 min-w-0">
                <p class="text-[12px] text-gray-200 font-mono truncate">{e.identity ?? e.id}</p>
                <p class="text-[11px] text-gray-600 truncate">{e.hostname ?? ''} · {e.requested_at ?? ''}</p>
              </div>
              <Btn onClick={() => decide(e.id, 'approve')}>approve</Btn>
              <Btn onClick={() => decide(e.id, 'reject')} danger>reject</Btn>
            </li>
          )}</For>
        </ul>
      </Show>
    </Block>
  );
}
