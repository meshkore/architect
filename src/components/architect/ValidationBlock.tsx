/**
 * ValidationBlock — V107.
 *
 * Renders the architect's first-turn VALIDATION GATE output.
 *
 * Detects the marker:
 *   ═══ VALIDATION RED ═══
 * inside an assistant message on a roadmap-architect conv, and
 * replaces the default markdown render with a highlighted block:
 * lead text + questions list + a single textarea + submit button.
 *
 * On submit, dispatches a new turn to the SAME conv with the
 * prefix `[validation-answers] <operator text>` so the architect's
 * next turn re-evaluates and either emits VALIDATION GREEN
 * (and starts the pass) or RED again (rare — max 2 iterations
 * by daemon contract).
 *
 * The GREEN marker doesn't need special UI — the architect just
 * proceeds inline. We only intercept RED.
 */

import { Show, createSignal } from 'solid-js';
import { chatStore } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { log } from '~/lib/log';

export const VALIDATION_RED_MARKER = '═══ VALIDATION RED ═══';
export const VALIDATION_GREEN_MARKER = '═══ VALIDATION GREEN ═══';

/** True when the text starts with (or contains as the first non-empty
 *  line) the RED marker. Tolerant to a leading blank line. */
export function isValidationRed(text: string): boolean {
  if (!text) return false;
  const first = text.trimStart().split('\n', 1)[0] ?? '';
  return first.trim() === VALIDATION_RED_MARKER;
}

export default function ValidationBlock(props: { conv: string; text: string }) {
  const [answers, setAnswers] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string | null>(null);

  // Strip the opening + closing fences from the body so we render
  // just the content. The architect contract: "═══ VALIDATION RED ═══"
  // on the first line, then a blank line, then lead text + questions,
  // then a closing "═══" line.
  const body = (): string => {
    const t = props.text.trimStart();
    const lines = t.split('\n');
    // drop the opening fence
    if (lines[0]?.trim() === VALIDATION_RED_MARKER) lines.shift();
    // drop the closing fence (last `═══`-only line)
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

  const onSubmit = async (): Promise<void> => {
    const raw = answers().trim();
    const client = daemonStore.state.client;
    if (!client) {
      setSubmitError('No daemon client');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const text = raw.length > 0
      ? `[validation-answers] ${raw}`
      : '[validation-answers] proceed';
    log.info('[validation] submitting answers', { conv: props.conv, length: raw.length });
    try {
      const res = await chatStore.dispatchMessage(client, {
        conv: props.conv,
        text,
        author: 'operator',
      });
      if (!res.ok) {
        log.warn('[validation] dispatch failed', res.status, res.error);
        setSubmitError(res.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      log.warn('[validation] dispatch threw', e instanceof Error ? e.message : String(e));
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onSkip = (): void => {
    setAnswers('');
    void onSubmit();
  };

  return (
    <div class="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 my-1 max-w-[90%]">
      <div class="flex items-center gap-2 mb-2">
        <span class="font-mono text-[10px] uppercase tracking-wider text-red-300 bg-red-500/15 border border-red-500/40 rounded px-2 py-0.5">
          VALIDATION · RED
        </span>
        <span class="text-[11px] font-mono text-red-300/70">spec-level clarification needed</span>
      </div>
      <pre class="whitespace-pre-wrap text-[13px] text-gray-200 leading-relaxed font-sans mb-3">{body()}</pre>
      <textarea
        value={answers()}
        onInput={(e) => setAnswers(e.currentTarget.value)}
        rows={4}
        disabled={submitting()}
        placeholder="Q1: <your answer>. Q2: <your answer>. ... (or leave empty + Skip to use defaults)"
        class="w-full bg-gray-900/80 border border-gray-700 rounded-md px-3 py-2 text-[13px] text-gray-100 placeholder-gray-600 font-mono focus:outline-none focus:border-red-500/60 resize-y"
      />
      <div class="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => { void onSubmit(); }}
          disabled={submitting()}
          class="px-3 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-wider bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting() ? 'Submitting…' : 'Submit answers'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={submitting()}
          class="px-3 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-wider bg-gray-700/40 hover:bg-gray-700/60 text-gray-300 border border-gray-700/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Use all defaults — the architect will pick the bracketed [default: X] for every question."
        >
          Skip (use defaults)
        </button>
        <Show when={submitError()}>
          <span class="text-[11px] text-red-400 font-mono ml-auto">{submitError()}</span>
        </Show>
      </div>
    </div>
  );
}
