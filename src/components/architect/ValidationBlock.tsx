/**
 * ValidationBlock — V107.5.
 *
 * Renders the architect's first-turn VALIDATION GATE output when the
 * marker is `═══ VALIDATION RED ═══`. Informational only — the
 * operator answers in the normal cockpit chat input (no embedded
 * textarea, no submit buttons). The architect re-validates on the
 * next turn.
 *
 * V107.5 removed the embedded textarea + Submit/Skip buttons. They
 * duplicated the cockpit's main chat input and confused the model
 * (the operator already has a chat input below). The block now is
 * pure presentation: header + question list + footer hint with the
 * 3 response shortcuts the daemon understands:
 *
 *   - free-form answers to the questions
 *   - `proceed` — run a best-effort pass with defaults
 *   - `rework`  — stop, rework the roadmap with A001 first
 *
 * GREEN doesn't render here — see ValidationGreenBadge.
 */

export const VALIDATION_RED_MARKER = '═══ VALIDATION RED ═══';
export const VALIDATION_GREEN_MARKER = '═══ VALIDATION GREEN ═══';

/** True when the text starts with (or contains as the first non-empty
 *  line) the RED marker. Tolerant to a leading blank line. */
export function isValidationRed(text: string): boolean {
  if (!text) return false;
  const first = text.trimStart().split('\n', 1)[0] ?? '';
  return first.trim() === VALIDATION_RED_MARKER;
}

/** True when the text starts with the GREEN marker. */
export function isValidationGreen(text: string): boolean {
  if (!text) return false;
  const first = text.trimStart().split('\n', 1)[0] ?? '';
  return first.trim() === VALIDATION_GREEN_MARKER;
}

/** Heuristic detector for the "architect halted mid-pass with a
 *  question" failure mode. The chain (catalog → stub-flag → matrix →
 *  consult-A001 → defer) makes voluntary halts impossible in theory.
 *  When the model violates anyway, the cockpit shows a red banner so
 *  the operator knows it's a bug, not a normal stop. */
const HALT_VIOLATION_PATTERNS = [
  /which one\?/i,
  /which path\?/i,
  /\bpick one:/i,
  /two paths:/i,
  /two options:/i,
  /three options:/i,
  /should i .+\bor\b.+\?/i,
  /stopping per sop/i,
  /stopping[ —-]+i need from you/i,
  /halt here until/i,
  /what i need from you to proceed/i,
  /i'?ll default to .+ if you don'?t reply/i,
  /i'?m not going to perform a theatre/i,
  /is months of work.+stop on the first blocker/i,
];
export function isHaltViolation(text: string): boolean {
  if (!text) return false;
  if (isValidationRed(text) || isValidationGreen(text)) return false;
  for (const re of HALT_VIOLATION_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

export default function ValidationBlock(props: { conv: string; text: string }) {
  // Strip the opening + closing fences from the body so we render
  // just the architect's content. Contract: "═══ VALIDATION RED ═══"
  // on the first line, then body, then optional closing "═══" line.
  const body = (): string => {
    const t = props.text.trimStart();
    const lines = t.split('\n');
    if (lines[0]?.trim() === VALIDATION_RED_MARKER) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i]?.trim() ?? '';
      if (ln === '═══' || ln.startsWith('═══')) {
        lines.length = i;
        break;
      }
      if (ln.length > 0) break;
    }
    return lines.join('\n').trim();
  };

  return (
    <div class="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 my-1 max-w-[90%]">
      <div class="flex items-center gap-2 mb-2">
        <span aria-hidden="true" class="text-base">🔍</span>
        <h3 class="text-[13px] font-semibold text-red-200 tracking-tight">
          Roadmap validation — needs your input before the pass starts
        </h3>
      </div>
      <pre class="whitespace-pre-wrap text-[13px] text-gray-200 leading-relaxed font-sans mb-4">{body()}</pre>
      <div class="border-t border-red-500/20 pt-3 text-[12px] text-red-200/90 leading-relaxed">
        <p class="mb-1.5"><span aria-hidden="true">↓</span> Answer below in the chat. Three options:</p>
        <ul class="space-y-1 pl-4 list-none">
          <li>
            <span class="font-mono text-emerald-300/90">free-form</span>
            <span class="text-red-200/70"> — reply with answers to the questions above and I&rsquo;ll re-validate.</span>
          </li>
          <li>
            <span class="font-mono text-emerald-300/90">proceed</span>
            <span class="text-red-200/70"> — skip the questions, run a best-effort pass with defaults.</span>
          </li>
          <li>
            <span class="font-mono text-emerald-300/90">rework</span>
            <span class="text-red-200/70"> — stop the pass. The coordinator (A001) and I will improve the roadmap with you first.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
