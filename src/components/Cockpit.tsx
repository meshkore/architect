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
import { TokenUnlockPanel } from '~/components/modals/TokenUnlockModal';
import RailEmptyPanel from '~/components/RailEmptyPanel';
import ModulesTree from '~/components/ModulesTree';
import InitiativesPanel from '~/components/InitiativesPanel';
import ContextPanel from '~/components/ContextPanel';
import DiagramsPanel from '~/components/DiagramsPanel';
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
import Splitter, { setLayoutWidth } from '~/components/Splitter';
import { MODULES_COLLAPSE_PX } from '~/components/modules-tree/widths';
import ColumnDragGrip from '~/components/ColumnDragGrip';
import { daemonStore } from '~/state/daemon';
import { serverStore } from '~/state/server';
import { chatStore } from '~/state/chat';
import { teamStore } from '~/state/team';
import { DEFAULT_MODEL, DEFAULT_EFFORT } from '~/lib/models';
import { nav } from '~/state/nav';
import { uiStore, type Zone } from '~/state/ui';
import { layoutStore, type ColumnId } from '~/state/layout';

// 2026-06-19: Tasks parked; Protocols moved in from the header zone.
type Tab = 'roadmap' | 'context' | 'diagrams' | 'protocols';

// Width the collapsed modules strip expands to on click. The collapse
// threshold itself is shared with the tree (widths.ts).
const MODULES_EXPAND_PX = 220;

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
          {/* FC-2 — NO inline "couldn't load the roadmap" banner. With one
              central daemon, a /state failure is a CONNECTION problem, not a
              roadmap problem: the self-heal path (server.ts doRefresh →
              markActiveDisconnected after repeated failures, + the WS-fatal
              path) drops the centre zone into the OfflinePanel, which
              auto-reconnects and reloads the roadmap on its own. A transient
              single-cycle miss recovers on the next refresh. Either way the
              operator never sees a dead-end error strip — connected ⇒ it loads,
              disconnected ⇒ the reconnect screen. */}
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
              <section class="tab-panel two-col">
                {/* Two MAIN columns, reorderable via the header grips
                 *  (layoutStore: roadmap ⇄ agents). Each column is the
                 *  same shape — [secondary rail | splitter | primary
                 *  content]. The left slot is the flexible `1fr` track;
                 *  the right slot is the fixed `--col-side` track that
                 *  the single `col-main` splitter resizes. Migrated
                 *  top-tab zones (Bookmarks, Crons, …) replace the
                 *  roadmap column's content while chat stays put. */}
                <Slot id={layoutStore.order()[0] ?? 'roadmap'}
                  selectedModule={props.selectedModule}
                  onSelectModule={props.onSelectModule}
                  tab={tab} setTab={setTab} />
                <Splitter resize="col-main" />
                <Slot id={layoutStore.order()[1] ?? 'agents'}
                  selectedModule={props.selectedModule}
                  onSelectModule={props.onSelectModule}
                  tab={tab} setTab={setTab} />
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
          {/* Token unlock — rendered HERE inside <main> (centre project zone),
              not as a root full-screen overlay, so the projects rail stays
              usable. Self-gates on a pending prompt; local clusters
              auto-unlock so this is the cloud/remote case. */}
          <TokenUnlockPanel />
        </main>
      </div>
    </div>
  );
}

/**
 * Slot — picks the MAIN column renderer for a given panel id. Used by
 * the column-reorder system (layoutStore + ColumnDragGrip). Each branch
 * carries `data-panel-id` on its outer element so the drag handler can
 * identify the drop target.
 *
 * 2026-06-19 (2-col): only two panels — `roadmap` and `agents`. The
 * roadmap slot swaps its content for a migrated top-tab zone
 * (Bookmarks, Crons, …) when the active zone isn't `architect`; chat
 * stays put in its own slot.
 */
type SlotProps = {
  id: ColumnId;
  selectedModule: string | null;
  onSelectModule: (id: string | null) => void;
  tab: () => Tab;
  setTab: (t: Tab) => void;
};

function Slot(props: SlotProps) {
  const zone = () => uiStore.state.activeZone;
  return (
    <Switch>
      <Match when={props.id === 'roadmap'}>
        <Show
          when={zone() === 'architect'}
          fallback={
            <div data-panel-id="roadmap" class="roadmap-col col">
              <ZoneView zone={zone()} />
            </div>
          }
        >
          <RoadmapColumn
            selectedModule={props.selectedModule}
            onSelectModule={props.onSelectModule}
            tab={props.tab}
            setTab={props.setTab}
          />
        </Show>
      </Match>
      <Match when={props.id === 'agents'}>
        <AgentsColumn selectedModule={props.selectedModule} />
      </Match>
    </Switch>
  );
}

/**
 * RoadmapColumn — the left-hand work surface. One header row carries
 * the column grip + the sub-tabs (Roadmap › Context · Diagrams ·
 * Protocols). Below it the body is an inner split: the Modules rail
 * (resizable via its own `modules-rail` splitter, like the agents rail)
 * + the workspace content driven by the active sub-tab. Modules stays
 * visible across every sub-tab so a selection can scope Context /
 * Diagrams (selection→list wiring lands later; default is project-wide).
 */
function RoadmapColumn(props: {
  selectedModule: string | null;
  onSelectModule: (id: string | null) => void;
  tab: () => Tab;
  setTab: (t: Tab) => void;
}) {
  const { tab, setTab } = props;
  return (
    <aside data-panel-id="roadmap" class="roadmap-col col">
      <div class="subtab-bar">
        <ColumnDragGrip panelId="roadmap" />
        <SubTab id="roadmap"   label="Roadmap"   active={tab() === 'roadmap'}   onSelect={setTab} global />
        <span class="subtab-divider" aria-hidden="true">›</span>
        <SubTab id="context"   label="Context"   active={tab() === 'context'}   onSelect={setTab} />
        <SubTab id="diagrams"  label="Diagrams"  active={tab() === 'diagrams'}  onSelect={setTab} />
        <SubTab id="protocols" label="Protocols" active={tab() === 'protocols'} onSelect={setTab} />
        <div class="flex-1" />
      </div>
      <div class="roadmap-body flex-1 flex min-h-0">
        {/* Modules rail. Below MODULES_COLLAPSE_PX the list collapses to
            a vertical "Modules" strip — drag the splitter wider, or
            click the strip, to bring it back. Width-driven, symmetric
            with how the old top-level Modules column collapsed. */}
        <aside
          class="modules-rail"
          classList={{ collapsed: uiStore.state.modulesRailWidth < MODULES_COLLAPSE_PX }}
        >
          <Show
            when={uiStore.state.modulesRailWidth >= MODULES_COLLAPSE_PX}
            fallback={
              <button
                type="button"
                class="modules-rail-label"
                onClick={() => setLayoutWidth('modules-rail', MODULES_EXPAND_PX)}
                title="Expand modules"
                aria-label="Expand modules rail"
              >
                Modules
              </button>
            }
          >
            <ModulesTree selected={props.selectedModule} onSelect={props.onSelectModule} />
          </Show>
        </aside>
        <Splitter resize="modules-rail" title="Drag to resize modules rail" />
        <div class="ws-content flex-1 flex flex-col min-h-0">
          <Switch>
            <Match when={tab() === 'roadmap'}>
              <div class="ws-panel"><InitiativesPanel /></div>
            </Match>
            <Match when={tab() === 'context'}>
              <div class="ws-panel"><ContextPanel moduleId={props.selectedModule} /></div>
            </Match>
            <Match when={tab() === 'diagrams'}>
              <div class="ws-panel"><DiagramsPanel moduleId={props.selectedModule} /></div>
            </Match>
            <Match when={tab() === 'protocols'}>
              <div class="ws-panel"><ProtocolsPanel /></div>
            </Match>
          </Switch>
        </div>
      </div>
    </aside>
  );
}

/**
 * AgentsColumn — the right-hand column. Header row carries the column
 * grip + "Agents" title + new-agent "+". Body is the inner split: the
 * agents rail (resizable via `chat-rail`) + the chat thread.
 */
function AgentsColumn(props: { selectedModule: string | null }) {
  // ATM7 — `+` opens NO modal. It immediately creates a draft conv
  // pre-bound to the generic `developer` member and focuses it. The
  // member + model + effort stay editable in the chat header until the
  // first message is sent. Empty-team edge case: fall back to a free
  // `custom` agent so the rail never dead-ends.
  const onNewAgent = () => {
    const dev = teamStore.developer();
    if (dev) {
      chatStore.createConv({
        type: 'custom',
        title: dev.name,
        model: dev.model,
        effort: dev.effort ?? DEFAULT_EFFORT,
        member: dev.id,
        scope: { module: props.selectedModule },
      });
    } else {
      chatStore.createConv({
        type: 'custom',
        title: '',
        model: DEFAULT_MODEL,
        effort: DEFAULT_EFFORT,
        scope: { module: props.selectedModule },
      });
    }
  };
  return (
    <div data-panel-id="agents" class="center-col col" id="chat-col">
      <div class="col-header-row" style={{ 'justify-content': 'space-between', gap: '8px' }}>
        <div class="col-bar-lead">
          <ColumnDragGrip panelId="agents" />
          <span class="col-bar-title" style={{ cursor: 'default' }}>Agents</span>
        </div>
        <button
          type="button"
          onClick={onNewAgent}
          class="chat-rail-new-btn"
          title="New agent / conversation"
        >＋</button>
      </div>
      {/* Fixed-agents subheader — Architect Agent + Roadmap Architect are
          pinned, non-archivable system agents in every project (see
          ChatRail's head pinning + AgentCard/ChatScopeStrip's fixed-agent
          guards). Kept to 1-3 lines; this column is narrow. */}
      <p class="px-2.5 pt-1 pb-1.5 text-[10px] leading-snug text-gray-600 border-b border-gray-800/60">
        <span style={{ color: '#ec4899' }}>Architect Agent</span> plans only
        (roadmap/context/links/crons, no code).{' '}
        <span style={{ color: '#22d3ee' }}>Roadmap Architect</span> executes
        the queue and may dispatch agents. Both are fixed.
      </p>
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

function SubTab(props: {
  id: Tab;
  label: string;
  active: boolean;
  onSelect: (id: Tab) => void;
  global?: boolean;
}) {
  return (
    <button
      type="button"
      data-wstab={props.id}
      onClick={() => props.onSelect(props.id)}
      class={`subtab ws-tab ${props.active ? 'active' : ''} ${props.global ? 'subtab-global' : ''}`}
    >
      {props.label}
    </button>
  );
}

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
