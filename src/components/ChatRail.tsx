/**
 * ChatRail — vertical column of agent cards left of the chat panel.
 *
 * Source of truth: `chatStore.state.convMap` + `convMeta` + `archivedConvs`
 * + `agentStatus`. Default order is "custom agents first (by recency),
 * then service agents". Operator-applied drag order is persisted to
 * localStorage under `meshcore-rail-order` (the V80 monolith key, so
 * existing operators don't lose their layout when the cockpit flips
 * to the Solid port).
 *
 * The empty-state "synthetic onboarding card" renders when there are
 * no convs yet — a stripe-coloured prompt that opens the new-agent
 * flow. It matches the monolith look so the V46 force-rebuild flow
 * is visually consistent.
 */

import { For, Show, createMemo, createSignal } from 'solid-js';
import { chatStore, type ConvMeta } from '~/state/chat';
import AgentCard from '~/components/AgentCard';
import { agentTypeColor, isServiceType } from '~/lib/agent-types';

const RAIL_ORDER_KEY = 'meshcore-rail-order';

function stripe(meta: ConvMeta): string {
  return agentTypeColor(meta.type);
}

function isService(meta: ConvMeta | undefined): boolean {
  return isServiceType(meta?.type);
}

function loadRailOrder(): string[] {
  try {
    const raw = localStorage.getItem(RAIL_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

function saveRailOrder(order: string[]): void {
  try { localStorage.setItem(RAIL_ORDER_KEY, JSON.stringify(order)); } catch { /* quota */ }
}

export default function ChatRail(props: { onNewAgent?: () => void }) {
  const [order, setOrder] = createSignal<string[]>(loadRailOrder());
  const [dragSrc, setDragSrc] = createSignal<string | null>(null);
  const [dragTgt, setDragTgt] = createSignal<string | null>(null);

  const orderedConvs = createMemo(() => {
    const all = Object.keys(chatStore.state.convMap).filter((c) => !chatStore.state.archivedConvs[c]);
    all.forEach((c) => chatStore.ensureConvMeta(c));
    const byRecency = (a: string, b: string) => {
      const aLast = (chatStore.state.convMap[a] ?? []).at(-1)?.ts ?? '';
      const bLast = (chatStore.state.convMap[b] ?? []).at(-1)?.ts ?? '';
      return bLast.localeCompare(aLast);
    };
    const custom = all.filter((c) => !isService(chatStore.state.convMeta[c])).sort(byRecency);
    const services = all.filter((c) => isService(chatStore.state.convMeta[c])).sort(byRecency);
    const defaults = [...custom, ...services];
    const positioned = order().filter((id) => all.includes(id));
    const unpositioned = defaults.filter((id) => !positioned.includes(id));
    return [...positioned, ...unpositioned];
  });

  const statusOf = (conv: string) => {
    const meta = chatStore.state.convMeta[conv];
    if (meta?.agentId) {
      const s = chatStore.state.agentStatus[meta.agentId];
      if (s && (s.state === 'working' || s.state === 'thinking')) return 'working' as const;
    }
    const list = chatStore.state.convMap[conv] ?? [];
    const streaming = list.some((m) => m.kind === 'assistant' && m.streaming);
    return streaming ? ('working' as const) : ('idle' as const);
  };

  const select = (c: string) => chatStore.setActiveConv(c);

  const drop = (target: string) => {
    const src = dragSrc();
    setDragSrc(null);
    setDragTgt(null);
    if (!src || src === target) return;
    const current = [...orderedConvs()];
    const si = current.indexOf(src);
    if (si < 0) return;
    current.splice(si, 1);
    const ti = current.indexOf(target);
    current.splice(ti >= 0 ? ti : current.length, 0, src);
    setOrder(current);
    saveRailOrder(current);
  };

  return (
    <div class="flex flex-col gap-2 h-full min-h-0 w-[200px] flex-shrink-0">
      <div class="flex items-center justify-between px-1">
        <span class="text-[10px] font-mono uppercase tracking-wider text-gray-500">Agents</span>
        <button
          type="button"
          onClick={() => props.onNewAgent?.()}
          class="w-6 h-6 rounded-md border border-emerald-500/30 text-emerald-300 hover:border-emerald-500/55 hover:bg-emerald-500/15 transition flex items-center justify-center text-base leading-none"
          title="New agent / conversation"
        >＋</button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto pr-1 flex flex-col gap-1.5">
        <For each={orderedConvs()}>
          {(c) => {
            const meta = () => chatStore.ensureConvMeta(c);
            return (
              <AgentCard
                conv={c}
                meta={meta()}
                active={chatStore.state.activeConv === c}
                status={statusOf(c)}
                pendingReview={false}
                stripe={stripe(meta())}
                onSelect={select}
                onDragStart={(id) => setDragSrc(id)}
                onDragEnd={() => { setDragSrc(null); setDragTgt(null); }}
                onDragOver={(id) => setDragTgt(id)}
                onDragLeave={(id) => { if (dragTgt() === id) setDragTgt(null); }}
                onDrop={(id) => drop(id)}
                dragOver={dragTgt() === c && dragSrc() !== null && dragSrc() !== c}
                dragging={dragSrc() === c}
              />
            );
          }}
        </For>
        <Show when={orderedConvs().length === 0}>
          <button
            type="button"
            onClick={() => props.onNewAgent?.()}
            class="text-left rounded-md border border-dashed border-emerald-500/35 bg-emerald-500/5 px-3 py-3 hover:border-emerald-500/55"
            style={{ 'border-left': `3px solid ${agentTypeColor('custom')}` }}
            title="Create the first agent for this cluster"
          >
            <div class="text-[11px] font-mono text-emerald-300 mb-1">⬢ General coder</div>
            <div class="text-[11px] text-gray-400 leading-snug">
              No agents yet. Click ＋ above (or this card) to start the first conversation.
            </div>
          </button>
        </Show>
      </div>
    </div>
  );
}
