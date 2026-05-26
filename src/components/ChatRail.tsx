import { For, Show, createMemo, createSignal } from 'solid-js';
import { chatStore, ONBOARDING_CONV_ID, type ConvMeta } from '~/state/chat';
import { isProjectEmpty } from '~/state/server';
import AgentCard from '~/components/AgentCard';
import { agentTypeColor, isServiceType } from '~/lib/agent-types';
import { loadRailOrder, saveRailOrder } from './chat/rail-order';

const isService = (meta: ConvMeta | undefined) => isServiceType(meta?.type);

export default function ChatRail(props: { onNewAgent?: () => void }) {
  const [order, setOrder] = createSignal<string[]>(loadRailOrder());
  const [dragSrc, setDragSrc] = createSignal<string | null>(null);
  const [dragTgt, setDragTgt] = createSignal<string | null>(null);

  const orderedConvs = createMemo(() => {
    const all = Object.keys(chatStore.state.convMap).filter((c) => {
      if (chatStore.state.archivedConvs[c]) return false;
      // Synthetic Coordinator card retires once real initiatives appear
      // AND the operator hasn't sent any real message in it yet (M6.6).
      if (c === ONBOARDING_CONV_ID && !isProjectEmpty() && !chatStore.onboardingHasUserMessages()) return false;
      return true;
    });
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
    <aside class="chat-rail-stack">
      <div class="chat-rail-header">
        <span class="chat-rail-header-label">Agents</span>
        <button
          type="button"
          onClick={() => props.onNewAgent?.()}
          class="chat-rail-new-btn"
          title="New agent / conversation"
        >＋</button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto chat-rail-pinned">
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
                stripe={agentTypeColor(meta().type)}
                onSelect={chatStore.setActiveConv}
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
            onClick={() => {
              // V46 onboarding flow: clicking the synthetic Coordinator
              // card seeds + activates the onboarding conv so the chat
              // opens with the welcome bubble + composer. The "+" button
              // up top is the wizard path; the empty-state card is the
              // "talk to the coordinator now" shortcut.
              chatStore.seedOnboardingConv();
              chatStore.setActiveConv(ONBOARDING_CONV_ID);
            }}
            class="text-left rounded-md border border-dashed border-emerald-500/35 bg-emerald-500/5 px-3 py-3 hover:border-emerald-500/55"
            /* dynamic: stripe colour pulled from the agent-type registry */
            style={{ 'border-left': `3px solid ${agentTypeColor('custom')}` }}
            title="Talk to the Coordinator — kicks off the project's roadmap"
          >
            <div class="text-[11px] font-mono text-emerald-300 mb-1">⬢ General coder</div>
            <div class="text-[11px] text-gray-400 leading-snug">
              No agents yet. Click here to talk to the Coordinator and scaffold the roadmap, or use ＋ above to create a typed agent.
            </div>
          </button>
        </Show>
      </div>
    </aside>
  );
}
