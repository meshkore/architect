/**
 * ValidationGreenBadge — V107.3.
 *
 * Tiny visual the cockpit prepends when the architect's first turn
 * starts with `═══ VALIDATION GREEN ═══`. Tells the operator the
 * validation step ran and passed, before the pre-flight + execution
 * text that follows.
 *
 * The marker line itself is hidden by `stripGreenMarker` so the
 * normal markdown render below doesn't show the literal `═══ ... ═══`
 * line — the badge replaces it.
 */

export const VALIDATION_GREEN_MARKER = '═══ VALIDATION GREEN ═══';

/** Returns the text with the leading GREEN marker line removed. */
export function stripGreenMarker(text: string): string {
  if (!text) return text;
  const t = text.trimStart();
  const lines = t.split('\n');
  if (lines[0]?.trim() === VALIDATION_GREEN_MARKER) {
    lines.shift();
    // Also drop a leading blank line after the marker so the body
    // starts flush.
    if (lines[0]?.trim() === '') lines.shift();
  }
  return lines.join('\n');
}

export default function ValidationGreenBadge() {
  return (
    <div class="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 mb-2">
      <span aria-hidden="true" class="text-emerald-300 text-[12px]">✓</span>
      <span class="font-mono text-[10px] uppercase tracking-wider text-emerald-300">
        Roadmap validated — starting pass
      </span>
    </div>
  );
}
