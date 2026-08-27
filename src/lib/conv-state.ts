/**
 * conv-state.ts — the pure truth about "is this conv working?" and
 * "which conv is the architect?".
 *
 * AX14 (cockpit-excellence). Before this module the same two questions
 * were answered by three hand-rolled copies — `InitiativesPanel`'s
 * `architectLive`, `ChatScopeStrip`'s `isWorking`, and `chat.ts`'s
 * `findActiveArchitectConv` — and they drifted: the queue bar offered
 * "▶ Run queue" while the chat already showed "STOP" on the same run.
 *
 * These helpers take their inputs explicitly and import no store, so
 * both `state/chat.ts` and `state/live-selectors.ts` can use them
 * without an import cycle. The store-bound wrappers live in
 * `state/live-selectors.ts`.
 */

/** The fields of a daemon conv summary these predicates actually read. */
export interface ConvStateLike {
  conv: string;
  live?: boolean;
  coordinating?: boolean;
  archived?: boolean;
  agent_type?: string | null;
  last_activity_at?: string;
}

/** The fields of a chat message these predicates actually read. */
export interface MsgStateLike {
  kind?: string;
  streaming?: boolean;
  cancelled?: boolean;
}

/**
 * True when the conv has an assistant turn in flight.
 *
 * Daemon-authoritative `live`/`coordinating` (chat.snapshot, py-1.11.0+)
 * wins when present. The streaming-bubble fallback covers the window
 * before the snapshot's flags land — and daemons predating
 * chat.snapshot.v1 entirely. Both halves are required: dropping the
 * fallback is what made the queue bar disagree with the chat.
 */
export function isConvWorkingFrom(
  snap: ConvStateLike | null | undefined,
  msgs: readonly MsgStateLike[] | undefined,
): boolean {
  if (snap && (snap.live || snap.coordinating)) return true;
  const last = msgs?.[msgs.length - 1];
  return !!(last && last.kind === 'assistant' && last.streaming && !last.cancelled);
}

/**
 * True when a conv belongs to the roadmap architect.
 *
 * The slug check is not redundant with the type check: a convMeta entry
 * whose `type` was corrupted by a pre-V92 bundle (V99) still has to
 * count, otherwise the operator loses the Run All button on an
 * otherwise healthy run.
 */
export function isArchitectConv(conv: string, agentType?: string | null): boolean {
  return agentType === 'roadmap-architect' || conv.startsWith('roadmap-architect-');
}

/**
 * The most recently active non-archived architect conv, or null.
 *
 * Ordering is by `last_activity_at` descending; entries without a
 * timestamp sort last but remain selectable, so a freshly created conv
 * that has not reported activity yet is still found.
 */
export function pickLatestArchitectConv(convs: readonly ConvStateLike[]): string | null {
  let best: string | null = null;
  let bestTs = '';
  for (const c of convs) {
    if (c.archived) continue;
    if (!isArchitectConv(c.conv, c.agent_type)) continue;
    const ts = c.last_activity_at ?? '';
    if (best === null || ts >= bestTs) {
      best = c.conv;
      bestTs = ts;
    }
  }
  return best;
}
