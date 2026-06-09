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

import { For, Show, createMemo, createResource } from 'solid-js';
import type { ServerInitiative, ServerTask } from '~/state/server';
import { activeEntriesByInitiative } from '~/state/server';
import { sortTasks } from '~/components/initiative/task-grouping';
import { chatStore } from '~/state/chat';
import { viewStore } from '~/state/view';
import { daemonStore } from '~/state/daemon';
import { runArchitectOnScope, stopArchitect } from '~/lib/architect-dispatch';
import { parseInitiativeBody, displayTaskId } from '~/lib/task-id';

type VisualState = 'active' | 'next' | 'running' | 'backlog' | 'done';

export default function InitiativeCard(props: {
  initiative: ServerInitiative;
  tasks: ServerTask[];
  index: number;
  isOpen: boolean;
  isDimmed: boolean;
  onToggle: () => void;
}) {
  // ── Live agents working on this initiative (daemon-authoritative) ──
  const liveAgentsHere = createMemo(
    () => activeEntriesByInitiative()[props.initiative.id] ?? [],
  );
  const isWorking = (): boolean => liveAgentsHere().length > 0;

  /** Other activity = anything live in this cluster not on this
   *  initiative. Used to disable the run button so we never spawn a
   *  second architect over a busy roadmap. */
  const otherActivityLive = createMemo<boolean>(() => {
    for (const c of Object.values(chatStore.state.convs)) {
      if (!c.live && !c.coordinating) continue;
      if (c.initiative_id === props.initiative.id) continue;
      return true;
    }
    return false;
  });

  const done = createMemo(() => props.tasks.filter((t) => t.status === 'done').length);
  const isComplete = createMemo(
    () => props.tasks.length > 0 && done() === props.tasks.length,
  );

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
  const [bodyRes] = createResource<string, { path: string }>(
    () => {
      const client = daemonStore.state.client;
      const path = props.initiative.path;
      if (!client || !path) return null;
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

  /** Node click — separate from row click (which toggles open). */
  const onNodeClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (isWorking()) {
      void stopArchitect();
      return;
    }
    if (otherActivityLive()) return;
    if (vstate() === 'done' || vstate() === 'backlog') return;
    void runArchitectOnScope({ mode: 'single', initiative: props.initiative });
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
    return s.toUpperCase();
  };

  const nodeTitle = (): string => {
    if (isWorking()) {
      const who = liveAgentsHere().map((e) => e.agent_id || e.conv).join(' · ');
      return `Stop architect — ${who}`;
    }
    if (otherActivityLive()) return 'Otra iniciativa en marcha; páralas primero';
    if (vstate() === 'backlog') return 'Sin acción — backlog';
    if (vstate() === 'done') return 'Iniciativa completa';
    return `Run initiative #${props.initiative.id}`;
  };

  return (
    <li
      class={`rt-story is-${vstate()} ${props.isOpen ? 'open' : ''} ${
        props.isDimmed ? 'dim' : ''
      }`}
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

      {/* Node = play/stop control */}
      <button
        type="button"
        class={`rt-node is-${vstate()}`}
        onClick={onNodeClick}
        disabled={!isWorking() && otherActivityLive()}
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
        <Show when={vstate() === 'active' || vstate() === 'next'}>
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
          <h3 class="rt-title">{props.initiative.title}</h3>
          <span class={`rt-statlabel is-${vstate()}`}>{statusLabel()}</span>
          <Show when={isArchived()}>
            <span class="rt-archived-tag">ARCHIVED</span>
          </Show>
        </div>

        <div class="rt-meta">
          {props.tasks.length > 0 ? `${done()}/${props.tasks.length}` : '0 tasks'}
          <Show when={props.initiative.id}>
            <span> · </span>
            <span>{props.initiative.id}</span>
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

      {/* Body — tasks render lazily on first open */}
      <Show when={props.isOpen}>
        <div class={`rt-body ${props.isOpen ? 'open' : ''}`}>
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
                {(t) => <TaskRow task={t} />}
              </For>
            </ul>
          </Show>
        </div>
      </Show>
    </li>
  );
}

function TaskRow(props: { task: ServerTask }) {
  const status = () => props.task.status || 'next';
  return (
    <li class="rt-task">
      <span class={`rt-task-node is-${status()}`} aria-hidden="true" />
      <span class="rt-task-code">{displayTaskId(props.task.id)}</span>
      <span class="rt-task-text" title={props.task.title}>
        {props.task.title}
      </span>
      <span class={`rt-task-status is-${status()}`}>
        {status().replace('_', ' ')}
      </span>
    </li>
  );
}
