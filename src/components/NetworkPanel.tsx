/**
 * NetworkPanel — live view of declared agents + their online state.
 * Polls `/agents` on demand and reflects `agent.online`/`agent.offline`
 * events from the WS stream.
 */

import { For, Show, createResource, createMemo } from 'solid-js';
import type { DaemonClient } from '~/lib/daemon-client';
import { store } from '~/state/store';

interface AgentInfo {
  identity?: string;
  pid?: number | null;
  online?: boolean;
  [k: string]: unknown;
}

export default function NetworkPanel(props: { client: DaemonClient }) {
  const [agents, { refetch }] = createResource(async () => {
    try {
      return await props.client.agents() as AgentInfo[];
    } catch {
      return [] as AgentInfo[];
    }
  });

  // Patch agent presence from live events without refetching.
  const overlays = createMemo(() => {
    const live = new Map<string, boolean>();
    for (const ev of store.events()) {
      if (ev.type === 'agent.online' && ev['identity']) live.set(String(ev['identity']), true);
      if (ev.type === 'agent.offline' && ev['identity']) live.set(String(ev['identity']), false);
    }
    return live;
  });

  const merged = createMemo<AgentInfo[]>(() => {
    const base = (agents() ?? []) as AgentInfo[];
    const ov = overlays();
    return base.map((a) => {
      if (a.identity && ov.has(a.identity)) {
        return { ...a, online: ov.get(a.identity) ?? a.online };
      }
      return a;
    });
  });

  return (
    <section class="min-w-0">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-mono uppercase tracking-wider text-gray-500">Network · Declared agents</h2>
        <button
          type="button"
          onClick={() => refetch()}
          class="text-xs text-gray-500 hover:text-emerald-400"
        >
          refresh
        </button>
      </div>
      <Show when={merged().length > 0} fallback={<EmptyAgents />}>
        <ul class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <For each={merged()}>
            {(a) => <AgentCard agent={a} />}
          </For>
        </ul>
      </Show>
    </section>
  );
}

function AgentCard(props: { agent: AgentInfo }) {
  return (
    <li class="bg-gray-900/40 border border-gray-800/60 rounded-lg p-4">
      <div class="flex items-center gap-2 mb-2">
        <span class={`w-2 h-2 rounded-full ${props.agent.online ? 'bg-emerald-400 animate-pulse-soft' : 'bg-gray-600'}`} />
        <span class="font-mono text-sm text-gray-100">{props.agent.identity ?? 'unknown'}</span>
        <Show when={props.agent.online}>
          <span class="ml-auto text-[10px] font-mono uppercase tracking-wider text-emerald-300">online</span>
        </Show>
      </div>
      <Show when={props.agent.pid}>
        <div class="text-[11px] text-gray-500 font-mono">pid <span class="text-gray-300">{props.agent.pid}</span></div>
      </Show>
    </li>
  );
}

function EmptyAgents() {
  return (
    <p class="text-sm text-gray-500 px-2 leading-relaxed">
      No declared agents yet. Add YAML files under <span class="font-mono">.meshkore/agents/</span> and run <span class="font-mono">meshcore reload</span>.
    </p>
  );
}
