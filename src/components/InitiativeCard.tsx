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

import { For, Show, createEffect, createMemo, createResource, createSignal } from 'solid-js';
import type { ServerInitiative, ServerTask } from '~/state/server';
import { activeEntriesByInitiative, activeTaskIds, activeAgentByTask, convForTask } from '~/state/server';
import { sortTasks } from '~/components/initiative/task-grouping';
import { chatStore } from '~/state/chat';
import type { ChatMsg } from '~/state/chat';
import { viewStore } from '~/state/view';
import { daemonStore } from '~/state/daemon';
import { stopArchitect } from '~/lib/architect-dispatch';
import { isQueuedStatus, stageInitiative, unstageInitiative } from '~/lib/queue';
import { CollapsibleText } from '~/components/ChatBubbles';
import { parseInitiativeBody, displayTaskId } from '~/lib/task-id';

type VisualState = 'active' | 'next' | 'running' | 'backlog' | 'done';

export default function InitiativeCard(props: {
  initiative: ServerInitiative;
  tasks: ServerTask[];
  index: number;
  isOpen: boolean;
  isDimmed: boolean;
  onToggle: () => void;
  /** Queue wall mode — tasks always render (no accordion) and each row
   *  gets the rich live-output / summary detail below its title. */
  wall?: boolean;
}) {
  // ── Live agents working on this initiative (daemon-authoritative) ──
  const liveAgentsHere = createMemo(
    () => activeEntriesByInitiative()[props.initiative.id] ?? [],
  );
  const isWorking = (): boolean => liveAgentsHere().length > 0;

  /** Staged for execution — sits in the shared `next` wall (status:next),
   *  persisted on disk so a CLI agent sees it too. The node renders ✕ in
   *  this state so a second click un-stages. */
  const isQueued = (): boolean => isQueuedStatus(props.initiative.status);

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

  /** Node click — separate from row click (which toggles open).
   *  py-1.22+ (Queue wall): the ▶ no longer dispatches directly. It
   *  STAGES the initiative into the queue (▶ → ✕). Execution is a
   *  separate, deliberate step ("Ejecutar cola" / RUN ALL). While an
   *  agent is working the node is the stop control, unchanged. */
  const onNodeClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (isWorking()) {
      void stopArchitect();
      return;
    }
    if (vstate() === 'done') return;
    if (isQueued()) void unstageInitiative(props.initiative.id);
    else void stageInitiative(props.initiative.id);
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
    if (vstate() === 'done') return 'Iniciativa completa';
    if (isQueued()) return 'En cola — clic para sacarla de la cola';
    return `Añadir a la cola — #${props.initiative.id}`;
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
      tabIndex={0}
      role="button"
      aria-expanded={props.isOpen}
      onClick={props.onToggle}
      onKeyDown={onRowKey}
    >
      {/* Story number — left of the line, mono */}
      <span class="rt-number" aria-hidden="true">
        #{String(props.index).padStart(2, '0')}
      </span>

      {/* Node = play/stop control. `--progress` drives the conic-gradient
       *  ring around the circle (0..1 fraction of tasks done). */}
      <button
        type="button"
        class={`rt-node is-${vstate()}${isQueued() && vstate() !== 'running' && vstate() !== 'done' ? ' is-queued' : ''}`}
        style={{ '--progress': String(progressPct() / 100) }}
        onClick={onNodeClick}
        disabled={vstate() === 'done'}
        title={nodeTitle()}
        aria-label={nodeTitle()}
      >
        <Show when={vstate() === 'running'}>
          <span class="rt-stop" aria-hidden="true" />
        </Show>
        <Show when={vstate() === 'done'}>
          <svg
            class="rt-check"
            viewBox="0 0 24 24"
            width="11"
            height="11"
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
        {/* Staged (not yet running) → ✕ so a second click un-stages. */}
        <Show when={vstate() !== 'running' && vstate() !== 'done' && isQueued()}>
          <svg
            class="rt-x"
            viewBox="0 0 24 24"
            width="11"
            height="11"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Show>
        {/* Idle, stageable → ▶ */}
        <Show when={vstate() !== 'running' && vstate() !== 'done' && !isQueued()}>
          <span class="rt-play" aria-hidden="true" />
        </Show>
      </button>

      {/* Secondary control (archive) — fades in on hover/open */}
      <span class="rt-secondary" aria-hidden="false">
        <button
          type="button"
          class="rt-icon-btn"
          onClick={toggleArchive}
          title={isArchived() ? 'Restore to active list' : 'Hide from active list'}
          aria-label={isArchived() ? 'Restore initiative' : 'Archive initiative'}
        >
          {isArchived() ? '↺' : '🗃'}
        </button>
      </span>

      <div class="rt-row">
        <div class="rt-title-row">
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

      {/* Body — tasks render on open; in the wall they're always shown
       *  so the operator watches the story fill in real time. */}
      <Show when={props.isOpen || props.wall}>
        <div class={`rt-body ${props.isOpen || props.wall ? 'open' : ''}`}>
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
                {(t) => <TaskRow task={t} wall={props.wall} />}
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
  working: 'En curso — un agente está trabajando en esta tarea ahora',
  done: 'Completada',
  active: 'Activa — lista para arrancar',
  blocked: 'Bloqueada',
  pending: 'Pendiente',
};

function TaskRow(props: { task: ServerTask; wall?: boolean }) {
  const live = (): boolean => activeTaskIds().has(props.task.id);
  const vstate = (): TaskVState => taskVState(props.task, live());
  const mods = (): string[] => taskModules(props.task);
  const stateTitle = (): string => TASK_STATE_TITLE[vstate()];
  return (
    <li class={`rt-task is-${vstate()}${props.wall ? ' rt-task-wall' : ''}`}>
      {/* Timeline thread marker — neutral, lights up only where work is
       *  live so the eye lands on the exact point of the roadmap that is
       *  active right now. */}
      <span class="rt-task-node" aria-hidden="true" />

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
      <span class="rt-task-text" title={props.task.title}>
        {props.task.title}
      </span>

      <Show when={mods().length > 0}>
        <span class="rt-task-mods">
          <For each={mods()}>
            {(m) => (
              <span class="rt-task-mod" title={`Módulo: ${m}`}>
                {m}
              </span>
            )}
          </For>
        </span>
      </Show>

      {/* Queue wall — agent box + live output while working; collapsed
       *  "ejecutado · hora · tokens ▾" summary line once finished. */}
      <Show when={props.wall}>
        <TaskWallDetail task={props.task} live={live()} />
      </Show>
    </li>
  );
}

// ── Queue-wall per-task detail (live output + collapsible summary) ─────

function fmtStamp(iso: string): string {
  if (!iso || iso.length < 16) return '';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`; // YYYY-MM-DD HH:MM
}

/** Pull the `## Resolution` section body out of a task .md (Standard v26). */
function extractResolution(body: string): string {
  const m = /^##\s+Resolution[ \t]*$([\s\S]*?)(?=^##\s|\Z)/m.exec(body);
  return m ? (m[1] ?? '').trim() : '';
}

function TaskWallDetail(props: { task: ServerTask; live: boolean }) {
  const [expanded, setExpanded] = createSignal(false);
  const conv = createMemo<string | undefined>(() => convForTask(props.task.id));

  // Live output needs the conv's streaming messages. Lazy-hydrate once we
  // know the conv (WS deltas keep it fresh after the first load).
  createEffect(() => {
    if (!props.live) return;
    const c = conv();
    if (!c) return;
    const have = chatStore.state.convMap[c];
    if (have && have.length > 0) return;
    const client = daemonStore.state.client;
    if (!client) return;
    void chatStore.loadConvMessagesPage(client, c, { limit: 8 });
  });

  const msgs = (): ChatMsg[] => {
    const c = conv();
    return c ? (chatStore.state.convMap[c] ?? []) : [];
  };
  const liveTail = (): string => {
    const m = [...msgs()].reverse().find((x) => x.kind === 'assistant' && x.streaming);
    const t = (m?.text ?? '').trim();
    return t.split('\n').slice(-6).join('\n');
  };

  // ── Persisted resolution (Standard v26) — survives reloads ──
  // Frontmatter pointers come from /state; the rich body is fetched on
  // expand. Falls back to the live conv's final message for tasks
  // resolved before the daemon started persisting (graceful transition).
  const [bodyRes] = createResource<string, { path: string }>(
    () =>
      expanded() && !props.live && props.task.path
        ? { path: props.task.path }
        : null,
    async (input) => {
      const client = daemonStore.state.client;
      if (!client) return '';
      const r = await client.readMarkdownFile(input.path);
      return r.ok ? r.body : '';
    },
  );
  const convFinal = (): string => {
    const m = [...msgs()].reverse().find(
      (x) => x.kind === 'assistant' && !x.streaming && !x.cancelled,
    );
    return (m?.text ?? '').trim();
  };
  const resolutionText = (): string => extractResolution(bodyRes() ?? '') || convFinal();

  const completedStamp = (): string =>
    fmtStamp(String(props.task.completed_at ?? ''));
  const resolvedBy = (): string =>
    activeAgentByTask()[props.task.id] ||
    String(props.task.resolved_by ?? '') ||
    chatStore.state.convs[conv() ?? '']?.agent_id ||
    conv() ||
    '—';
  // A finished task shows the summary line when it has a persisted record
  // OR (pre-bump) a recoverable conv final.
  const hasResolution = (): boolean =>
    !!props.task.completed_at || !!convFinal();

  return (
    <div class="rt-tw-detail" onClick={(e) => e.stopPropagation()}>
      {/* While an agent is on this task: who + a live peek at its output. */}
      <Show when={props.live}>
        <div class="rt-tw-agentline">
          <span class="rt-task-agent">{resolvedBy()}</span>
          <span class="rt-tw-livedot" aria-hidden="true" />
          <span class="rt-tw-working">trabajando…</span>
        </div>
        <Show when={liveTail()}>
          <div class="rt-tw-output">{liveTail()}</div>
        </Show>
      </Show>

      {/* Once finished: one collapsed line that unfolds the full summary. */}
      <Show when={!props.live && hasResolution()}>
        <button
          type="button"
          class="rt-tw-sumline"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded()); }}
          title="Desplegar el resumen de esta tarea"
        >
          <span class="rt-tw-tri">{expanded() ? '▾' : '▸'}</span>
          <span class="rt-task-agent">{resolvedBy()}</span>
          <span class="rt-tw-meta">
            ejecutado
            <Show when={completedStamp()}>{' '}{completedStamp()}</Show>
          </span>
        </button>
        <Show when={expanded()}>
          <div class="rt-tw-summary">
            <CollapsibleText text={resolutionText()} markdown />
          </div>
        </Show>
      </Show>
    </div>
  );
}
