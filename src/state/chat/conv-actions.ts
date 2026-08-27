/**
 * state/chat/conv-actions.ts — operator-driven mutations of the roster:
 * create a conv, rename it, retune its model/effort/member, archive it,
 * pick the active one.
 *
 * V86x is the rule that shapes all of it: NEVER inject a synthetic
 * message into a conv. New agents arrive as empty convs and introduce
 * themselves on their first real turn.
 */

import { pickLatestArchitectConv, type ConvStateLike } from '~/lib/conv-state';
import { state, setState, activeClusterId } from './store';
import { saveConvMeta, saveArchivedConvs, saveLastActiveConv } from './persistence';
import { ONBOARDING_CONV_ID, isFixedAgentConv, type AgentType, type ConvMeta } from './types';

function nextAgentId(): string {
  const used = new Set(Object.values(state.convMeta).map((m) => m.agentId));
  for (let i = 1; i < 1000; i += 1) {
    const id = 'A' + String(i).padStart(3, '0');
    if (!used.has(id)) return id;
  }
  return 'A???';
}

export function ensureConvMeta(convId: string, init: Partial<ConvMeta> = {}): ConvMeta {
  const existing = state.convMeta[convId];
  if (existing) return existing;
  const meta: ConvMeta = {
    agentId: init.agentId ?? nextAgentId(),
    model: init.model ?? 'auto',
    effort: init.effort ?? 'default',
    client: init.client ?? 'claude-code',
    type: (init.type ?? 'custom') as AgentType,
    title: init.title ?? '',
    member: init.member,
    location: init.location ?? { type: 'local', host: 'this machine' },
  };
  setState('convMeta', convId, meta);
  saveConvMeta();
  return meta;
}

export function setActiveConv(conv: string | null): void {
  setState('activeConv', conv);
  // V107.17 — persist per-cluster so a reload lands on the same agent.
  saveLastActiveConv(conv);
}

/**
 * Seed the synthetic Architect Agent conversation (V46 / V78b).
 * Idempotent. Creates the empty slot only — the rail card needs it to
 * exist (V82) but the agent introduces itself organically on the first
 * dispatch (the bootstrap brief rides along as a context_doc).
 */
export function seedOnboardingConv(): void {
  if (state.convMap[ONBOARDING_CONV_ID]) return;
  setState('convMap', ONBOARDING_CONV_ID, []);
  ensureConvMeta(ONBOARDING_CONV_ID, {
    // V107.12 — renamed from 'Coordinator': distinctive from the
    // transient roadmap-architect (spawned per Run All pass) and it
    // reinforces that THIS is the always-on master that owns the
    // project. The conv id is unchanged.
    title: 'Architect Agent',
    type: 'custom',
    location: { type: 'local', host: 'this machine' },
  });
  if (!state.activeConv) setState('activeConv', ONBOARDING_CONV_ID);
}

/** True once the Architect Agent conv received a real user message.
 *  Gates the bootstrap-brief attachment (first dispatch only) and keeps
 *  the rail card visible after initiatives appear. */
export function onboardingHasUserMessages(): boolean {
  const list = state.convMap[ONBOARDING_CONV_ID];
  if (!list || list.length === 0) return false;
  return list.some((m) => m.kind === 'user');
}

/**
 * Create an empty conversation with metadata and select it. Used by the
 * chat-rail `+` (ATM7 — binds a `developer` member draft) and story runs.
 * Slug mirrors V79's `newConvSlugFromScope`: scope-encoded for custom
 * agents, type+timestamp for services. Returns the slug so the caller
 * can focus the composer.
 */
export function createConv(opts: {
  type: AgentType;
  title: string;
  model: string;
  effort?: string;
  /** agent-team (ATM7) — bind the new conv to a roster member. */
  member?: string;
  scope?: { module?: string | null; taskId?: string | null };
}): string {
  const stamp = new Date().toISOString().slice(5, 16).replace(/[:T-]/g, '').toLowerCase();
  let slug: string;
  if (opts.type === 'custom') {
    const tid = opts.scope?.taskId?.trim();
    const mod = opts.scope?.module?.trim();
    if (tid) slug = `${(mod || 'general')}-${tid.toLowerCase()}-${stamp}`;
    else if (mod) slug = `${mod}-${stamp}`;
    else slug = `general-${stamp}`;
  } else {
    slug = `${opts.type}-${Date.now().toString(36).slice(-5)}`;
  }
  if (!state.convMap[slug]) setState('convMap', slug, []);
  ensureConvMeta(slug, {
    type: opts.type,
    title: opts.title,
    model: opts.model,
    effort: opts.effort,
    member: opts.member,
  });
  // V107.30 — setActiveConv (not raw setState) so the slug is persisted;
  // otherwise a reload right after creating an agent dropped the
  // selection back to Master.
  setActiveConv(slug);
  return slug;
}

/**
 * V87 — Spawn a fresh agent + conv for a story run. Always a brand-new
 * slug: the operator's contract is "play = new agent, new context,
 * isolated cancel domain".
 */
export function createStoryConv(opts: { initiativeId: string; initiativeTitle: string }): string {
  const stamp = Date.now().toString(36);
  const slug = `story-${opts.initiativeId}-${stamp}`;
  if (!state.convMap[slug]) setState('convMap', slug, []);
  ensureConvMeta(slug, {
    type: 'custom',
    title: opts.initiativeTitle,
    location: { type: 'local', host: 'this machine' },
  });
  setState('activeConv', slug);
  return slug;
}

export function setConvTitle(conv: string, title: string): void {
  ensureConvMeta(conv);
  setState('convMeta', conv, 'title', title);
  saveConvMeta();
}

/** agent-team (ATM7) — set the conv's model live. Every turn is a fresh
 *  `claude -p`, so the change applies from the NEXT dispatch. */
export function setConvModel(conv: string, model: string): void {
  ensureConvMeta(conv);
  setState('convMeta', conv, 'model', model);
  saveConvMeta();
}

/** agent-team (ATM7) — reasoning depth; same next-turn semantics. */
export function setConvEffort(conv: string, effort: string): void {
  ensureConvMeta(conv);
  setState('convMeta', conv, 'effort', effort);
  saveConvMeta();
}

/** agent-team (ATM7) — rebind a DRAFT conv (no messages yet) to another
 *  roster member, refreshing model/effort defaults and the title when it
 *  still matches the previous member's name. */
export function setConvMember(
  conv: string,
  member: string,
  defaults?: { model?: string; effort?: string; title?: string },
): void {
  ensureConvMeta(conv);
  setState('convMeta', conv, 'member', member);
  if (defaults?.model) setState('convMeta', conv, 'model', defaults.model);
  if (defaults?.effort) setState('convMeta', conv, 'effort', defaults.effort);
  if (defaults?.title) setState('convMeta', conv, 'title', defaults.title);
  saveConvMeta();
}

export function archiveConv(conv: string): void {
  // V82/V107.12 — the two fixed system agents are never archivable;
  // a stray click must not strand the operator without a default chat.
  if (isFixedAgentConv(conv)) return;
  setState('archivedConvs', conv, true);
  saveArchivedConvs();
}

export function unarchiveConv(conv: string): void {
  setState('archivedConvs', (xs) => {
    const { [conv]: _drop, ...rest } = xs;
    return rest;
  });
  saveArchivedConvs();
}

/**
 * V106 — the most-recent non-archived Roadmap Architect conv, or null.
 * Consumed by the projects rail's per-row "architect active" dot.
 *
 * The ranking itself lives in `~/lib/conv-state` so this answer, the
 * chat strip's STOP button and the roadmap's Run All button cannot
 * drift apart again.
 */
export function findActiveArchitectConv(): string | null {
  const candidates: ConvStateLike[] = Object.entries(state.convMeta).map(([conv, meta]) => ({
    conv,
    agent_type: meta.type ?? null,
    archived: !!state.archivedConvs[conv],
    last_activity_at: (state.convMap[conv] ?? []).at(-1)?.ts ?? '',
  }));
  return pickLatestArchitectConv(candidates);
}

/** The cluster this store is currently bound to (read-only helper for
 *  the async guards in dispatch / queue hydration). */
export function boundCluster(): string | null {
  return activeClusterId();
}
