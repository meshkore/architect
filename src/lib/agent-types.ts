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
 */
import type { AgentType } from '~/state/chat';

export interface AgentTypeInfo {
  id: AgentType;
  label: string;
  emoji: string;
  color: string;
  /** One-paragraph "what your agent does" hint. Shown below the composer
   * on the first turn of a service-type chat. Mirrors AGENT_PROMPTS[t].role. */
  role: string;
}

export const AGENT_TYPES: Record<AgentType, AgentTypeInfo> = {
  custom: {
    id: 'custom',
    label: 'General coder',
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
};

/** Ordered list — service types first (deploy → review) then custom last,
 * matching the V80 wizard pill order. */
export const AGENT_TYPE_ORDER: AgentType[] = [
  'deploy', 'db', 'testing', 'audit', 'docs', 'review', 'custom',
];

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
