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

import { createEffect, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import Header from '~/components/Header';
import CockpitOutdatedBanner from '~/components/CockpitOutdatedBanner';
import ProjectsRail from '~/components/ProjectsRail';
import OfflinePanel from '~/components/OfflinePanel';
import { TokenUnlockPanel } from '~/components/modals/TokenUnlockModal';
import RailEmptyPanel from '~/components/RailEmptyPanel';
import DaemonOutdatedPanel from '~/components/DaemonOutdatedPanel';
import DaemonAheadPanel from '~/components/DaemonAheadPanel';
import BootingPanel from '~/components/BootingPanel';
import DaemonBehindPanel from '~/components/DaemonBehindPanel';
// V106 — StoryBanner removed. Story-run progress is now visible
// in: (a) the agent's live state in ChatRail, (b) the expanded
// card's Activity tab. A floating sticky banner duplicates that
// signal and steals attention.
import Splitter from '~/components/Splitter';
import { Slot, type Tab } from '~/components/cockpit/columns';
import { createCockpitGate } from '~/state/boot-gate';
import { nav } from '~/state/nav';
import { uiStore, type Zone } from '~/state/ui';
import { layoutStore } from '~/state/layout';

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

  // ST-13 — the boot policy (the two grace windows, the failure escapes,
  // and AX3's "paint from cache on switch-back") lives in
  // `state/boot-gate.ts`. The gate below is one union rendered by a flat
  // <Switch>, in place of the six-deep <Show> chain this used to be.
  const { gate, revalidating } = createCockpitGate(
    () => !!props.connectionStatus
      && props.connectionStatus.kind !== 'connected'
      && !!props.renderConnectionGate,
  );

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
          <Switch>
            {/* 2026-06-11 UX fix — when no daemon is connected (boot probe
                in flight, no-daemon, or unauthorized) the ConnectionGate
                replaces RailEmptyPanel in the main area. ProjectsRail stays
                interactive so the operator can click any known project
                without waiting for the initial probe to resolve. */}
            <Match when={gate() === 'connection'}>{props.renderConnectionGate?.()}</Match>
            <Match when={gate() === 'outdated'}><DaemonOutdatedPanel /></Match>
            {/* CVS2 (2026-06-12) — a daemon ahead by ≥ minor may speak a
                wire format this bundle doesn't understand, so the body is
                blocked until the operator reloads. A patch-level
                difference is deliberately silent. */}
            <Match when={gate() === 'ahead'}><DaemonAheadPanel /></Match>
            {/* 2026-06-12 — promoted from a thin top banner per operator
                feedback: "todo lo que respecta al daemon bloquea el
                proyecto, va al centro". Auto-fires /self-update on mount
                when cluster.yaml permits. */}
            <Match when={gate() === 'behind'}><DaemonBehindPanel /></Match>
            <Match when={gate() === 'offline'}><OfflinePanel /></Match>
            <Match when={gate() === 'empty'}><RailEmptyPanel /></Match>
            {/* CBO1 (2026-06-12) — boot overlay for a FIRST-EVER visit.
                The moment a daemon WS opens, activeId flips true and the
                workspace would render with empty data. AX3: a project we
                already have in memory skips this entirely and paints from
                the cache while it revalidates. ProjectsRail lives outside
                <main> and stays clickable throughout. */}
            <Match when={gate() === 'booting'}><BootingPanel /></Match>
            <Match when={gate() === 'ready'}>
              <RevalidatingChip show={revalidating()} />
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
            </Match>
          </Switch>
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

// V97 — `DaemonPausedPanel` (empty placeholder behind a floating
// modal) replaced by `DaemonOutdatedPanel` (the inline full-area
// mandatory block with auto-poll). The old DaemonOutdatedHost in
// App.tsx is also gone — no more floating modal for this state.

/**
 * AX3 — the workspace painted from the in-memory session cache and the
 * daemon has not answered yet. Deliberately a small corner chip, not a
 * blocking overlay: the data on screen is the operator's own, seconds
 * old, and it is about to be replaced in place.
 */
function RevalidatingChip(props: { show: boolean }) {
  return (
    <Show when={props.show}>
      <div
        class="absolute top-1.5 right-3 z-10 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider pointer-events-none"
        style={{
          background: 'rgba(17,24,39,0.75)',
          border: '1px solid color-mix(in srgb, var(--theme-accent-bright, #34d399) 30%, transparent)',
          color: 'var(--theme-accent-bright, #34d399)',
        }}
        aria-live="polite"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-current animate-pulse-soft" aria-hidden="true" />
        refreshing…
      </div>
    </Show>
  );
}

// 2026-06-12 — DaemonBehindBanner was removed (promoted to the
// full-body DaemonBehindPanel per operator feedback: daemon-version
// signals belong in the center, the thin top bar is reserved for
// cockpit/UI signals). See DaemonBehindPanel.tsx.


