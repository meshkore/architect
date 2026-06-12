/**
 * models.ts — the cockpit's LLM model catalog, shared by the
 * NewAgentWizard (picker) and AgentCard / ChatScopeStrip (badges).
 *
 * The `id` is what flows to the daemon's `/chat/dispatch` body as
 * `model`, then into `claude-code --model <id>` (MP1, daemon py-1.13.3).
 * `auto` is the sentinel for "omit the flag → let the CLI / account
 * default decide" (which today resolves to Sonnet).
 *
 * DEFAULT_MODEL is what a freshly-created agent gets. We default to an
 * EXPLICIT model (not `auto`) so the operator always knows exactly what
 * is running — `auto` silently resolved to Sonnet and caused "¿qué
 * modelo estamos lanzando?" confusion (2026-06-12).
 */

export interface ModelMeta {
  id: string;
  /** Full label for the picker. */
  label: string;
  /** ≤4-char badge shown in the rail card + chat header. */
  short: string;
  /** One-line hint shown under the picker option. */
  hint: string;
}

export const MODEL_CATALOG: readonly ModelMeta[] = [
  { id: 'opus',   label: 'Opus',   short: 'opus', hint: 'Highest quality · most expensive' },
  { id: 'sonnet', label: 'Sonnet', short: 'son',  hint: 'Balanced — the default workhorse' },
  { id: 'haiku',  label: 'Haiku',  short: 'hai',  hint: 'Fastest · cheapest' },
  { id: 'auto',   label: 'Auto',   short: 'auto', hint: 'Let the CLI / account decide (≈ Sonnet)' },
];

/** A freshly-created agent's model. Explicit (not `auto`) so the
 *  operator always knows what's running. Matches what `auto` resolves
 *  to today, so no cost surprise — just clarity. */
export const DEFAULT_MODEL = 'sonnet';

const BY_ID = new Map(MODEL_CATALOG.map((m) => [m.id, m]));

/** Short badge text for a model id. Unknown / explicit model ids
 *  (e.g. `claude-opus-4-7`) fall back to a trimmed form. */
export function modelShort(id: string | null | undefined): string {
  if (!id) return DEFAULT_MODEL_SHORT;
  const hit = BY_ID.get(id);
  if (hit) return hit.short;
  // Explicit model id like `claude-opus-4-7` → pull the family word.
  const m = id.match(/opus|sonnet|haiku/i);
  if (m) return m[0].slice(0, 4).toLowerCase();
  return id.slice(0, 4);
}

const DEFAULT_MODEL_SHORT = BY_ID.get(DEFAULT_MODEL)?.short ?? 'son';

/** True when the model is the `auto` sentinel (or empty). */
export function isAutoModel(id: string | null | undefined): boolean {
  return !id || id === 'auto';
}
