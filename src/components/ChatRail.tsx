import { For, Show, createMemo, createSignal } from 'solid-js';
import { chatStore, ONBOARDING_CONV_ID, type ConvMeta } from '~/state/chat';
import AgentCard from '~/components/AgentCard';
import { agentVisualColor, isServiceType } from '~/lib/agent-types';
import { uiStore } from '~/state/ui';
import { loadRailOrder, saveRailOrder } from './chat/rail-order';

// V86o — when the rail is narrower than this, AgentCard switches to its
// compact layout: only the id chip + a status dot, no chips / no title.
// 130 was picked by visual inspection — narrower than that and the
// id-chip + agent-type chip + location chip overflow on one line.
const COMPACT_THRESHOLD_PX = 130;

const isService = (meta: ConvMeta | undefined) => isServiceType(meta?.type);

export default function ChatRail(props: { onNewAgent?: () => void }) {
  const [order, setOrder] = createSignal<string[]>(loadRailOrder());
  const [dragSrc, setDragSrc] = createSignal<string | null>(null);
  const [dragTgt, setDragTgt] = createSignal<string | null>(null);

  const orderedConvs = createMemo(() => {
    // Master is always-on, ALWAYS at the top.
    if (!chatStore.state.convMap[ONBOARDING_CONV_ID]) {
      chatStore.seedOnboardingConv();
    }
    const snapshotConvs = chatStore.state.convs;
    const all = Object.keys(snapshotConvs).filter((c) => !snapshotConvs[c]?.archived);
    if (!all.includes(ONBOARDING_CONV_ID)) all.push(ONBOARDING_CONV_ID);
    all.forEach((c) => chatStore.ensureConvMeta(c));
    const byRecency = (a: string, b: string) => {
      const aLast = snapshotConvs[a]?.last_activity_at ?? '';
      const bLast = snapshotConvs[b]?.last_activity_at ?? '';
      return bLast.localeCompare(aLast);
    };
    // py-1.12.1-cockpit — Rail order, top to bottom:
    //   1. Master (_onboarding_v1) — pinned first
    //   2. Roadmap Architect — pinned second; the coordinator stays
    //      above the workers it dispatches. Without this pin the new
    //      work-* conv (more recent activity) pushed the architect
    //      down on every dispatch — confusing, since the architect IS
    //      the parent. Operator's request 2026-05-31.
    //   3. Workers + custom agents — by recency
    //   4. Other service types (deploy/db/testing/audit/docs/review) — by recency
    const isArchitect = (c: string): boolean => {
      const s = snapshotConvs[c];
      if (s?.agent_type === 'roadmap-architect') return true;
      return c.startsWith('roadmap-architect-');
    };
    const rest = all.filter((c) => c !== ONBOARDING_CONV_ID);
    const architects = rest.filter(isArchitect).sort(byRecency);
    const others = rest.filter((c) => !isArchitect(c));
    const custom = others.filter((c) => !isService(chatStore.state.convMeta[c])).sort(byRecency);
    const services = others.filter((c) => isService(chatStore.state.convMeta[c])).sort(byRecency);
    const defaults = [ONBOARDING_CONV_ID, ...architects, ...custom, ...services];
    // Drag-saved order respected, BUT Master + architect stay pinned
    // in slots 0+1 regardless. Workers can be reordered freely below.
    const pinned = new Set<string>([ONBOARDING_CONV_ID, ...architects]);
    const positioned = order().filter((id) => all.includes(id) && !pinned.has(id));
    const unpositioned = defaults.filter((id) => !pinned.has(id) && !positioned.includes(id));
    return [ONBOARDING_CONV_ID, ...architects, ...positioned, ...unpositioned];
  });

  const statusOf = (conv: string) => {
    // py-1.11.0 — chat-state-rearchitecture. Single source of truth:
    // the daemon's `live` OR `coordinating` flag on the conv summary.
    // No more OR-ing across heuristics — the daemon computes both
    // server-side and pushes deltas via `conv.activity` WS events.
    const summary = chatStore.state.convs[conv];
    if (!summary) return 'idle' as const;
    return (summary.live || summary.coordinating) ? ('working' as const) : ('idle' as const);
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

  const compact = () => uiStore.state.chatRailWidth < COMPACT_THRESHOLD_PX;

  return (
    <aside class={`chat-rail-stack ${compact() ? 'compact' : ''}`}>
      <div class="chat-rail-header">
        <Show when={!compact()} fallback={
          <span class="chat-rail-header-label" title="Agents" aria-label="Agents">···</span>
        }>
          <span class="chat-rail-header-label">Agents</span>
        </Show>
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
                stripe={agentVisualColor(c, meta())}
                compact={compact()}
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
            /* dynamic: stripe colour pulled from the agent-type registry.
               This CTA seeds the onboarding conv, so use the master-architect
               pink — matches what the operator will see right after clicking. */
            style={{ 'border-left': `3px solid ${agentVisualColor(ONBOARDING_CONV_ID, null)}` }}
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
