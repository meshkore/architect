/**
 * InitiativeCard — V108 timeline rewrite.
 *
 * Renders ONE story (initiative) as a row on the vertical timeline:
 *
 *   #NN   ●   Initiative title · STATUS
 *               description (clamped)
 *               ● API32  task title …      (only when expanded)
 *               ● WEB21  task title …
 *
 * The component is "controlled" by the parent panel — `props.isOpen`
 * + `props.onToggle` enforce the accordion (only one open at a time).
 *
 * The node ● is the run-control: click it to launch / stop the
 * roadmap architect on this initiative. Click anywhere else on the
 * row to expand/collapse.
 *
 * Pre-V108 version preserved as InitiativeCard.legacy.tsx.bak.
 */

import { For, Show, createEffect, createMemo, createResource, createRoot, createSignal } from 'solid-js';
import type { ServerInitiative, ServerTask } from '~/state/server';
import { activeEntriesByInitiative, activeTaskIds, activeAgentByTask, convForTask } from '~/state/server';
import { sortTasks } from '~/components/initiative/task-grouping';
import { chatStore } from '~/state/chat';
import type { ChatMsg } from '~/state/chat';
import { viewStore } from '~/state/view';
import { daemonStore } from '~/state/daemon';
import { stopArchitect } from '~/lib/architect-dispatch';
import { isQueued as isQueuedFn, stageInitiative, unstageInitiative } from '~/lib/queue';
import { CollapsibleText } from '~/components/ChatBubbles';
import { parseInitiativeBody, displayTaskId } from '~/lib/task-id';

type VisualState = 'active' | 'next' | 'running' | 'backlog' | 'done';

// Task-detail open state lives at MODULE level, keyed by task id — NOT
// inside TaskRow. The cockpit re-polls /state every ~2s and the roadmap
// `<For>` recreates the task rows on each refresh; a per-component signal
// would reset (the detail auto-collapsed after 2s — operator 2026-06-19).
// A module signal survives the recreation, exactly like the story's
// `openId` in the parent panel.
const [expandedTaskIds, setExpandedTaskIds] = createRoot(() => createSignal<Set<string>>(new Set()));
const isTaskOpen = (id: string): boolean => expandedTaskIds().has(id);
function toggleTaskOpen(id: string): void {
  const next = new Set(expandedTaskIds());
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setExpandedTaskIds(next);
}
/** Open every task body in one shot (used by InitiativesPanel's
 *  expand-all). The IDs are the on-disk task ids; passing a Set is fine,
 *  we copy to a new instance so the signal fires. */
export function expandAllTaskRows(ids: Iterable<string>): void {
  setExpandedTaskIds(new Set<string>(ids));
}
/** Collapse every task body. */
export function collapseAllTaskRows(): void {
  setExpandedTaskIds(new Set<string>());
}
// Body cache (task path → markdown) so a row recreated by the 2s poll
// shows its detail instantly instead of re-fetching + flickering.
const taskBodyCache = new Map<string, string>();

export default function InitiativeCard(props: {
  initiative: ServerInitiative;
  tasks: ServerTask[];
  index: number;
  isOpen: boolean;
  isDimmed: boolean;
  onToggle: () => void;
  /** Archived (execution-registry) mode — when expanded, each task row
   *  shows its execution detail: description + resolution summary +
   *  modified files. The card is otherwise rendered exactly like the
   *  active roadmap (same density, same accordion). */
  archived?: boolean;
}) {
  // ── Live agents working on this initiative (daemon-authoritative) ──
  const liveAgentsHere = createMemo(
    () => activeEntriesByInitiative()[props.initiative.id] ?? [],
  );
  const isWorking = (): boolean => liveAgentsHere().length > 0;

  /** In the (ephemeral, in-memory) execution queue. Decoupled from the
   *  roadmap walls — the item stays `active` whether or not it's queued.
   *  The node renders the "queued" glyph in this state so a second click
   *  removes it from the queue. */
  const isQueued = (): boolean => isQueuedFn(props.initiative.id);

  const done = createMemo(() => props.tasks.filter((t) => t.status === 'done').length);
  const isComplete = createMemo(
    () => props.tasks.length > 0 && done() === props.tasks.length,
  );
  /** Distinct module count across this initiative's tasks (Standard §4
   *  requires task.category = module). Empty categories ignored. */
  const moduleCount = createMemo(() => {
    const set = new Set<string>();
    for (const t of props.tasks) {
      const m = (t.category || '').trim();
      if (m) set.add(m);
    }
    return set.size;
  });
  const progressPct = createMemo(() => {
    if (props.tasks.length === 0) return 0;
    return Math.round((done() / props.tasks.length) * 100);
  });

  const isArchived = () =>
    viewStore.isInitiativeArchived(props.initiative.id) &&
    props.initiative.status !== 'active';
  const toggleArchive = (e: MouseEvent): void => {
    e.stopPropagation();
    viewStore.setInitiativeArchived(props.initiative.id, !isArchived());
  };

  /** Derive the visual state used by the node + status label. */
  const vstate = createMemo<VisualState>(() => {
    if (isWorking()) return 'running';
    if (isComplete() || props.initiative.status === 'done') return 'done';
    if (props.initiative.status === 'backlog') return 'backlog';
    if (props.initiative.status === 'next') return 'next';
    // anything else (active, in-progress, undefined) → active treatment
    return 'active';
  });

  // ── Description (lazy fetch + parse — same plumbing as legacy) ──
  // 2026-06-11 — Source intentionally depends ONLY on the initiative
  // path, NOT on `daemonStore.state.client`. On project switch the
  // active client flips BEFORE the parent `<For>` re-renders with the
  // new snapshot — if we made the client part of the source, the
  // resource would re-fire with (newClient, oldPath) and 404 against
  // the new cluster's daemon. By reading the client inside the fetcher
  // only, the resource fires once at mount with the matching client,
  // and the card unmounts cleanly on switch. New cluster → new card →
  // new fetch.
  const [bodyRes] = createResource<string, { path: string }>(
    () => {
      const path = props.initiative.path;
      if (!path) return null;
      return { path };
    },
    async (input) => {
      const client = daemonStore.state.client;
      if (!client) return '';
      const r = await client.readMarkdownFile(input.path);
      return r.ok ? r.body : '';
    },
  );
  const parsed = createMemo(() => parseInitiativeBody(bodyRes() ?? ''));
  const description = (): string => {
    const d = parsed().description;
    if (d) return d.trim();
    const legacy = (props.initiative.body ?? '').trim();
    if (legacy) return legacy;
    return (props.initiative.oneliner ?? '').trim();
  };
  const hasDesc = (): boolean => description().length > 0;
  const isLongDesc = (): boolean => {
    const t = description();
    return t.length > 140 || t.split('\n').length > 2;
  };
  const descExpanded = () => viewStore.isDescriptionExpanded(props.initiative.id);
  const toggleDesc = (e: MouseEvent) => {
    e.stopPropagation();
    viewStore.toggleDescription(props.initiative.id);
  };

  const sorted = createMemo(() => sortTasks(props.tasks));

  /** Promote a backlog initiative onto the active wall (a real roadmap
   *  move, unlike enqueuing). */
  const promoteToActive = async (): Promise<void> => {
    const client = daemonStore.state.client;
    if (!client) return;
    await client.initiativeReorder(props.initiative.id, 'active', 0);
  };

  /** Node click — separate from row click (which toggles open). Action
   *  depends on the state:
   *    running  → stop the architect.
   *    done     → locked (no-op; the work is finished).
   *    backlog  → promote to active (＋ becomes a promote glyph here).
   *    active   → enqueue (＋) / dequeue (queued glyph). Pure in-memory
   *               queue op — nothing on the roadmap moves. */
  const onNodeClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (isWorking()) { void stopArchitect(); return; }
    if (vstate() === 'done') return;
    if (vstate() === 'backlog') { void promoteToActive(); return; }
    if (isQueued()) unstageInitiative(props.initiative.id);
    else stageInitiative(props.initiative.id);
  };

  const onRowKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onToggle();
    }
  };

  const statusLabel = (): string => {
    const s = vstate();
    if (s === 'done') return 'DONE';
    // V107.43 — terminology unified with the chat rail + AgentCard, which
    // both label a live conv "working". The roadmap previously said
    // RUNNING; the operator asked for ONE word everywhere. Internal
    // state name + CSS class stay `running` (theme vars, .is-running).
    if (s === 'running') return 'WORKING';
    return s.toUpperCase();
  };

  const nodeTitle = (): string => {
    if (isWorking()) {
      const who = liveAgentsHere().map((e) => e.agent_id || e.conv).join(' · ');
      return `Stop architect — ${who}`;
    }
    if (vstate() === 'done') return 'Completed — archived (cannot be moved)';
    if (vstate() === 'backlog') return 'Move to active';
    if (isQueued()) return 'Queued — click to remove';
    return `Add to queue — #${props.initiative.id}`;
  };

  let rowRef: HTMLLIElement | undefined;
  // LAL5 — when the initiative was just created by an anchor protocol
  // event, scroll it into view ONCE so the operator's eye lands on it.
  // The recently-created flag flips back to false after 10s; the effect
  // only fires while true, and only once per row mount.
  let scrolledOnce = false;
  createEffect(() => {
    if (
      !scrolledOnce &&
      viewStore.isRecentlyCreatedInit(props.initiative.id) &&
      rowRef
    ) {
      scrolledOnce = true;
      rowRef.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  return (
    <li
      ref={(el) => { rowRef = el; }}
      class={`rt-story is-${vstate()} ${props.isOpen ? 'open' : ''} ${
        props.isDimmed ? 'dim' : ''
      }${viewStore.isRecentlyCreatedInit(props.initiative.id) ? ' is-flash-new' : ''}`}
    >
      {/* Story number — left of the line, mono */}
      <span class="rt-number" aria-hidden="true">
        #{String(props.index).padStart(2, '0')}
      </span>

      {/* Node = play/stop control. `--progress` drives the conic-gradient
       *  ring around the circle (0..1 fraction of tasks done). */}
      <button
        type="button"
        class={`rt-node is-${vstate()}${isQueued() && vstate() !== 'running' && vstate() !== 'done' && vstate() !== 'backlog' ? ' is-queued' : ''}`}
        style={{ '--progress': String(progressPct() / 100) }}
        onClick={onNodeClick}
        disabled={vstate() === 'done'}
        title={nodeTitle()}
        aria-label={nodeTitle()}
      >
        {/* running → stop */}
        <Show when={vstate() === 'running'}>
          <span class="rt-stop" aria-hidden="true" />
        </Show>
        {/* done → ✓ (locked) */}
        <Show when={vstate() === 'done'}>
          <svg class="rt-check" viewBox="0 0 24 24" width="12" height="12" fill="none"
            stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7" />
          </svg>
        </Show>
        {/* backlog → promote-to-active (up arrow) */}
        <Show when={vstate() === 'backlog'}>
          <svg class="rt-promote" viewBox="0 0 24 24" width="13" height="13" fill="none"
            stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 19V6M6 12l6-6 6 6" />
          </svg>
        </Show>
        {/* active + queued → "in queue" glyph (stacked list); click removes */}
        <Show when={vstate() !== 'running' && vstate() !== 'done' && vstate() !== 'backlog' && isQueued()}>
          <svg class="rt-queued" viewBox="0 0 24 24" width="13" height="13" fill="none"
            stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h10" />
          </svg>
        </Show>
        {/* active + not queued → chunky ＋ (enqueue) */}
        <Show when={vstate() !== 'running' && vstate() !== 'done' && vstate() !== 'backlog' && !isQueued()}>
          <svg class="rt-plus" viewBox="0 0 24 24" width="14" height="14" fill="none"
            stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </Show>
      </button>

      {/* Secondary control (archive) — fades in on hover/open. Stroke
       *  SVG replaces the old 🗃 / ↺ emoji (rendered inconsistently
       *  across fonts; operator field report 2026-06-20). */}
      <span class="rt-secondary" aria-hidden="false">
        <button
          type="button"
          class="rt-icon-btn"
          onClick={toggleArchive}
          title={isArchived() ? 'Restore to active list' : 'Hide from active list'}
          aria-label={isArchived() ? 'Restore initiative' : 'Archive initiative'}
        >
          <Show
            when={isArchived()}
            fallback={
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="4" rx="1" />
                <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
                <path d="M10 12h4" />
              </svg>
            }
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          </Show>
        </button>
      </span>

      <div class="rt-row">
        {/* Expand/collapse the story ONLY from the title row (operator
            2026-06-19) — clicking the meta/desc/tasks must not toggle it. */}
        <div
          class="rt-title-row rt-title-row-toggle"
          role="button"
          tabIndex={0}
          aria-expanded={props.isOpen}
          onClick={props.onToggle}
          onKeyDown={onRowKey}
        >
          <Show when={props.initiative.id}>
            <span class="rt-id" aria-label={`initiative id ${props.initiative.id}`}>
              #{props.initiative.id}
            </span>
          </Show>
          <h3 class="rt-title">{props.initiative.title}</h3>
          <span class={`rt-statlabel is-${vstate()}`}>{statusLabel()}</span>
          <Show when={viewStore.isRecentlyCreatedInit(props.initiative.id)}>
            <span class="rt-new-badge" aria-label="just created">✨ NEW</span>
          </Show>
          <Show when={isArchived()}>
            <span class="rt-archived-tag">ARCHIVED</span>
          </Show>
        </div>

        <div class="rt-meta">
          <span class="rt-badge rt-badge-tasks" title={`${done()} of ${props.tasks.length} tasks done`}>
            <Show when={props.tasks.length > 0} fallback={<span class="rt-badge-dot" />}>
              <span class="rt-progress" aria-hidden="true">
                <span class="rt-progress-fill" style={{ width: `${progressPct()}%` }} />
              </span>
            </Show>
            <span>
              {props.tasks.length > 0 ? `${done()}/${props.tasks.length}` : '0'}
              <span style={{ opacity: .55 }}> tasks</span>
            </span>
          </span>
          <Show when={moduleCount() > 0}>
            <span class="rt-badge rt-badge-modules" title={`${moduleCount()} module${moduleCount() === 1 ? '' : 's'} touched`}>
              <span class="rt-badge-dot" />
              <span>
                {moduleCount()}
                <span style={{ opacity: .55 }}> module{moduleCount() === 1 ? '' : 's'}</span>
              </span>
            </span>
          </Show>
        </div>

        <Show when={hasDesc()}>
          <p
            class={`rt-desc ${descExpanded() ? '' : 'rt-desc-clamp'}`}
            onClick={(e) => e.stopPropagation()}
          >
            {description()}
          </p>
          <Show when={isLongDesc()}>
            <button
              type="button"
              class="rt-toggle-more"
              onClick={toggleDesc}
            >
              {descExpanded() ? '— show less' : '+ show more'}
            </button>
          </Show>
        </Show>
      </div>

      {/* Body — tasks render on open (accordion). Identical in every view;
       *  archived adds the per-task execution detail (registry). */}
      <Show when={props.isOpen}>
        <div class="rt-body open">
          <Show
            when={sorted().length > 0}
            fallback={
              <p class="rt-desc" style={{ 'font-style': 'italic', opacity: 0.7 }}>
                No tasks linked to this initiative yet.
              </p>
            }
          >
            <ul class="rt-tasks">
              <For each={sorted()}>
                {(t) => <TaskRow task={t} archived={props.archived} />}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </li>
  );
}

/* V107.43 — Task-row redesign (operator field report 2026-06-13).
 *
 * Reading left → right (people scan from the left):
 *
 *   [state]  [code]   task title …………………………………   [module] [module]
 *
 *   - state  — an explicit glyph (the FIRST thing the eye meets):
 *                pending  → hollow square (checkbox)
 *                active   → hollow ring (ready / up next)
 *                working  → SPINNER, and the title softly blinks
 *                blocked  → "!"
 *                done     → ✓
 *   - code   — fixed-width, dimmed (the title carries the meaning, the
 *              code "no aporta mucha información" per the operator).
 *   - title  — the star; blinks softly in the working hue while live.
 *   - module — moved to the FAR RIGHT (was the ACTIVE/BACKLOG/DONE
 *              label). One badge per module; usually one (a task owns a
 *              single module, Standard §4), but the runner can fan out
 *              several workers across modules at once, so we render a
 *              list.
 *
 * "working" is DERIVED LIVE from `activeTaskIds()` (a daemon-authoritative
 * set of task_ids with a streaming conv), NOT from the on-disk status.
 * Because every row checks the set independently, N tasks across N
 * modules can all show the spinner + blink simultaneously. */

type TaskVState = 'done' | 'working' | 'active' | 'blocked' | 'pending';

function taskVState(task: ServerTask, live: boolean): TaskVState {
  if (live) return 'working';
  const s = (task.status || '').toLowerCase();
  if (s === 'done') return 'done';
  if (s === 'blocked') return 'blocked';
  if (s === 'active' || s === 'in_progress' || s === 'in-progress') return 'active';
  return 'pending'; // next, planned, backlog, draft, pending_operator, …
}

function taskModules(task: ServerTask): string[] {
  const raw = task as Record<string, unknown>;
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

type SummaryView = 'des' | 'res';

function TaskRow(props: { task: ServerTask; archived?: boolean }) {
  const live = (): boolean => activeTaskIds().has(props.task.id);
  const vstate = (): TaskVState => taskVState(props.task, live());
  const mods = (): string[] => taskModules(props.task);
  const stateTitle = (): string => TASK_STATE_TITLE[vstate()];

  // Body fetch lives at row-level now (RTR2) so both the always-visible
  // summary line and the deep-expanded TaskDetail share one read. Cached
  // by path; the 2s /state poll re-creates the row but the cache prevents
  // re-fetch flicker.
  const [bodyRes] = createResource<string, { path: string }>(
    () => (props.task.path ? { path: props.task.path } : null),
    async (input) => {
      const client = daemonStore.state.client;
      if (!client) return taskBodyCache.get(input.path) ?? '';
      const r = await client.readMarkdownFile(input.path);
      const text = r.ok ? r.body : '';
      if (text) taskBodyCache.set(input.path, text);
      return text;
    },
  );
  const body = (): string =>
    bodyRes() ?? (props.task.path ? taskBodyCache.get(props.task.path) ?? '' : '');
  const description = (): string => extractDescription(body());
  const resolution = (): string => extractResolution(body());
  const hasRes = (): boolean => resolution().length > 0;
  const hasDes = (): boolean => description().length > 0;

  // Default view: tasks WITH a resolution show RES; everything else DES.
  // The operator can flip it manually per task.
  const [viewOverride, setViewOverride] = createSignal<SummaryView | null>(null);
  const view = (): SummaryView => {
    const o = viewOverride();
    if (o) return o;
    return hasRes() ? 'res' : 'des';
  };
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
          {/* Explicit status glyph — first thing read on the row. */}
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
         *  something to show; clamped 2-3 lines via CollapsibleText. */}
        <Show when={summaryText().length > 0}>
          <div
            class={`rt-task-summary rt-task-summary-${view()}${resOutcomeClass()}`}
            onClick={(e) => e.stopPropagation()}
          >
            <CollapsibleText text={summaryText()} markdown />
          </div>
        </Show>
      </div>

      {/* Inline detail on click — description always; + execution summary
       *  + modified files when archived (the registry). */}
      <Show when={open()}>
        <TaskDetail task={props.task} archived={props.archived} body={body()} />
      </Show>
    </li>
  );
}

// ── Archived per-task detail = the execution registry ─────────────────
// Each archived task is the canonical record of what was done: its
// description, the execution summary (`## Resolution`, Standard v26), and
// the files/scripts that were modified. This is the source the diary is
// generated from, so it deliberately drops the in-flight noise (live
// output, spinners) and keeps the durable facts.

function fmtStamp(iso: string): string {
  if (!iso || iso.length < 16) return '';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`; // YYYY-MM-DD HH:MM
}

/** Pull the `## Resolution` section body out of a task .md (Standard v26). */
function extractResolution(body: string): string {
  const m = /^##\s+Resolution[ \t]*$([\s\S]*?)(?=^##\s|\Z)/m.exec(body);
  return m ? (m[1] ?? '').trim() : '';
}

/** The task description = the body intro (after frontmatter + H1 title,
 *  before the first `##` section). */
function extractDescription(body: string): string {
  let b = body.replace(/^---\n[\s\S]*?\n---\n?/, ''); // strip frontmatter
  b = b.replace(/^#\s+.*\n?/, '');                     // strip H1 title
  const idx = b.search(/^##\s/m);
  return (idx >= 0 ? b.slice(0, idx) : b).trim();
}

/** Files modified by the task — `files_changed` once the daemon records
 *  it (QX5); falls back to the commit SHAs we already persist. */
function taskFiles(task: ServerTask): string[] {
  const raw = task as Record<string, unknown>;
  const fc = Array.isArray(raw.files_changed) ? (raw.files_changed as unknown[]) : null;
  if (fc) return fc.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return [];
}
function taskCommits(task: ServerTask): string[] {
  const raw = task as Record<string, unknown>;
  const cs = Array.isArray(raw.commit_shas) ? (raw.commit_shas as unknown[]) : null;
  if (cs) return cs.filter((x): x is string => typeof x === 'string' && x.length > 0).map((s) => s.slice(0, 9));
  return [];
}

function TaskDetail(props: { task: ServerTask; archived?: boolean; body: string }) {
  const conv = createMemo<string | undefined>(() => convForTask(props.task.id));

  // Body is fetched at TaskRow level (RTR2) and threaded in.
  const body = (): string => props.body;

  // Fallback summary: the live conv's final message, for tasks resolved
  // before the daemon began persisting `## Resolution` (graceful).
  const convFinal = (): string => {
    const c = conv();
    const msgs = c ? (chatStore.state.convMap[c] ?? []) : [];
    const m = [...msgs].reverse().find((x: ChatMsg) => x.kind === 'assistant' && !x.streaming && !x.cancelled);
    return (m?.text ?? '').trim();
  };

  const resolution = (): string => extractResolution(body()) || convFinal();
  const files = (): string[] => taskFiles(props.task);
  const commits = (): string[] => taskCommits(props.task);
  const completedStamp = (): string => fmtStamp(String(props.task.completed_at ?? ''));
  const resolvedBy = (): string =>
    String(props.task.resolved_by ?? '') ||
    activeAgentByTask()[props.task.id] ||
    chatStore.state.convs[conv() ?? '']?.agent_id ||
    '—';

  return (
    <div class="rt-arch-detail" onClick={(e) => e.stopPropagation()}>
      {/* who/when — only meaningful for finished (archived) work */}
      <Show when={props.archived && (resolvedBy() !== '—' || completedStamp())}>
        <div class="rt-arch-meta">
          <span class="rt-task-agent">{resolvedBy()}</span>
          <Show when={completedStamp()}>
            <span class="rt-arch-stamp">· {completedStamp()}</span>
          </Show>
        </div>
      </Show>

      {/* RTR2 — description no longer repeated here; it's the default
       *  summary line under the title. Deep expand stays focused on the
       *  execution registry (agent, stamp, resolution, files). */}

      {/* execution summary + files — only for archived (the registry) */}
      <Show when={props.archived && resolution()}>
        <div class="rt-arch-block">
          <span class="rt-arch-label">resumen</span>
          <div class="rt-arch-body"><CollapsibleText text={resolution()} markdown /></div>
        </div>
      </Show>

      <Show when={props.archived && (files().length > 0 || commits().length > 0)}>
        <div class="rt-arch-block">
          <span class="rt-arch-label">{files().length > 0 ? 'ficheros' : 'commits'}</span>
          <div class="rt-arch-files">
            <For each={files().length > 0 ? files() : commits()}>
              {(f) => <code class="rt-arch-file">{f}</code>}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
