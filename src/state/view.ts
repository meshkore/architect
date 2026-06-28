/**
 * state/view.ts — per-project UI view state, persisted to localStorage.
 *
 * Tracks which initiatives + modules the operator has expanded in
 * the current project. Default is collapsed everywhere: the first
 * time a project loads the operator sees the full roadmap shape at a
 * glance without scrolling. Every expand/collapse + group-by-phase
 * toggle is persisted under `mc-view-v1::<cluster_id>` so refreshing
 * or hot-swapping back keeps the prior view.
 *
 * `bindCluster(cluster_id)` is called from the App-level side-effect
 * bus whenever daemonStore swaps in a new project. The store
 * hot-loads that project's saved view and Solid reactivity re-renders
 * all subscribed components automatically.
 */

import { createStore } from 'solid-js/store';

interface ProjectView {
  /** initiativeId → true when expanded. Missing = collapsed. */
  initiatives: Record<string, boolean>;
  /** moduleId → true when expanded. Missing = collapsed. */
  modules: Record<string, boolean>;
  /** initiativeId → true when "Group by phase" is on.
   *  V86h — kept for backwards-compat with persisted projects; the UI
   *  no longer reads it (tasks are always grouped by phase). */
  groupByPhase: Record<string, boolean>;
  /** initiativeId → true when its description block is expanded
   *  (oneliner + full body). V86h. */
  descriptions?: Record<string, boolean>;
  /** taskId → true when the task card is expanded inline (shows the
   *  body alongside the title). V86h. */
  tasks?: Record<string, boolean>;
  /** V86w — initiativeId → true when the operator hid the initiative
   *  card from the roadmap. Survives reload; the filter pill at the
   *  top of InitiativesPanel toggles whether archived rows render. */
  archivedInitiatives?: Record<string, boolean>;
  /** V86w — initiativeId → which detail tab is selected when
   *  expanded ('tasks' default, or 'activity'). */
  initiativeTab?: Record<string, 'tasks' | 'activity'>;
  /** V107.34 — context-tree node path → true when expanded. Used by
   *  the CONTEXT panel's filesystem-driven tree (standard v14 §3.5). */
  contextNodes?: Record<string, boolean>;
  /** FC-2 — the roadmap visibility filter (queue|all|active|backlog|archived)
   *  the operator last selected. Persisted per-project so a refresh keeps the
   *  QUEUE tab (and any filter) instead of snapping back to ACTIVE. */
  roadmapFilter?: string;
}

interface ViewState {
  cluster: string | null;
  view: ProjectView;
}

const EMPTY: ProjectView = {
  initiatives: {}, modules: {}, groupByPhase: {}, descriptions: {}, tasks: {},
  archivedInitiatives: {}, initiativeTab: {}, contextNodes: {},
};

function keyFor(cluster: string | null): string {
  return `mc-view-v1::${cluster ?? '_local'}`;
}

function loadFor(cluster: string | null): ProjectView {
  try {
    const raw = localStorage.getItem(keyFor(cluster));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<ProjectView>;
    return {
      initiatives: parsed.initiatives ?? {},
      modules: parsed.modules ?? {},
      groupByPhase: parsed.groupByPhase ?? {},
      descriptions: parsed.descriptions ?? {},
      tasks: parsed.tasks ?? {},
      archivedInitiatives: parsed.archivedInitiatives ?? {},
      initiativeTab: parsed.initiativeTab ?? {},
      contextNodes: parsed.contextNodes ?? {},
      roadmapFilter: parsed.roadmapFilter,
    };
  } catch {
    return { ...EMPTY };
  }
}

const [state, setState] = createStore<ViewState>({ cluster: null, view: { ...EMPTY } });

function persist(): void {
  try {
    localStorage.setItem(keyFor(state.cluster), JSON.stringify(state.view));
  } catch {
    /* quota */
  }
}

function bindCluster(cluster: string | null): void {
  setState({ cluster, view: loadFor(cluster) });
}

function isInitiativeExpanded(id: string): boolean {
  return state.view.initiatives[id] === true;
}

function setInitiativeExpanded(id: string, value: boolean): void {
  setState('view', 'initiatives', id, value);
  persist();
}

function toggleInitiative(id: string): void {
  setInitiativeExpanded(id, !isInitiativeExpanded(id));
}

function isModuleExpanded(id: string): boolean {
  return state.view.modules[id] === true;
}

function setModuleExpanded(id: string, value: boolean): void {
  setState('view', 'modules', id, value);
  persist();
}

function toggleModule(id: string): void {
  setModuleExpanded(id, !isModuleExpanded(id));
}

function isGroupByPhase(id: string): boolean {
  return state.view.groupByPhase[id] === true;
}

function setGroupByPhase(id: string, value: boolean): void {
  setState('view', 'groupByPhase', id, value);
  persist();
}

function isDescriptionExpanded(initiativeId: string): boolean {
  return state.view.descriptions?.[initiativeId] === true;
}

function toggleDescription(initiativeId: string): void {
  const next = !isDescriptionExpanded(initiativeId);
  setState('view', 'descriptions', initiativeId, next);
  persist();
}

function isTaskExpanded(taskId: string): boolean {
  return state.view.tasks?.[taskId] === true;
}

function toggleTask(taskId: string): void {
  const next = !isTaskExpanded(taskId);
  setState('view', 'tasks', taskId, next);
  persist();
}

function isInitiativeArchived(id: string): boolean {
  return state.view.archivedInitiatives?.[id] === true;
}

function setInitiativeArchived(id: string, value: boolean): void {
  setState('view', 'archivedInitiatives', id, value);
  persist();
}

function initiativeTab(id: string): 'tasks' | 'activity' {
  return state.view.initiativeTab?.[id] ?? 'tasks';
}

function setInitiativeTab(id: string, tab: 'tasks' | 'activity'): void {
  setState('view', 'initiativeTab', id, tab);
  persist();
}

// FC-2 — roadmap visibility filter, persisted per-project so a refresh restores
// the operator's tab (QUEUE / ALL / ACTIVE / …) instead of resetting to ACTIVE.
function roadmapFilter(): string | null {
  return state.view.roadmapFilter ?? null;
}
function setRoadmapFilter(filter: string): void {
  setState('view', 'roadmapFilter', filter);
  persist();
}

// V107.34 — Standard v14 context tree expand state. Persisted per-cluster.
function isContextNodeExpanded(path: string): boolean {
  return state.view.contextNodes?.[path] === true;
}
function toggleContextNode(path: string): void {
  const next = !isContextNodeExpanded(path);
  setState('view', 'contextNodes', path, next);
  persist();
}

// LAL4 (live-anchor-loop) — recently-created markers. When the daemon
// emits `conv.anchored` with is_new_init/is_new_task, the cockpit
// records the id with a timestamp. LAL5 reads these to render a
// flash-highlight + ✨ NEW badge + scroll-into-view for the first
// ~10s after creation. Ephemeral — not persisted to localStorage.

const RECENTLY_CREATED_TTL_MS = 10_000;

const recentlyCreatedInits = new Map<string, number>();
const recentlyCreatedTasks = new Map<string, number>();
import { createSignal as _cs } from 'solid-js';
// Tick signal so consumers re-evaluate as the TTL expires. Bumped
// every second while there's anything live; consumers Show on
// `isRecentlyCreatedInit(id)` which compares Date.now() vs the
// stored timestamp.
const [recentlyTick, setRecentlyTick] = _cs(0);
let recentlyTimer: ReturnType<typeof setInterval> | null = null;

function ensureRecentlyTicker(): void {
  if (recentlyTimer) return;
  recentlyTimer = setInterval(() => {
    setRecentlyTick((n) => n + 1);
    const cutoff = Date.now() - RECENTLY_CREATED_TTL_MS;
    let alive = false;
    for (const [k, t] of recentlyCreatedInits) {
      if (t < cutoff) recentlyCreatedInits.delete(k); else alive = true;
    }
    for (const [k, t] of recentlyCreatedTasks) {
      if (t < cutoff) recentlyCreatedTasks.delete(k); else alive = true;
    }
    if (!alive && recentlyTimer) {
      clearInterval(recentlyTimer);
      recentlyTimer = null;
    }
  }, 1000);
}

function markRecentlyCreatedInit(id: string): void {
  recentlyCreatedInits.set(id, Date.now());
  setRecentlyTick((n) => n + 1);
  ensureRecentlyTicker();
}

function markRecentlyCreatedTask(id: string): void {
  recentlyCreatedTasks.set(id, Date.now());
  setRecentlyTick((n) => n + 1);
  ensureRecentlyTicker();
}

function isRecentlyCreatedInit(id: string): boolean {
  recentlyTick(); // re-evaluate on tick
  const ts = recentlyCreatedInits.get(id);
  return !!ts && (Date.now() - ts) < RECENTLY_CREATED_TTL_MS;
}

function isRecentlyCreatedTask(id: string): boolean {
  recentlyTick();
  const ts = recentlyCreatedTasks.get(id);
  return !!ts && (Date.now() - ts) < RECENTLY_CREATED_TTL_MS;
}

export const viewStore = {
  state,
  bindCluster,
  isInitiativeExpanded,
  setInitiativeExpanded,
  toggleInitiative,
  isModuleExpanded,
  setModuleExpanded,
  toggleModule,
  isGroupByPhase,
  setGroupByPhase,
  isDescriptionExpanded,
  toggleDescription,
  isTaskExpanded,
  toggleTask,
  isInitiativeArchived,
  setInitiativeArchived,
  initiativeTab,
  setInitiativeTab,
  roadmapFilter,
  setRoadmapFilter,
  isContextNodeExpanded,
  toggleContextNode,
  markRecentlyCreatedInit,
  markRecentlyCreatedTask,
  isRecentlyCreatedInit,
  isRecentlyCreatedTask,
};
