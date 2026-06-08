import { For, Show, createMemo, createSignal } from 'solid-js';
import { chatStore, ONBOARDING_CONV_ID } from '~/state/chat';
import AgentCard from '~/components/AgentCard';
import { agentVisualColor } from '~/lib/agent-types';
import { uiStore } from '~/state/ui';
import { loadRailOrder, saveRailOrder } from './chat/rail-order';

// V86o — when the rail is narrower than this, AgentCard switches to its
// compact layout: only the id chip + a status dot, no chips / no title.
// 130 was picked by visual inspection — narrower than that and the
// id-chip + agent-type chip + location chip overflow on one line.
const COMPACT_THRESHOLD_PX = 130;
// V107.38 — `isService` / `isServiceType` no longer used. The rail's
// ordering algorithm is now agent-type-agnostic (only Master + primary
// architect are special-cased in the head; everything else uses a
// stable creation-order + drag-override body, irrespective of whether
// the conv is a service or a custom worker).

export default function ChatRail(props: { onNewAgent?: () => void }) {
  const [order, setOrder] = createSignal<string[]>(loadRailOrder());
  const [dragSrc, setDragSrc] = createSignal<string | null>(null);
  const [dragTgt, setDragTgt] = createSignal<string | null>(null);

  // V107.38 — Rail ordering, rewritten clean. The previous version
  // sorted custom + services + architects EACH by `last_activity_at`,
  // which meant an idle agent jumped slots the moment it started
  // working (operator field report 2026-06-08: A099 was 4th, started
  // working, instantly moved to 2nd). Activity should never reorder
  // the rail — operators rely on positional muscle memory.
  //
  // The model is intentionally two-layer:
  //
  //   HEAD  (always recomputed; positions 0 + optional 1):
  //     - position 0 : Master (`_onboarding_v1`) — pinned
  //     - position 1 : Primary roadmap-architect — most recent
  //                    non-archived. Only ONE architect is "primary";
  //                    older architects fall into the body. When the
  //                    primary is archived, slot 1 collapses.
  //
  //   BODY  (everything else, in a stable order that does NOT move
  //          when activity flips):
  //     - first   : operator's saved drag order, in the order they set
  //     - then    : anything new, by `created_at` ascending — so brand-
  //                 new agents always land at the END of the rail,
  //                 never bubble up past existing entries.
  //
  // `last_activity_at` is no longer read by this memo. Period.
  const orderedConvs = createMemo(() => {
    if (!chatStore.state.convMap[ONBOARDING_CONV_ID]) {
      chatStore.seedOnboardingConv();
    }
    const snapshotConvs = chatStore.state.convs;

    // ── Inventory: every non-archived conv we know about. ──
    // Daemon-authoritative `convs` ∪ locally-created `convMeta`
    // (pre-dispatch convs from the New Agent wizard live only in
    // convMeta until the first dispatch produces a daemon record).
    const allSet = new Set<string>();
    for (const c of Object.keys(snapshotConvs)) {
      if (!snapshotConvs[c]?.archived) allSet.add(c);
    }
    for (const slug of Object.keys(chatStore.state.convMeta)) {
      if (chatStore.state.archivedConvs[slug]) continue;
      allSet.add(slug);
    }
    allSet.add(ONBOARDING_CONV_ID); // master is always present, even on a fresh cluster
    for (const c of allSet) chatStore.ensureConvMeta(c);

    // ── Head: master + primary architect. ──
    const isArchitect = (c: string): boolean => {
      if (snapshotConvs[c]?.agent_type === 'roadmap-architect') return true;
      return c.startsWith('roadmap-architect-');
    };
    const architectCandidates = [...allSet].filter(isArchitect);
    architectCandidates.sort((a, b) => {
      // Prefer live or coordinating over idle.
      const aLive = (snapshotConvs[a]?.live || snapshotConvs[a]?.coordinating) ? 1 : 0;
      const bLive = (snapshotConvs[b]?.live || snapshotConvs[b]?.coordinating) ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      // Tie-break: newest `created_at` wins (most recent spawn is the
      // current pass; older architect convs fall into the body).
      const aC = snapshotConvs[a]?.created_at ?? '';
      const bC = snapshotConvs[b]?.created_at ?? '';
      return bC.localeCompare(aC);
    });
    const primaryArchitect: string | null = architectCandidates[0] ?? null;

    const head: string[] = [ONBOARDING_CONV_ID];
    if (primaryArchitect) head.push(primaryArchitect);

    // ── Body: stable, never-reorder-on-activity. ──
    const pinned = new Set<string>(head);

    // (a) Operator's saved drag order, filtered down to slugs still
    //     present (and not in the head).
    const opOrder = order().filter((id) => allSet.has(id) && !pinned.has(id));
    const opSet = new Set(opOrder);

    // (b) Newcomers — anything not in head + not in operator order.
    //     Sort by `created_at` ASCENDING (oldest first → newest at
    //     the bottom). Slug fallback for pre-dispatch convs that
    //     haven't been registered in `convs` yet (their slugs embed
    //     a timestamp anyway, so the order stays stable).
    const ts = (c: string): string => snapshotConvs[c]?.created_at ?? c;
    const newcomers = [...allSet]
      .filter((id) => !pinned.has(id) && !opSet.has(id))
      .sort((a, b) => ts(a).localeCompare(ts(b)));

    return [...head, ...opOrder, ...newcomers];
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
