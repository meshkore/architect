/**
 * models.ts — the cockpit's LLM model + effort catalog, shared by the
 * NewAgentWizard (pickers) and AgentCard / ChatScopeStrip (badges).
 *
 * Two knobs map 1:1 onto what the `claude` CLI (claude-code 2.1.145)
 * accepts and what the daemon forwards (MP1/MP3, daemon py-1.13.3+):
 *
 *   --model <id>     alias ('opus'/'sonnet'/'haiku' → always-latest)
 *                    OR a pinned full id ('claude-opus-4-8', …).
 *   --effort <level> low | medium | high | xhigh | max — the
 *                    "thinking" / reasoning-depth dial. There is NO
 *                    separate thinking flag; effort IS it.
 *
 * `auto` (model) and `default` (effort) are sentinels for "omit the
 * flag → let the CLI / account decide". The daemon skips the flag in
 * those cases.
 */

export interface ModelMeta {
  id: string;
  /** Full label for the picker. */
  label: string;
  /** ≤6-char badge shown in the rail card + chat header. */
  short: string;
  /** One-line hint shown under the picker option. */
  hint: string;
  /** Grouping for the picker's <optgroup>. */
  group: 'Latest (alias)' | 'Pinned version' | 'Auto';
}

// Aliases track the newest model of each family automatically — the
// safe default for most agents. Pinned ids let the operator nail a
// specific version (e.g. reproduce a result on opus-4.7). If the
// account can't access a pinned id, the CLI errors at dispatch — the
// chip / chat surfaces it; that's the operator's signal.
export const MODEL_CATALOG: readonly ModelMeta[] = [
  // Latest aliases
  { id: 'opus',   label: 'Opus (latest)',   short: 'opus', hint: 'Highest quality · most expensive · always newest Opus', group: 'Latest (alias)' },
  { id: 'sonnet', label: 'Sonnet (latest)', short: 'son',  hint: 'Balanced workhorse · always newest Sonnet',             group: 'Latest (alias)' },
  { id: 'haiku',  label: 'Haiku (latest)',  short: 'hai',  hint: 'Fastest · cheapest · always newest Haiku',              group: 'Latest (alias)' },
  // Pinned versions (current 4.x family)
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',   short: 'o4.8', hint: 'Pinned — Opus 4.8',   group: 'Pinned version' },
  { id: 'claude-opus-4-7',   label: 'Opus 4.7',   short: 'o4.7', hint: 'Pinned — Opus 4.7',   group: 'Pinned version' },
  { id: 'claude-opus-4-6',   label: 'Opus 4.6',   short: 'o4.6', hint: 'Pinned — Opus 4.6',   group: 'Pinned version' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', short: 's4.6', hint: 'Pinned — Sonnet 4.6', group: 'Pinned version' },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  short: 'h4.5', hint: 'Pinned — Haiku 4.5',  group: 'Pinned version' },
  // Auto
  { id: 'auto', label: 'Auto', short: 'auto', hint: 'Let the CLI / account decide (≈ latest Sonnet)', group: 'Auto' },
];

export interface EffortMeta {
  id: string;
  label: string;
  hint: string;
}

// Maps to `claude --effort <level>`. `default` omits the flag.
export const EFFORT_CATALOG: readonly EffortMeta[] = [
  { id: 'default', label: 'Default',      hint: 'CLI default reasoning depth (no flag)' },
  { id: 'low',     label: 'Low',          hint: 'Minimal thinking — fastest, cheapest' },
  { id: 'medium',  label: 'Medium',       hint: 'Moderate thinking' },
  { id: 'high',    label: 'High',         hint: 'Deeper thinking' },
  { id: 'xhigh',   label: 'Extra high',   hint: 'Very deep thinking' },
  { id: 'max',     label: 'Max',          hint: 'Maximum reasoning — slowest, most expensive' },
];

/** A freshly-created agent's model + effort. Explicit model (not auto)
 *  so the operator always knows what's running; default effort = the
 *  CLI default (no flag) to avoid silently inflating cost. */
export const DEFAULT_MODEL = 'sonnet';
export const DEFAULT_EFFORT = 'default';

const MODEL_BY_ID = new Map(MODEL_CATALOG.map((m) => [m.id, m]));

/** Short badge text for a model id. Known ids use their catalog
 *  `short`; unknown explicit ids fall back to the family word. */
export function modelShort(id: string | null | undefined): string {
  if (!id) return DEFAULT_MODEL_SHORT;
  const hit = MODEL_BY_ID.get(id);
  if (hit) return hit.short;
  const m = id.match(/opus|sonnet|haiku/i);
  if (m) {
    const fam = m[0].slice(0, 3).toLowerCase();
    const v = id.match(/(\d+)-(\d+)/);
    return v ? `${fam[0]}${v[1]}.${v[2]}` : fam;
  }
  return id.slice(0, 6);
}

const DEFAULT_MODEL_SHORT = MODEL_BY_ID.get(DEFAULT_MODEL)?.short ?? 'son';

/** Human label for a model id (for the chat-header badge / tooltip). */
export function modelLabel(id: string | null | undefined): string {
  if (!id || id === 'auto') return 'auto';
  return MODEL_BY_ID.get(id)?.label ?? id;
}

/** True when the model is the `auto` sentinel (or empty). */
export function isAutoModel(id: string | null | undefined): boolean {
  return !id || id === 'auto';
}

/** True when effort is the default sentinel (or empty) — no flag. */
export function isDefaultEffort(id: string | null | undefined): boolean {
  return !id || id === 'default';
}
