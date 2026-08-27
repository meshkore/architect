/**
 * TaskRow — one task on the roadmap timeline (V107.43 redesign,
 * operator field report 2026-06-13).
 *
 * Reading left → right (people scan from the left):
 *
 *   [state]  [code]   task title …………………………………   [DES|RES]
 *
 *   - state  — an explicit glyph (the FIRST thing the eye meets):
 *                pending  → hollow square (checkbox)
 *                active   → hollow ring (ready / up next)
 *                working  → SPINNER, and the title softly blinks
 *                blocked  → "!"
 *                done     → ✓
 *   - code   — fixed-width, dimmed (the title carries the meaning).
 *   - title  — the star; blinks softly in the working hue while live.
 *
 * "working" is DERIVED LIVE from `activeTaskIds()` (a daemon-authoritative
 * set of task_ids with a streaming conv), NOT from the on-disk status.
 * Because every row checks the set independently, N tasks across N
 * modules can all show the spinner + blink simultaneously.
 */

import { Show, createSignal } from 'solid-js';
import type { ServerTask } from '~/state/server';
import { activeTaskIds } from '~/state/server';
import { displayTaskId } from '~/lib/task-id';
import { useMarkdownFile } from '~/lib/use-markdown-file';
import { extractDescription, extractResolution } from '~/lib/task-md';
import { CollapsibleText } from '~/components/ui/CollapsibleText';
import { isTaskOpen, toggleTaskOpen } from '~/components/initiative/task-expand-state';
import { TaskDetail } from '~/components/initiative/TaskDetail';

type TaskVState = 'done' | 'working' | 'active' | 'blocked' | 'pending';
type SummaryView = 'des' | 'res';

function taskVState(task: ServerTask, live: boolean): TaskVState {
  if (live) return 'working';
  const s = (task.status || '').toLowerCase();
  if (s === 'done') return 'done';
  if (s === 'blocked') return 'blocked';
  if (s === 'active' || s === 'in_progress' || s === 'in-progress') return 'active';
  return 'pending'; // next, planned, backlog, draft, pending_operator, …
}

/** The task's module badges. Usually one (a task owns a single module,
 *  Standard §4), but the runner can fan several workers across modules. */
function taskModules(task: ServerTask): string[] {
  const raw = task as unknown as Record<string, unknown>;
  const arr = Array.isArray(raw.modules) ? (raw.modules as unknown[]) : null;
  if (arr) {
    return arr
      .map((m) => (typeof m === 'string' ? m : (m as { id?: string })?.id))
      .filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  const single = (task.module || task.category || '').trim();
  return single ? [single] : [];
}

const TASK_STATE_TITLE: Record<TaskVState, string> = {
  working: 'In progress — an agent is working on this task now',
  done: 'Completed',
  active: 'Active — ready to start',
  blocked: 'Blocked',
  pending: 'Pending',
};

export function TaskRow(props: { task: ServerTask; archived?: boolean }) {
  const live = (): boolean => activeTaskIds().has(props.task.id);
  const vstate = (): TaskVState => taskVState(props.task, live());
  const mods = (): string[] => taskModules(props.task);
  const stateTitle = (): string => TASK_STATE_TITLE[vstate()];

  // Body fetch lives at row level (RTR2) so both the always-visible
  // summary line and the deep-expanded TaskDetail share one read.
  const file = useMarkdownFile(() => props.task.path ?? null);
  const description = (): string => extractDescription(file.body());
  const resolution = (): string => extractResolution(file.body());
  const hasRes = (): boolean => resolution().length > 0;
  const hasDes = (): boolean => description().length > 0;

  // Default view: tasks WITH a resolution show RES; everything else DES.
  // The operator can flip it manually per task.
  const [viewOverride, setViewOverride] = createSignal<SummaryView | null>(null);
  const view = (): SummaryView => viewOverride() ?? (hasRes() ? 'res' : 'des');
  const summaryText = (): string => (view() === 'res' ? resolution() : description());

  // Colour the RES (result) line by OUTCOME so the operator scanning a running
  // queue tells success from failure from needs-input at a glance:
  //   done → ok (blue)   blocked → err (red)   pending-operator → wait (amber)
  // DES (the brief) stays neutral. Empty for non-res views.
  const resOutcomeClass = (): string => {
    if (view() !== 'res') return '';
    const st = (props.task.status || '').toLowerCase();
    if (vstate() === 'done') return ' rt-task-summary-ok';
    if (vstate() === 'blocked') return ' rt-task-summary-err';
    if (st === 'pending_operator' || st === 'pending-operator') return ' rt-task-summary-wait';
    return '';
  };

  // Toggle the deep inline detail from the TITLE only (operator 2026-06-19) —
  // open state is module-level so it survives the 2s /state poll.
  const open = (): boolean => isTaskOpen(props.task.id);
  const toggle = (e: MouseEvent): void => {
    e.stopPropagation();
    toggleTaskOpen(props.task.id);
  };

  const modsLabel = (): string => {
    const m = mods();
    if (m.length === 0) return props.task.title;
    return `${props.task.title} · ${m.length === 1 ? 'module' : 'modules'}: ${m.join(', ')}`;
  };

  const onPickView = (v: SummaryView, e: MouseEvent): void => {
    e.stopPropagation();
    if (v === 'res' && !hasRes()) return;
    setViewOverride(v);
  };

  return (
    <li
      class={`rt-task is-${vstate()}${props.archived ? ' rt-task-archived' : ''}${open() ? ' rt-task-open' : ''}`}
    >
      {/* Timeline thread marker — neutral, lights up only where work is
       *  live so the eye lands on the exact point of the roadmap that is
       *  active right now. */}
      <span class="rt-task-node" aria-hidden="true" />

      <div class="rt-task-main">
        <div class="rt-task-line">
          <span class="rt-task-state" title={stateTitle()} aria-label={stateTitle()}>
            <Show when={vstate() === 'working'}>
              <span class="rt-task-spinner" aria-hidden="true" />
            </Show>
            <Show when={vstate() === 'done'}>
              <svg
                class="rt-task-check"
                viewBox="0 0 24 24"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
            </Show>
            <Show when={vstate() === 'blocked'}>
              <span class="rt-task-bang" aria-hidden="true">!</span>
            </Show>
            <Show when={vstate() === 'active'}>
              <span class="rt-task-ring" aria-hidden="true" />
            </Show>
            <Show when={vstate() === 'pending'}>
              <span class="rt-task-box" aria-hidden="true" />
            </Show>
          </span>

          <span class="rt-task-code" title={props.task.id}>
            {displayTaskId(props.task.id)}
          </span>
          <span
            class="rt-task-text rt-task-toggle"
            title={modsLabel()}
            role="button"
            tabIndex={0}
            onClick={toggle}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e as unknown as MouseEvent); } }}
          >
            {props.task.title}
          </span>

          {/* RTR2 — DES/RES selector took the modules slot. Modules moved
           *  into the title's tooltip (zero pixel cost). RES is disabled
           *  until the task has a `## Resolution` body. */}
          <span class="rt-task-views" role="group" aria-label="Summary view">
            <button
              type="button"
              class={`rt-task-view-btn${view() === 'des' ? ' is-active' : ''}`}
              onClick={(e) => onPickView('des', e)}
              disabled={!hasDes()}
              title="Description"
              aria-pressed={view() === 'des'}
            >
              DES
            </button>
            <button
              type="button"
              class={`rt-task-view-btn${view() === 'res' ? ' is-active' : ''}`}
              onClick={(e) => onPickView('res', e)}
              disabled={!hasRes()}
              title={hasRes() ? 'Execution result' : 'No result yet'}
              aria-pressed={view() === 'res'}
            >
              RES
            </button>
          </span>
        </div>

        {/* RTR2 — summary line under the title. Always visible when there's
         *  something to show; ~2 lines of the 11px summary, then "show
         *  more" — a teaser per row, not the full summary inline. */}
        <Show when={summaryText().length > 0}>
          <div
            class={`rt-task-summary rt-task-summary-${view()}${resOutcomeClass()}`}
            onClick={(e) => e.stopPropagation()}
          >
            <CollapsibleText text={summaryText()} markdown collapsedMaxPx={40} />
          </div>
        </Show>
      </div>

      <Show when={open()}>
        <TaskDetail task={props.task} archived={props.archived} body={file.body()} />
      </Show>
    </li>
  );
}

export default TaskRow;
