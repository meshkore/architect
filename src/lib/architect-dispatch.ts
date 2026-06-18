/**
 * architect-dispatch.ts — shared entrypoint for the Roadmap Architect.
 *
 * One function (`runArchitectOnScope`) drives both buttons:
 *   • Run All in the header → mode='all', scope = filtered active initiatives
 *   • ▶ on a single InitiativeCard → mode='single', scope = that one initiative
 *
 * Both paths reuse the cluster's existing `roadmap-architect-*` conv when
 * present (single coordinator per cluster by construction); spawn one
 * otherwise. The architect's SOP, validation gate, dispatch wave logic,
 * and depend_on serialisation are the same in both modes — only the
 * bootstrap turn differs.
 *
 * The per-initiative variant carries `initiative_id` on the dispatch
 * body so the daemon's linear-init invariant (3) refuses 409 if the
 * architect drifts into other initiatives mid-pass. Belt-and-braces:
 * the bootstrap itself also names the single-initiative constraint in
 * plain text.
 *
 * STOP semantics are uniform: `stopArchitect()` cancels the architect's
 * in-flight turn (chat.cancelled WS event), keeping the conv visible
 * so the operator can read the partial summary. Restart re-dispatches
 * a new bootstrap on the same conv.
 *
 * What this REPLACES
 *   • `InitiativesPanel.onRunAll` inline bootstrap + dispatch (kept as
 *     a 3-liner wrapper).
 *   • `InitiativeCard.startRun` + `storyStore.start` (the per-initiative
 *     play used to spawn its own `story-<initId>` conv via /runs; that
 *     code path is dead post-py-1.12.0-cockpit — we route everything
 *     through the architect, no parallel state machine).
 */

import { chatStore } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { uiStore } from '~/state/ui';
import { log } from './log';

/** One initiative in an execution scope. */
export interface ScopeInitiative {
  id: string;
  title: string;
}

/** How the front renders/controls this run — a DISPLAY hint only, NOT an
 *  execution difference. Execution is always "run the ordered list".
 *   • 'all'    → whole-roadmap Run All (Stop = stop the global pass)
 *   • 'single' → one initiative's ▶ (its own spinner)
 *   • 'subset' → an operator-chosen list (future multi-select) */
export type RunDisplay = 'all' | 'single' | 'subset';

/** Unified scope (py-1.21.0): ALWAYS an ordered list (length ≥ 1). Run All =
 *  all active in roadmap order; ▶ = [that one]; future multi-select = the
 *  chosen N in the chosen order. The operator's order is the contract. */
export interface ArchitectScope {
  initiatives: ScopeInitiative[];
  display: RunDisplay;
}

/** Build the bootstrap turn the architect receives on Run All / Run
 *  initiative. Both variants speak the SAME SOP — the difference is
 *  the active scope line + the closure sentinel. The bootstrap does
 *  NOT repeat the dispatch / matrix / wake procedure; that lives in
 *  the system prompt (`AGENT_PROMPTS["roadmap-architect"]`) and stays
 *  unchanged so we don't drift the load-bearing instructions. */
function buildBootstrap(scope: ArchitectScope): string {
  const list = scope.initiatives;
  const head = list[0]; // caller guarantees ≥1; `head &&` narrows for TS
  const one = list.length === 1;
  return [
    one && head ? `Run initiative \`${head.id}\`.` : `Run all.`,
    ``,
    `Scope — process these ${list.length} initiative${one ? '' : 's'} IN THIS ORDER. The operator's order is the contract: do NOT reorder by id, and do NOT dispatch into any initiative outside this list.`,
    ...list.map((it, i) => `${i + 1}. ${it.id} — ${it.title}`),
    ``,
    `For each: run it end-to-end; when every task is \`done\` set the initiative \`status: done\` (the daemon archives it — confirm "closed + archived" in the transition block), then continue to the NEXT in this list. After the LAST, emit the end-of-pass 4-bucket summary and stop. linear-init Invariant 3 refuses 409 on cross-initiative dispatch while one still has live work.`,
    ``,
    `Follow your SOP exactly. The chain on every blocker: DECISION CATALOG → STUB-AND-FLAG → DECISION MATRIX → CONSULT-A001. Never halt mid-pass; the single voluntary halt is the end-of-pass summary.`,
    ``,
    `Start now. Your very first line MUST be \`═══ VALIDATION GREEN ═══\` or \`═══ VALIDATION RED ═══\`. Be terse.`,
  ].join('\n');
}

/** Find the cluster's roadmap-architect conv (live or idle, non-archived).
 *  Single coordinator by design — at most one survives. Returns null if
 *  none exists yet (cold cluster, or operator just archived it). */
function findArchitectConv(): string | null {
  let best: { conv: string; ts: string } | null = null;
  for (const c of Object.values(chatStore.state.convs)) {
    if (c.archived) continue;
    const isArchitect =
      c.agent_type === 'roadmap-architect' ||
      c.conv.startsWith('roadmap-architect-');
    if (!isArchitect) continue;
    const ts = c.last_activity_at || '';
    if (!best || ts > best.ts) best = { conv: c.conv, ts };
  }
  return best?.conv ?? null;
}

/** Single entrypoint for Run All AND per-initiative play. Reuses the
 *  cluster's architect conv if present (idle), spawns one otherwise,
 *  emits a UX marker into the debug stream, and posts the appropriate
 *  bootstrap turn. The cockpit's existing state machinery (rail
 *  spinners, button states, conv.activity WS events) reacts to the
 *  dispatch from there — no separate state to maintain. */
export async function runArchitectOnScope(scope: ArchitectScope): Promise<void> {
  const client = daemonStore.state.client;
  if (!client) {
    log.warn('[architect-dispatch] no daemon client — abort');
    return;
  }
  if (scope.initiatives.length === 0) {
    log.info('[architect-dispatch] empty scope — nothing to do');
    return;
  }

  const existing = findArchitectConv();
  const conv = existing ?? chatStore.createConv({
    type: 'roadmap-architect',
    title: 'Roadmap Architect',
    model: 'auto',
  });

  uiStore.setActiveZone('architect');
  chatStore.setActiveConv(conv);

  const text = buildBootstrap(scope);

  void import('./debug-transport').then(({ debugEmit }) => {
    debugEmit(
      'ux.run-architect',
      `Run architect (${scope.display}, ${scope.initiatives.length} initiative(s))`,
      {
        conv,
        data: {
          display: scope.display,
          scope_size: scope.initiatives.length,
          initiative_ids: scope.initiatives.map((it) => it.id),
          reused_architect: !!existing,
        },
      },
    );
  });

  // Per-conv initiative_id is belt-and-braces only for a single-initiative run
  // (a multi-initiative scope spans many → no single id belongs on the conv).
  const onlyOne =
    scope.initiatives.length === 1 ? scope.initiatives[0] : undefined;
  const dispatchScope = onlyOne ? { initiative: onlyOne.id } : undefined;
  const res = await chatStore.dispatchMessage(client, {
    conv,
    text,
    author: 'architect',
    scope: dispatchScope,
  });
  if (!res.ok) {
    log.error('[architect-dispatch] dispatch failed', { status: res.status, error: res.error });
  }
}

/** Cancel the architect's in-flight turn. The conv stays visible
 *  (operator can read the partial summary). Restart by clicking Run
 *  all / per-initiative play again — the SAME conv is reused with a
 *  fresh bootstrap. Idempotent: no-op if there's no architect or no
 *  live turn. */
export async function stopArchitect(): Promise<void> {
  const client = daemonStore.state.client;
  if (!client) return;
  const conv = findArchitectConv();
  if (!conv) return;
  const summary = chatStore.state.convs[conv];
  if (!summary || (!summary.live && !summary.coordinating)) return;
  log.info('[architect-dispatch] stop', { conv });
  void import('./debug-transport').then(({ debugEmit }) => {
    debugEmit('ux.stop-architect', 'Stop Architect clicked', { conv });
  });
  try {
    const res = await client.chatCancel(conv);
    if (!res.ok) log.warn('[architect-dispatch] chatCancel non-OK', res.status);
  } catch (e) {
    log.warn('[architect-dispatch] chatCancel threw', e instanceof Error ? e.message : String(e));
  }
}
