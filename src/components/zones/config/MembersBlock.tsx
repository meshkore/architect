import { createSignal, For, Show, onMount } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { mcAlert } from '~/lib/modal';
import { log } from '~/lib/log';
import { Block, Btn } from './atoms';

interface AdmissionEntry { id: string; identity?: string; hostname?: string; requested_at?: string }

export function MembersBlock() {
  const [pending, setPending] = createSignal<AdmissionEntry[]>([]);
  const [stub, setStub] = createSignal<string | null>(null);

  async function refresh() {
    const c = daemonStore.state.client;
    if (!c) return;
    try {
      const headers: Record<string, string> = c.transport.token ? { authorization: `Bearer ${c.transport.token}` } : {};
      const r = await fetch(`${c.transport.httpBase}/admission/list`, { headers });
      if (r.status === 501) { setStub('Admission flow not implemented yet on this daemon.'); return; }
      if (!r.ok) { setStub(`/admission/list → ${r.status}`); return; }
      const data = await r.json() as { pending?: AdmissionEntry[] };
      setPending(data.pending ?? []);
      setStub(null);
    } catch (e) { log.warn('admission refresh', e instanceof Error ? e.message : String(e)); }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    const c = daemonStore.state.client;
    if (!c) return;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (c.transport.token) headers.authorization = `Bearer ${c.transport.token}`;
    const r = await fetch(`${c.transport.httpBase}/admission/${action}/${encodeURIComponent(id)}`, { method: 'POST', headers, body: '{}' });
    if (!r.ok) { void mcAlert(`${action} failed: ${r.status}`, { title: 'Error' }); return; }
    void refresh();
  }

  onMount(refresh);

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
