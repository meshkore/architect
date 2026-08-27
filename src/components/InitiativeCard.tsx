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
 * AX14 split the rest out: the task rows live in `initiative/TaskRow`,
 * their open state in `initiative/task-expand-state`, and the markdown
 * parsers in `lib/task-md`.
 */

import { For, Show, createEffect, createMemo } from 'solid-js';
import type { ServerInitiative, ServerTask } from '~/state/server';
import { activeEntriesByInitiative } from '~/state/server';
import { sortTasks } from '~/components/initiative/task-grouping';
import { TaskRow } from '~/components/initiative/TaskRow';
import { ArchiveToggle, InitiativeNode, type VisualState } from '~/components/initiative/InitiativeNode';
import { viewStore } from '~/state/view';
import { daemonStore } from '~/state/daemon';
import { stopArchitect } from '~/lib/architect-dispatch';
import { isQueued as isQueuedFn, stageInitiative, unstageInitiative } from '~/lib/queue';
import { useMarkdownFile } from '~/lib/use-markdown-file';
import { parseInitiativeBody } from '~/lib/task-id';

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

  // ── Description (lazy fetch + parse) ──
  const file = useMarkdownFile(() => props.initiative.path ?? null);
  const parsed = createMemo(() => parseInitiativeBody(file.body()));
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

      <InitiativeNode
        vstate={vstate()}
        progressPct={progressPct()}
        queued={isQueued()}
        title={nodeTitle()}
        onClick={onNodeClick}
      />
      <ArchiveToggle archived={isArchived()} onToggle={toggleArchive} />

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
