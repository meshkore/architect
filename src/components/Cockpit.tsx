/**
 * Cockpit — the connected workspace (V80 1:1 layout).
 *
 * Three columns plus the projects rail outside them:
 *
 *   ProjectsRail | nav (modules) | left (workspace) | center (chat)
 *
 * The workspace column carries the 4 sub-tabs (Roadmap / Tasks /
 * Context / Diagrams). The center column owns its own agents rail +
 * chat thread. Both inner splitters are drag-resizable.
 *
 * Migrated zones (bookmarks, crons, links, protocols, diary, config)
 * replace the cockpit body with their own panel via `ZoneView`.
 */

import { createEffect, createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { EXPECTED_DAEMON_VERSION, isDaemonBehind } from '~/lib/version';
import { cockpitOutdated, latestCockpitCommit, COCKPIT_COMMIT, probeCockpitHealth } from '~/lib/cockpit-version';
import Header from '~/components/Header';
import ProjectsRail from '~/components/ProjectsRail';
import OfflinePanel from '~/components/OfflinePanel';
import RailEmptyPanel from '~/components/RailEmptyPanel';
import ModulesTree from '~/components/ModulesTree';
import InitiativesPanel from '~/components/InitiativesPanel';
import ChatPanel from '~/components/ChatPanel';
import ChatRail from '~/components/ChatRail';
import AgentsPanel from '~/components/zones/AgentsPanel';
import DaemonOutdatedPanel from '~/components/DaemonOutdatedPanel';
import DaemonAheadPanel from '~/components/DaemonAheadPanel';
import BootingPanel from '~/components/BootingPanel';
import DaemonBehindPanel from '~/components/DaemonBehindPanel';
import ConfigPanel from '~/components/zones/ConfigPanel';
import BookmarksPanel from '~/components/zones/BookmarksPanel';
import CronsPanel from '~/components/zones/CronsPanel';
import LinksPanel from '~/components/zones/LinksPanel';
import ProtocolsPanel from '~/components/zones/ProtocolsPanel';
import DiaryPanel from '~/components/zones/DiaryPanel';
// V106 — StoryBanner removed. Story-run progress is now visible
// in: (a) the agent's live state in ChatRail, (b) the
// StoryProgressPill on the initiative card, (c) the expanded
// card's Activity tab. A floating sticky banner duplicates that
// signal and steals attention.
import Splitter from '~/components/Splitter';
import ColumnDragGrip from '~/components/ColumnDragGrip';
import { openNewAgentWizard } from '~/components/modals/NewAgentWizard';
import { daemonStore } from '~/state/daemon';
import { serverStore } from '~/state/server';
import { chatStore } from '~/state/chat';
import { nav } from '~/state/nav';
import { uiStore, type Zone } from '~/state/ui';
import { layoutStore, type ColumnId } from '~/state/layout';

type Tab = 'roadmap' | 'tasks' | 'context' | 'diagrams';

const HASH_ZONES: readonly Zone[] = ['architect', 'agents', 'bookmarks', 'crons', 'links', 'protocols', 'diary', 'config'];

export default function Cockpit(props: {
  selectedModule: string | null;
  onSelectModule: (id: string | null) => void;
  connectionStatus?: { kind: string };
  renderConnectionGate?: () => any;
}) {
  const tab = nav.cockpitTab;
  const setTab = (t: Tab) => nav.setCockpitTab(t);
  const zone = () => uiStore.state.activeZone;

  // 2026-06-13 — BootingPanel escape hatch. The boot gate normally
  // waits for BOTH the roadmap snapshot AND the chat snapshot to
  // hydrate. But if the daemon's /chat/snapshot hangs (e.g. a
  // ChatSessions lock deadlock — ikamiro incident), the panel would
  // block the ENTIRE project forever. So: once the roadmap snapshot is
  // in, give chat hydration a grace window; if it doesn't arrive,
  // fall through and let the cockpit render (chat lazy-loads when the
  // conv is focused / when the snapshot finally lands). A hung chat
  // endpoint must never brick the whole UI.
  const CHAT_HYDRATE_GRACE_MS = 3000;
  const [chatGraceElapsed, setChatGraceElapsed] = createSignal(false);
  // Track the boolean readiness, NOT the snapshot OBJECT identity.
  // `serverStore.state.snapshot` is replaced with a fresh object on every
  // roadmap refresh (poll/WS, server.ts:188). Reading it directly in the
  // grace effect re-ran the effect on every refresh — clearing + restarting
  // the timer so it NEVER reached CHAT_HYDRATE_GRACE_MS, leaving BootingPanel
  // hung forever whenever /chat/snapshot was slow/hung (ikamiro ChatSessions
  // deadlock, 2026-06-13). createMemo only notifies on the boolean flip, so
  // the timer starts once on snapshot-ready and actually fires.
  const snapReady = createMemo(() => serverStore.state.snapshot != null);
  const chatReady = createMemo(() => chatStore.state.convsHydratedAt != null);
  createEffect(() => {
    // Start the grace timer once the roadmap snapshot is in but chat
    // hasn't hydrated. Only re-runs when either BOOLEAN flips.
    if (snapReady() && !chatReady()) {
      setChatGraceElapsed(false);
      const t = setTimeout(() => setChatGraceElapsed(true), CHAT_HYDRATE_GRACE_MS);
      onCleanup(() => clearTimeout(t));
    }
  });
  // A-BOOT-01 (V109) — the roadmap snapshot was treated as MANDATORY for
  // boot with no escape (only chat had a grace). If /state errors or
  // hangs, `snapReady` never flips and BootingPanel bricked the whole
  // project forever — the same dead-end as the chat hang, on the other
  // leg. Two escapes: (1) `snapFailed` — the refresh reported an error;
  // (2) a hard grace window. On escape we render the cockpit; the
  // roadmap zone shows its empty/error state + a retry banner
  // (A-ERR-SURFACE-01). Both reset per project switch (keyed on activeId).
  const BOOT_HARD_GRACE_MS = 10000;
  const [bootHardGraceElapsed, setBootHardGraceElapsed] = createSignal(false);
  const snapFailed = createMemo(
    () => serverStore.state.snapshot == null && serverStore.state.error != null,
  );
  createEffect(() => {
    daemonStore.state.activeId; // reset the escape window on every switch
    setBootHardGraceElapsed(false);
    const t = setTimeout(() => setBootHardGraceElapsed(true), BOOT_HARD_GRACE_MS);
    onCleanup(() => clearTimeout(t));
  });
  const booted = (): boolean => {
    if (snapFailed() || bootHardGraceElapsed()) return true; // escape — never brick
    if (!snapReady()) return false; // roadmap snapshot still loading
    if (chatReady()) return true; // both ready
    return chatGraceElapsed(); // chat slow/hung → fall through after grace
  };

  // Hash deep-link — read `#zone` on mount + popstate, write it back
  // when the zone changes.
  onMount(() => {
    const fromHash = window.location.hash.replace(/^#/, '') as Zone;
    if (HASH_ZONES.includes(fromHash) && fromHash !== zone()) uiStore.setActiveZone(fromHash);
    const onPop = () => {
      const z = window.location.hash.replace(/^#/, '') as Zone;
      if (HASH_ZONES.includes(z) && z !== uiStore.state.activeZone) uiStore.setActiveZone(z);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    onCleanup(() => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    });
  });
  createEffect(() => {
    const z = zone();
    const want = z === 'architect' ? '' : `#${z}`;
    if (window.location.hash !== want) {
      try { history.replaceState(null, '', `${window.location.pathname}${window.location.search}${want}`); } catch { /* ignore */ }
    }
  });

  return (
    <div class="min-h-screen flex flex-col bg-canvas">
      <Header />
      <CockpitOutdatedBanner />
      {/* V86k — ProjectsRail (left) + ChatPanel (right) are now PERMANENT
          across every top-bar zone. Only the two middle columns
          (modules tree + roadmap/tasks/context/diagrams content) get
          swapped for a top-tab zone view. The user's mental model:
          protocols and other registries are *added through chat* and
          *scoped to the current project*, so neither the project
          switcher nor the chat can disappear when navigating to those
          tabs. */}
      <div class="flex-1 flex min-h-0">
        <ProjectsRail />
        <main class="flex-1 min-h-0 relative">
          {/* A-ERR-SURFACE-01 (V109) — the roadmap /state failed but the
              boot escape (A-BOOT-01) rendered the cockpit anyway. Surface
              it with an inline retry instead of a silent console warning,
              so the operator isn't left staring at an empty roadmap with
              no explanation. */}
          <Show when={booted() && serverStore.state.error}>
            <div class="absolute top-0 inset-x-0 z-40 flex items-center justify-center gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-200 text-xs">
              <span>No se pudo cargar el roadmap del daemon.</span>
              <button
                class="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-medium"
                onClick={() => {
                  const c = daemonStore.state.client;
                  const id = daemonStore.state.activeId;
                  if (c && id) void serverStore.refreshNow(c, id);
                }}
              >
                Reintentar
              </button>
            </div>
          </Show>
          {/* 2026-06-11 UX fix — when no daemon is connected (boot probe
              in flight, no-daemon, or unauthorized) the ConnectionGate
              replaces RailEmptyPanel in the main area. ProjectsRail stays
              interactive so the operator can click any known project
              without waiting for the initial probe to resolve. */}
          <Show
            when={
              !daemonStore.state.activeId &&
              props.connectionStatus &&
              props.connectionStatus.kind !== 'connected' &&
              props.renderConnectionGate
            }
            fallback={
          <Show
            when={!daemonStore.state.outdated}
            fallback={<DaemonOutdatedPanel />}
          >
            {/* CVS2 (2026-06-12) — when the daemon is ahead by ≥ minor,
                the wire format may have evolved beyond what this cockpit
                bundle understands. Block the body until the operator
                reloads to pick up the matching frontend.
                `daemonStore.state.ahead` already gates on major/minor
                (not patch) via isDaemonAhead — patch differences fall
                through to the existing thin DaemonAheadBanner up top. */}
            <Show
              when={!daemonStore.state.ahead}
              fallback={<DaemonAheadPanel />}
            >
            {/* 2026-06-12 — DaemonBehindPanel. Promoted from a thin top
                banner per operator feedback: "todo lo que respecta al
                daemon bloquea el proyecto, va al centro". Auto-fires
                /self-update on mount if cluster.yaml permits; falls back
                to manual instructions in-panel if not. The gate uses
                `isDaemonBehind` (MIN ≤ daemon < EXPECTED). */}
            <Show
              when={!daemonStore.state.version || !isDaemonBehind(daemonStore.state.version)}
              fallback={<DaemonBehindPanel />}
            >
            <Show
              when={!daemonStore.state.offlineSelection}
              fallback={<OfflinePanel />}
            >
            <Show
              when={daemonStore.state.activeId}
              fallback={<RailEmptyPanel />}
            >
            {/* CBO1 (2026-06-12) — boot overlay. The moment a daemon
                WS opens, activeId flips true and the workspace
                renders with empty data while serverStore.snapshot +
                chatStore.convsHydratedAt are still in flight. Cover
                the body with BootingPanel until both hydrate. The
                ProjectsRail lives outside <main>, stays clickable
                throughout so the operator can switch clusters
                without waiting. */}
            <Show
              when={booted()}
              fallback={<BootingPanel />}
            >
              <section class={`tab-panel three-col${uiStore.state.modulesCollapsed ? ' nav-collapsed' : ''}`}>
                {/* Middle two columns: architect zone keeps its own
                    nav-col + splitter + left-col; migrated top-tab
                    zones (Bookmarks, Crons, Links, Protocols, Diary,
                    Config) replace those with a single host that
                    spans the same area via `grid-column: 1 / 4`. */}
                <Show
                  when={zone() === 'architect'}
                  fallback={<MigratedZoneHost zone={zone()} />}
                >
                  {/* Three columns rendered dynamically by layoutStore
                   *  (nav/ws/chat → any order). Splitters stay
                   *  positional: col-nav resizes slot-0, col-chat
                   *  resizes slot-2, middle (slot-1) is always 1fr.
                   *  See `state/layout.ts` + `ColumnDragGrip.tsx`. */}
                  <Slot id={layoutStore.order()[0] ?? 'nav'}
                    selectedModule={props.selectedModule}
                    onSelectModule={props.onSelectModule}
                    tab={tab} setTab={setTab} />
                  <Splitter resize="col-nav" />
                  <Slot id={layoutStore.order()[1] ?? 'ws'}
                    selectedModule={props.selectedModule}
                    onSelectModule={props.onSelectModule}
                    tab={tab} setTab={setTab} />
                  <Splitter resize="col-chat" />
                  <Slot id={layoutStore.order()[2] ?? 'chat'}
                    selectedModule={props.selectedModule}
                    onSelectModule={props.onSelectModule}
                    tab={tab} setTab={setTab} />
                </Show>
              </section>
            </Show>
            </Show>
            </Show>
            </Show>
            </Show>
          </Show>
            }
          >
            {props.renderConnectionGate?.()}
          </Show>
        </main>
      </div>
    </div>
  );
}

/**
 * V86k — Host for migrated top-bar zones (Bookmarks, Crons, Links,
 * Protocols, Diary, Config). Spans the two middle grid columns
 * (nav-col + splitter + left-col) so the ProjectsRail (left) and
 * ChatPanel (right) stay visible alongside. The zone panel itself
 * keeps its own internal scrolling.
 */
function MigratedZoneHost(props: { zone: Zone }) {
  return (
    <div class="zone-host col" style={{ 'grid-column': '1 / 4' }}>
      <ZoneView zone={props.zone} />
    </div>
  );
}

/**
 * Slot — picks the column renderer for a given panel id. Used by the
 * column-reorder system (layoutStore + ColumnDragGrip). Each branch
 * carries `data-panel-id` on its outer element so the drag handler
 * can identify the drop target via `elementFromPoint`.
 *
 * The middle slot (slot-1 in the grid) absorbs the `1fr` flex space;
 * the side slots (0, 2) take their width from `--col-nav` / `--col-chat`.
 * Whatever panel happens to be in the middle slot gets the wide
 * stretch — same behavior as the pre-Solid monolith.
 */
type SlotProps = {
  id: ColumnId;
  selectedModule: string | null;
  onSelectModule: (id: string | null) => void;
  tab: () => Tab;
  setTab: (t: Tab) => void;
};

function Slot(props: SlotProps) {
  return (
    <Switch>
      <Match when={props.id === 'nav'}>
        <NavColumn
          collapsed={uiStore.state.modulesCollapsed}
          selectedModule={props.selectedModule}
          onSelectModule={props.onSelectModule}
        />
      </Match>
      <Match when={props.id === 'ws'}>
        <WorkspaceColumn />
      </Match>
      <Match when={props.id === 'chat'}>
        <ChatColumn selectedModule={props.selectedModule} />
      </Match>
    </Switch>
  );
}

function NavColumn(props: {
  collapsed: boolean;
  selectedModule: string | null;
  onSelectModule: (id: string | null) => void;
}) {
  // ModulesTree owns the `col-header-row` (38 px) and now prepends
  // its own <ColumnDragGrip panelId="nav" /> inside it, so we just
  // mount ModulesTree directly. Keeps the grip aligned with the WS
  // subtab-bar's grip vertically.
  return (
    <aside
      data-panel-id="nav"
      class={`nav-col col${props.collapsed ? ' collapsed' : ''}`}
    >
      <Show
        when={!props.collapsed}
        fallback={
          <button
            type="button"
            class="nav-rail"
            onClick={() => uiStore.toggleModulesCollapsed()}
            title="Expand modules"
            aria-label="Expand modules column"
            style={{ display: 'flex', background: 'transparent', border: 'none' }}
          >
            Modules
          </button>
        }
      >
        <ModulesTree selected={props.selectedModule} onSelect={props.onSelectModule} />
      </Show>
    </aside>
  );
}

function WorkspaceColumn() {
  // 2026-06-19 — the Tasks/Context/Diagrams sub-tabs were PARKED (the
  // per-module Tasks view was confusing; that filter belongs in the
  // roadmap itself). The workspace column is roadmap-only now, with a
  // static title header that matches the MODULES/AGENTS columns. The
  // parked panels are preserved (not deleted) in `src/_parked/` — see the
  // context decision `parked-workspace-subtabs` for the restore plan.
  return (
    <aside data-panel-id="ws" class="left-col col">
      <div class="col-header-row">
        <div class="col-bar-lead">
          <ColumnDragGrip panelId="ws" />
          <span class="col-bar-title" style={{ cursor: 'default' }}>Roadmap</span>
        </div>
      </div>
      <div class="ws-panel"><InitiativesPanel /></div>
    </aside>
  );
}

function ChatColumn(props: { selectedModule: string | null }) {
  // 2026-06-19 — the chat column's top `.col-header-row` used to hold
  // only the drag grip (an empty black bar). It now carries the column's
  // identity title "Agents" + the new-agent "+" on the right — mirroring
  // MODULES (title left) and ROADMAP (actions right). The agent rail below
  // drops its own header and is just the list. The thread keeps its own
  // scope strip unchanged.
  const onNewAgent = () => openNewAgentWizard({ scope: { module: props.selectedModule } });
  return (
    <div data-panel-id="chat" class="center-col col" id="chat-col">
      <div class="col-header-row" style={{ 'justify-content': 'space-between', gap: '8px' }}>
        <div class="col-bar-lead">
          <ColumnDragGrip panelId="chat" />
          <span class="col-bar-title" style={{ cursor: 'default' }}>Agents</span>
        </div>
        <button
          type="button"
          onClick={onNewAgent}
          class="chat-rail-new-btn"
          title="New agent / conversation"
        >＋</button>
      </div>
      <div class="chat-body flex-1 flex min-h-0">
        <ChatRail />
        <Splitter resize="chat-rail" title="Drag to resize agent rail" />
        <div class="chat-main flex-1 flex flex-col min-h-0">
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}

// V97 — `DaemonPausedPanel` (empty placeholder behind a floating
// modal) replaced by `DaemonOutdatedPanel` (the inline full-area
// mandatory block with auto-poll). The old DaemonOutdatedHost in
// App.tsx is also gone — no more floating modal for this state.

/**
 * V94 — Slim "refresh recommended" banner that appears when the
 * daemon is ahead of the cockpit's EXPECTED_DAEMON_VERSION. The
 * operator's tab keeps working (the WS event shapes are backward-
 * compatible by daemon contract), but new fields / events may not
 * be rendered until the cockpit reloads to pick up the matching
 * bundle. Non-blocking by design — a hard lock here would be wrong
 * because the daemon SHOULD be backward-compatible.
 *
 * Dismiss is per-session via sessionStorage; reloading drops the
 * dismissal naturally because the next bundle has the matching
 * EXPECTED_DAEMON_VERSION and `ahead` flips back to false anyway.
 */
/**
 * V99 — Sibling banner to <DaemonAheadBanner>, but for the COCKPIT's
 * own version. Fires when /health.json reports a build commit other
 * than the one this bundle was built with — a new cockpit was just
 * deployed and the operator's tab is stale.
 *
 * Same UX as the daemon-ahead banner: cyan strip with a Reload button.
 * No "Later" dismiss here — when the cockpit is stale, fixes and
 * features the operator just asked us to ship are not in their hands
 * until they reload. We want them to do it.
 */
function CockpitOutdatedBanner() {
  const refresh = (): void => { window.location.reload(); };
  return (
    <Show when={cockpitOutdated()}>
      <div class="border-b border-cyan-500/40 bg-cyan-500/15 text-cyan-100 text-[12px] px-4 py-2 flex items-center gap-3">
        <span class="font-mono text-cyan-300/90 flex-shrink-0">↻ cockpit ahead</span>
        <span class="flex-1 min-w-0">
          A new Architect cockpit is live (<span class="font-mono text-cyan-300">{latestCockpitCommit() ?? '?'}</span>).
          Your tab is running <span class="font-mono text-cyan-300">{COCKPIT_COMMIT}</span>.
          Reload to pick up the new bundle — fixes shipped after that commit are not in this tab yet.
        </span>
        <button
          type="button"
          onClick={() => { void probeCockpitHealth(); }}
          class="font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-cyan-500/30 hover:border-cyan-500/60 text-cyan-200/80 hover:text-cyan-100 transition-colors flex-shrink-0"
          title="Re-probe /health.json"
        >
          Re-check
        </button>
        <button
          type="button"
          onClick={refresh}
          class="font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded bg-cyan-500/30 hover:bg-cyan-500/50 border border-cyan-500/60 text-cyan-50 transition-colors flex-shrink-0"
        >
          Reload now
        </button>
      </div>
    </Show>
  );
}

// 2026-06-12 — DaemonBehindBanner was removed (promoted to the
// full-body DaemonBehindPanel per operator feedback: daemon-version
// signals belong in the center, the thin top bar is reserved for
// cockpit/UI signals). See DaemonBehindPanel.tsx.

function DaemonAheadBanner() {
  const [dismissed, setDismissed] = createSignal(
    typeof sessionStorage !== 'undefined' && sessionStorage.getItem('mc-daemon-ahead-dismissed') === '1',
  );
  // CVS2 — when ahead === true (≥ minor mismatch) the full-body
  // DaemonAheadPanel already covers the main area. The thin top
  // banner is reserved for softer cases (e.g. future patch-level
  // ahead detection that doesn't warrant a block). Today
  // isDaemonAhead() only fires on minor/major, so this banner
  // never actually renders — kept as scaffolding for a future
  // patch-level signal. Guarded explicitly to make the intent
  // obvious and prevent double-rendering with the panel.
  const visible = () => false && daemonStore.state.ahead && !dismissed();
  const dismiss = (): void => {
    try { sessionStorage.setItem('mc-daemon-ahead-dismissed', '1'); } catch { /* private mode */ }
    setDismissed(true);
  };
  const refresh = (): void => { window.location.reload(); };
  return (
    <Show when={visible()}>
      <div class="border-b border-cyan-500/30 bg-cyan-500/10 text-cyan-100 text-[12px] px-4 py-2 flex items-center gap-3">
        <span class="font-mono text-cyan-300/90 flex-shrink-0">↻ daemon ahead</span>
        <span class="flex-1 min-w-0 truncate">
          The daemon at <span class="font-mono">{daemonStore.state.health?.cluster_name ?? daemonStore.state.health?.identity ?? 'this project'}</span>
          {' '}is now <span class="font-mono text-cyan-300">{daemonStore.state.version?.raw ?? '?'}</span>.
          This cockpit bundle was built for <span class="font-mono text-cyan-300">{EXPECTED_DAEMON_VERSION}</span>.
          Reload to pick up the matching frontend so you don't miss new event fields.
        </span>
        <button
          type="button"
          onClick={refresh}
          class="font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/50 text-cyan-100 transition-colors flex-shrink-0"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={dismiss}
          class="font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-cyan-500/30 hover:border-cyan-500/60 text-cyan-200/80 hover:text-cyan-100 transition-colors flex-shrink-0"
          title="Hide until the next refresh"
        >
          Later
        </button>
      </div>
    </Show>
  );
}

// SubTab (Roadmap/Tasks/Context/Diagrams) parked 2026-06-19 — the
// workspace column is roadmap-only now. See src/_parked/ + the context
// decision `parked-workspace-subtabs`.

function ZoneView(props: { zone: Zone }) {
  return (
    <Switch fallback={<BookmarksPanel />}>
      <Match when={props.zone === 'agents'}><AgentsPanel /></Match>
      <Match when={props.zone === 'bookmarks'}><BookmarksPanel /></Match>
      <Match when={props.zone === 'crons'}><CronsPanel /></Match>
      <Match when={props.zone === 'links'}><LinksPanel /></Match>
      <Match when={props.zone === 'protocols'}><ProtocolsPanel /></Match>
      <Match when={props.zone === 'diary'}><DiaryPanel /></Match>
      <Match when={props.zone === 'config'}><ConfigPanel /></Match>
    </Switch>
  );
}
