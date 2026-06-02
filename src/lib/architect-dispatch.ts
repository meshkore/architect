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
import type { ServerInitiative } from '~/state/server';
import { log } from './log';

export type ArchitectScope =
  | { mode: 'all'; list: ServerInitiative[] }
  | { mode: 'single'; initiative: ServerInitiative };

/** Build the bootstrap turn the architect receives on Run All / Run
 *  initiative. Both variants speak the SAME SOP — the difference is
 *  the active scope line + the closure sentinel. The bootstrap does
 *  NOT repeat the dispatch / matrix / wake procedure; that lives in
 *  the system prompt (`AGENT_PROMPTS["roadmap-architect"]`) and stays
 *  unchanged so we don't drift the load-bearing instructions. */
function buildBootstrap(scope: ArchitectScope): string {
  if (scope.mode === 'all') {
    const list = scope.list;
    return [
      `Run all.`,
      ``,
      `Active scope (${list.length} initiative${list.length === 1 ? '' : 's'}, lower-id first):`,
      ...list.map((it, i) => `${i + 1}. ${it.id} — ${it.title}`),
      ``,
      `Follow your SOP exactly. The chain on every blocker: DECISION CATALOG → STUB-AND-FLAG → DECISION MATRIX → CONSULT-A001. Never halt mid-pass. The single voluntary halt is the end-of-pass 4-bucket summary.`,
      ``,
      `Start now. Your very first line MUST be \`═══ VALIDATION GREEN ═══\` or \`═══ VALIDATION RED ═══\`. Be terse.`,
    ].join('\n');
  }
  const it = scope.initiative;
  return [
    `Run initiative \`${it.id}\`.`,
    ``,
    `Scope: this initiative ONLY (1 of N).`,
    `1. ${it.id} — ${it.title}`,
    ``,
    `Process \`${it.id}\` end-to-end. Do NOT dispatch into other initiatives — linear-init Invariant 3 refuses 409 server-side if you try, so wasted dispatches just bounce. When every task of \`${it.id}\` is \`done\` or \`blocked\`, emit a per-initiative summary (shipped / blocked / decisions / questions) and stop. Do NOT auto-continue to the next initiative; the operator will pick what's next.`,
    ``,
    `Follow your SOP exactly. The chain on every blocker: DECISION CATALOG → STUB-AND-FLAG → DECISION MATRIX → CONSULT-A001. Never halt mid-task.`,
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
  if (scope.mode === 'all' && scope.list.length === 0) {
    log.info('[architect-dispatch] mode=all but scope is empty — nothing to do');
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
    if (scope.mode === 'all') {
      debugEmit('ux.run-all', `Run All clicked (${scope.list.length} initiative(s))`, {
        conv,
        data: {
          scope_size: scope.list.length,
          initiative_ids: scope.list.map((it) => it.id),
          reused_architect: !!existing,
        },
      });
    } else {
      debugEmit('ux.run-initiative', `Run initiative ${scope.initiative.id} clicked`, {
        conv,
        data: { initiative_id: scope.initiative.id, reused_architect: !!existing },
      });
    }
  });

  const dispatchScope =
    scope.mode === 'single' ? { initiative: scope.initiative.id } : undefined;
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
