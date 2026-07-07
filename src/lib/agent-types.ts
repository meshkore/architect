/**
 * agent-types.ts — canonical cockpit-side metadata for every agent_type.
 *
 * Authoritative source: `.meshkore/scripts/daemon.py :: AGENT_PROMPTS`.
 * Drift between this file and the daemon registry is a regression and
 * gets caught by the M0.3 colour-stripe checklist.
 *
 * Used by:
 *   - ChatRail / AgentCard — `stripe` colour
 *   - ChatScopeStrip       — type chip + label
 *   - ChatPanel            — "what your agent does" hint on empty service chats
 *   - Wizard (M6.5)        — pill row when creating a new agent
 *
 * Kept client-side (not fetched from the daemon) so the cockpit can render
 * agent identity while offline / before the daemon is reachable.
 *
 * py-1.10.24 — Adds a VISUAL-ONLY kind `master-architect` for the
 * always-on onboarding coordinator (`_onboarding_v1`). It isn't a
 * real daemon agent type (stays `custom` on the wire), so adding it
 * to AGENT_TYPES would force a daemon-side mirror. Instead the
 * visual lookup goes through `agentVisualInfo(conv, meta)` which
 * special-cases the onboarding conv id + the roadmap-architect slug
 * pattern. Pure cosmetics, zero behavioural impact.
 */
import type { AgentType } from '~/state/chat';
import { ONBOARDING_CONV_ID, isFixedAgentConv } from '~/state/chat';

export { isFixedAgentConv };

export interface AgentTypeInfo {
  id: AgentType;
  label: string;
  /** V107.11 — Compact label used in tight chips (AgentCard, etc).
   *  Falls back to label if unset. Keep ≤ 8 chars. */
  shortLabel?: string;
  emoji: string;
  color: string;
  /** One-paragraph "what your agent does" hint. Shown below the composer
   * on the first turn of a service-type chat. Mirrors AGENT_PROMPTS[t].role. */
  role: string;
}

/** ATM12 follow-up (2026-07-07, 2nd correction) — the ONE shared colour
 *  for both fixed system agents (Master/Architect Agent + Roadmap
 *  Architect). First pass introduced a dedicated hue (`--theme-byline-
 *  fixed`, dark orange/red) — operator rejected it as clashing with the
 *  rest of the palette. Reusing the theme's OWN accent
 *  (`--theme-accent-bright`, already themed per preset) instead
 *  guarantees it's always "in the same chromatic range" as everything
 *  else on screen, by construction. The two fixed agents no longer get
 *  a unique hue — they stand out via a soft accent BACKGROUND behind
 *  the name (see `AgentCard.tsx`), not via text colour.
 *  Every consumer of `AgentTypeInfo.color` MUST treat it as an opaque
 *  CSS `<color>` value (never slice/concat it as a raw hex — use
 *  `color-mix(in srgb, ${color} N%, transparent)` for tints). */
const FIXED_AGENT_COLOR = 'var(--theme-accent-bright, #34d399)';

export const AGENT_TYPES: Record<AgentType, AgentTypeInfo> = {
  custom: {
    id: 'custom',
    label: 'General coder',
    shortLabel: 'Coder',
    emoji: '🧠',
    color: '#34d399',
    role:
      'The default coordinator role — owns the roadmap, modules, tasks, ' +
      'integrity checks, deploys, docs, the lot. Specialised agents ' +
      '(deploy / db / testing / audit / docs / review) exist for narrow ' +
      'service work; everything else is yours.',
  },
  deploy: {
    id: 'deploy',
    label: 'Deploy',
    emoji: '🚀',
    color: '#60a5fa',
    role:
      'Ships this cluster\'s code to its runtime targets (Cloudflare ' +
      'Pages, Workers, R2, custom hosts) and keeps the build / CI / ' +
      'credentials story healthy. Refuses to deploy uncommitted changes ' +
      'silently. Never invents version numbers — uses POST /version/next.',
  },
  db: {
    id: 'db',
    label: 'Database',
    shortLabel: 'DB',
    emoji: '🗄️',
    color: '#a78bfa',
    role:
      'Owns schemas, migrations, seeds, backups, and data-shape decisions ' +
      'for this cluster\'s stores (Postgres, D1, KV, R2, SQLite, whatever ' +
      'applies). Backs up before destructive changes. Flags migrations ' +
      'that must run before a deploy.',
  },
  testing: {
    id: 'testing',
    label: 'Testing',
    shortLabel: 'Tests',
    emoji: '🧪',
    color: '#fbbf24',
    role:
      'Writes, runs, and maintains tests (unit / integration / e2e / ' +
      'contract) for this cluster — and only those. May add fixtures, ' +
      'mocks, harnesses, and CI test config. May NOT change production ' +
      'code to make tests pass — surfaces the bug instead.',
  },
  audit: {
    id: 'audit',
    label: 'Audit',
    emoji: '🔍',
    color: '#f87171',
    role:
      'Read-only. Inspects the cluster (code, roadmap, state, deploys, ' +
      'deps) and reports findings — never applies fixes. Looks for ' +
      'security issues, drift between standard.json and the cluster, ' +
      'orphan modules, broken refs, dependency risks, dense initiatives.',
  },
  docs: {
    id: 'docs',
    label: 'Docs',
    emoji: '📚',
    color: '#9ca3af',
    role:
      'Owns narrative documentation: READMEs, operator manuals, ' +
      'architecture notes, .meshkore/docs/*.md, comments at file headers. ' +
      'Reads code to understand it but does not change behaviour. Keeps ' +
      'coverage.md honest when docs drift from reality.',
  },
  review: {
    id: 'review',
    label: 'Review',
    emoji: '🔎',
    color: '#fb923c',
    role:
      'Reads recent changes (git diff, modified files, recent commits) ' +
      'and gives code-review feedback — does not apply changes. Comments ' +
      'on correctness, security, complexity, test coverage, naming, ' +
      'missing edge cases. Focus is what would block merge.',
  },
  'roadmap-architect': {
    id: 'roadmap-architect',
    label: 'Roadmap Architect',
    shortLabel: 'Architect',
    emoji: '🗺️',
    // ATM12 follow-up (2026-07-07 operator correction) — shares the
    // Master Architect's FIXED_AGENT_COLOR: both are protected system
    // agents and should read as one visual "family", not two.
    color: FIXED_AGENT_COLOR,
    role:
      'Spawned by Run all. Reads the active roadmap, plans the order, ' +
      'dispatches sub-agents (coding / deploy / db / testing / docs / ' +
      'review) via the daemon HTTP API, monitors them, and narrates ' +
      'progress in its own chat. Does not write code itself — it ' +
      'coordinates. Sub-agents it spawns appear in the rail tagged with ' +
      'this architect as their parent so the operator can tell ' +
      'coordinator-driven work from manual work.',
  },
};

// agent-team (ATM7) — `AGENT_TYPE_ORDER` was the New Agent wizard's pill
// order. The wizard is deleted (the chat-rail `+` now spawns a
// `developer` member directly, and typed service work is a team member),
// so the ordered list is gone. The registry (`AGENT_TYPES`) stays — the
// rail/chat badges still resolve colours + labels through it.

export function agentTypeInfo(t: AgentType | string | undefined | null): AgentTypeInfo {
  if (t && t in AGENT_TYPES) return AGENT_TYPES[t as AgentType];
  return AGENT_TYPES.custom;
}

export function agentTypeColor(t: AgentType | string | undefined | null): string {
  return agentTypeInfo(t).color;
}

export function isServiceType(t: AgentType | string | undefined | null): boolean {
  return !!t && t !== 'custom' && t in AGENT_TYPES;
}

// py-1.10.24 — Visual-only kind for the always-on onboarding
// coordinator (A001). The conv stays `agent_type: custom` on the
// daemon side; we just paint it distinctly so the operator can spot
// the project's principal architect at a glance versus the generic
// coder fleet.
//
// Color choice (revised ATM12 follow-up, 2026-07-07, 2nd pass): shares
// FIXED_AGENT_COLOR with `roadmap-architect` — both are protected
// system agents, so they read as one "family". First pass gave them a
// unique hue (pink vs cyan, then a bespoke orange/red); operator
// rejected the standalone-hue idea entirely — the accent already IS
// the theme's most prominent colour, so reusing it (rather than
// inventing a new one) is what "matches the rest of the palette"
// means here. The two fixed agents stand out via a soft accent
// BACKGROUND behind the rail name (`AgentCard.tsx`), not a unique text
// colour — sharing the accent hue with `custom`'s stripe colour is
// harmless since `custom` never colours its OWN name text.
const MASTER_ARCHITECT_INFO: AgentTypeInfo = {
  id: 'custom' as AgentType, // back-fill — daemon-side type is still 'custom'
  label: 'Master Architect',
  shortLabel: 'Master',
  emoji: '👑',
  color: FIXED_AGENT_COLOR,
  role:
    'The cluster\'s principal coordinator. Always-on conv anchored at ' +
    '`_onboarding_v1`. Sets up the project, designs the roadmap, owns ' +
    'cross-cutting decisions, and answers `[architect-consult]` queries ' +
    'from the Run All architect. One per cluster.',
};

/** py-1.10.24 — Visual-only resolution: look at the conv id first,
 *  then the meta.type, then fall back to custom. The conv id is the
 *  most authoritative signal because:
 *    • `_onboarding_v1` ↔ Master Architect (A001) — unforgeable
 *    • `roadmap-architect-<slug>` ↔ Roadmap Architect — unforgeable
 *    • everything else falls through to `meta.type`
 *
 *  Callers that don't have the conv id can pass `null` and the
 *  function degrades gracefully to `agentTypeInfo(meta.type)`. */
export function agentVisualInfo(
  conv: string | null | undefined,
  meta: { type?: AgentType | string } | null | undefined,
): AgentTypeInfo {
  if (conv === ONBOARDING_CONV_ID) return MASTER_ARCHITECT_INFO;
  if (conv && conv.startsWith('roadmap-architect-')) {
    return AGENT_TYPES['roadmap-architect'];
  }
  return agentTypeInfo(meta?.type);
}

export function agentVisualColor(
  conv: string | null | undefined,
  meta: { type?: AgentType | string } | null | undefined,
): string {
  return agentVisualInfo(conv, meta).color;
}
