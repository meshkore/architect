/**
 * state/chat/conv-events.ts — WS `conv.*` and `chat.usage` ingestion.
 *
 * Idempotent by contract: the daemon may emit the same event twice (one
 * runner finishing triggers both its own activity flip and its parent's).
 *
 * Layering note (AX12): this module deliberately does NOT touch
 * `viewStore`. The ✨NEW markers a `conv.anchored` event triggers are a
 * VIEW concern; routing them from a data store was the one edge that
 * made `state/chat` depend on `state/view`. `lib/event-bus.ts` now fans
 * the same event out to both stores.
 */

import type { ChatConvSummary, ChatContextBlock, ChatUsageTotal, DaemonEvent } from '~/lib/daemon-client';
import { log } from '~/lib/log';
import { state, setState, activeClusterId } from './store';
import { saveArchivedConvs } from './persistence';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Fill the fields `ChatConvSummary` requires from whatever the event
 *  and the previous summary carry, so a partial event never produces a
 *  half-typed entry. */
function baseSummary(conv: string, prev: ChatConvSummary | undefined, ts: string | null): ChatConvSummary {
  return {
    conv,
    agent_type: prev?.agent_type ?? null,
    agent_id: prev?.agent_id ?? null,
    parent_conv: prev?.parent_conv ?? null,
    initiative_id: prev?.initiative_id ?? null,
    task_id: prev?.task_id ?? null,
    archived: prev?.archived ?? false,
    archived_at: prev?.archived_at ?? null,
    archived_by: prev?.archived_by ?? null,
    live: prev?.live ?? false,
    coordinating: prev?.coordinating ?? false,
    waiting_on: prev?.waiting_on ?? [],
    created_at: prev?.created_at ?? (ts ?? ''),
    last_activity_at: prev?.last_activity_at ?? '',
    msg_count: prev?.msg_count ?? 0,
  };
}

/** MP3 — mirror daemon-authoritative model/effort/client onto the local
 *  convMeta so the rail card, the chat badges and the next dispatch all
 *  agree with what the daemon will actually launch. */
function mirrorMeta(conv: string, ev: DaemonEvent): void {
  if (!state.convMeta[conv]) return;
  const model = str(ev.model);
  const effort = str(ev.effort);
  const client = str(ev.client);
  if (model) setState('convMeta', conv, 'model', model);
  if (effort) setState('convMeta', conv, 'effort', effort);
  if (client) setState('convMeta', conv, 'client', client);
}

function onCreatedOrMetaUpdated(conv: string, ev: DaemonEvent): void {
  const cur = state.convs[conv];
  const ts = str(ev.ts);
  setState('convs', conv, {
    ...baseSummary(conv, cur, ts),
    agent_type: str(ev.agent_type) ?? cur?.agent_type ?? null,
    agent_id: str(ev.agent_id) ?? cur?.agent_id ?? null,
    parent_conv: str(ev.parent_conv) ?? cur?.parent_conv ?? null,
    initiative_id: str(ev.initiative_id) ?? cur?.initiative_id ?? null,
    task_id: str(ev.task_id) ?? cur?.task_id ?? null,
    last_activity_at: ts ?? cur?.last_activity_at ?? '',
    model: str(ev.model) ?? cur?.model ?? null,
    effort: str(ev.effort) ?? cur?.effort ?? null,
    client: str(ev.client) ?? cur?.client ?? null,
  });
  mirrorMeta(conv, ev);
}

function onArchived(conv: string, ev: DaemonEvent): void {
  setState('convs', conv, (prev) => ({
    ...(prev ?? ({} as ChatConvSummary)),
    archived: true,
    archived_at: str(ev.archived_at) ?? str(ev.ts),
    archived_by: str(ev.by),
  }));
  setState('archivedConvs', conv, true);
  saveArchivedConvs();
}

function onUnarchived(conv: string): void {
  setState('convs', conv, (prev) => ({
    ...(prev ?? ({} as ChatConvSummary)),
    archived: false,
    archived_at: null,
    archived_by: null,
  }));
  setState('archivedConvs', (prev) => {
    const next = { ...prev };
    delete next[conv];
    return next;
  });
  saveArchivedConvs();
}

/** LAL4 (py-1.13.0) — the daemon parses `⟦anchor⟧ {...}` from agent
 *  output and emits this so the roadmap row lights up without a /state
 *  poll. The daemon also rebuilds state after writing the files, so the
 *  existing `state.rebuilt` flow picks the new rows up. */
function onAnchored(conv: string, ev: DaemonEvent): void {
  setState('convs', conv, (prev) => ({
    ...baseSummary(conv, prev, str(ev.ts)),
    // Spread AFTER the base so fields the summary type doesn't declare
    // (usage, context, model…) survive an anchor event.
    ...(prev ?? {}),
    conv,
    initiative_id: str(ev.initiative_id) ?? prev?.initiative_id ?? null,
    task_id: str(ev.task_id) ?? prev?.task_id ?? null,
    last_activity_at: str(ev.ts) ?? prev?.last_activity_at ?? '',
  }));
}

function onAnchorRejected(conv: string, ev: DaemonEvent): void {
  const reason = str(ev.reason) ?? 'anchor rejected';
  setState('convMap', conv, [
    ...(state.convMap[conv] ?? []),
    {
      kind: 'system',
      // 'warning', not 'warn': SystemBubble tints on 'error' | 'warning'
      // and falls through to neutral grey for anything else.
      system_kind: 'warning',
      text: `Anchor rejected: ${reason}`,
      ts: str(ev.ts) ?? new Date().toISOString(),
    },
  ]);
}

/** CU1 (py-1.13.3) — cumulative token usage + cost, broadcast after
 *  every final. CTX1 (py-1.28.0) adds the per-turn context-window fill
 *  the strip paints as a gauge; it is present only for platforms with a
 *  known window. */
function onUsage(conv: string, ev: DaemonEvent): void {
  const total = (ev as { total?: ChatUsageTotal }).total;
  if (!total || typeof total !== 'object') return;
  const context = (ev as { context?: ChatContextBlock }).context;
  setState('convs', conv, (prev) => ({
    ...(prev ?? ({} as ChatConvSummary)),
    conv,
    usage: total,
    ...(context && typeof context === 'object' ? { context } : {}),
  }));
}

function onActivity(conv: string, ev: DaemonEvent): void {
  setState('convs', conv, (prev) => ({
    ...baseSummary(conv, prev, str(ev.ts)),
    // Same reason as onAnchored: keep usage/context across the flip.
    ...(prev ?? {}),
    agent_type: str(ev.agent_type) ?? prev?.agent_type ?? null,
    agent_id: str(ev.agent_id) ?? prev?.agent_id ?? null,
    parent_conv: str(ev.parent_conv) ?? prev?.parent_conv ?? null,
    initiative_id: str(ev.initiative_id) ?? prev?.initiative_id ?? null,
    task_id: str(ev.task_id) ?? prev?.task_id ?? null,
    live: ev.live === true,
    coordinating: ev.coordinating === true,
    waiting_on: Array.isArray(ev.waiting_on) ? (ev.waiting_on as string[]) : [],
    last_activity_at: str(ev.ts) ?? prev?.last_activity_at ?? '',
  }));
  // Keep `clusterActivity.workingConvs` in lockstep with `conv.live` so
  // the project rail reflects daemon state immediately, not only after
  // the first delta. Pair of snapshot.seedWorkingConvs, which seeds the
  // same set on cluster bind.
  const activeId = activeClusterId();
  if (!activeId) return;
  const isLive = ev.live === true || ev.coordinating === true;
  setState('clusterActivity', activeId, (prev) => {
    const working = new Set(prev?.workingConvs ?? []);
    if (isLive) working.add(conv);
    else working.delete(conv);
    return {
      lastEventAt: Date.now(),
      lastReadAt: prev?.lastReadAt ?? 0,
      workingConvs: [...working],
    };
  });
}

export function ingestConvEvent(ev: DaemonEvent): void {
  const conv = typeof ev.conv === 'string' ? ev.conv : '';
  if (!conv) return;
  // Only act once snapshot.v1 has hydrated at least once — otherwise we
  // would build `convs` on top of an empty map and race the boot fetch.
  if (!state.convsHydratedAt) return;
  switch (ev.type) {
    case 'conv.created':
    case 'conv.meta_updated':
      return onCreatedOrMetaUpdated(conv, ev);
    case 'conv.archived':
      return onArchived(conv, ev);
    case 'conv.unarchived':
      return onUnarchived(conv);
    case 'conv.anchored':
      return onAnchored(conv, ev);
    case 'conv.anchor_rejected':
      return onAnchorRejected(conv, ev);
    case 'conv.anchor_missing':
      // No bubble — the agent simply skipped the marker.
      return log.info('agent skipped anchor for conv', conv);
    case 'chat.usage':
      return onUsage(conv, ev);
    case 'conv.task_completed': {
      // Clear the conv's task_id so the roadmap's pulse on that task
      // stops immediately. A fresh ⟦anchor⟧ sets it again.
      if (!str(ev.task_id)) return;
      setState('convs', conv, (prev) => ({ ...(prev ?? ({} as ChatConvSummary)), task_id: null }));
      return;
    }
    case 'conv.activity':
      return onActivity(conv, ev);
    default:
      return;
  }
}
