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

import { createEffect, createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { EXPECTED_DAEMON_VERSION } from '~/lib/version';
import Header from '~/components/Header';
import ProjectsRail from '~/components/ProjectsRail';
import OfflinePanel from '~/components/OfflinePanel';
import RailEmptyPanel from '~/components/RailEmptyPanel';
import ModulesTree from '~/components/ModulesTree';
import RoadmapList from '~/components/RoadmapList';
import InitiativesPanel from '~/components/InitiativesPanel';
import ChatPanel from '~/components/ChatPanel';
import ChatRail from '~/components/ChatRail';
import ContextPanel from '~/components/ContextPanel';
import DiagramsPanel from '~/components/DiagramsPanel';
import AgentsPanel from '~/components/zones/AgentsPanel';
import ConfigPanel from '~/components/zones/ConfigPanel';
import BookmarksPanel from '~/components/zones/BookmarksPanel';
import CronsPanel from '~/components/zones/CronsPanel';
import LinksPanel from '~/components/zones/LinksPanel';
import ProtocolsPanel from '~/components/zones/ProtocolsPanel';
import DiaryPanel from '~/components/zones/DiaryPanel';
import StoryBanner from '~/components/story/StoryBanner';
import Splitter from '~/components/Splitter';
import { openNewAgentWizard } from '~/components/modals/NewAgentWizard';
import { daemonStore } from '~/state/daemon';
import { serverStore } from '~/state/server';
import { nav } from '~/state/nav';
import { uiStore, type Zone } from '~/state/ui';

type Tab = 'roadmap' | 'tasks' | 'context' | 'diagrams';

const HASH_ZONES: readonly Zone[] = ['architect', 'agents', 'bookmarks', 'crons', 'links', 'protocols', 'diary', 'config'];

export default function Cockpit(props: {
  selectedModule: string | null;
  onSelectModule: (id: string | null) => void;
}) {
  const tab = nav.cockpitTab;
  const setTab = (t: Tab) => nav.setCockpitTab(t);
  const zone = () => uiStore.state.activeZone;

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
      <DaemonAheadBanner />
      <StoryBanner />
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
          <Show
            when={!daemonStore.state.outdated}
            fallback={<DaemonPausedPanel />}
          >
            <Show
              when={!daemonStore.state.offlineSelection}
              fallback={<OfflinePanel />}
            >
            <Show
              when={daemonStore.state.activeId}
              fallback={<RailEmptyPanel />}
            >
              <section class="tab-panel three-col">
                {/* Middle two columns: architect zone keeps its own
                    nav-col + splitter + left-col; migrated top-tab
                    zones (Bookmarks, Crons, Links, Protocols, Diary,
                    Config) replace those with a single host that
                    spans the same area via `grid-column: 1 / 4`. */}
                <Show
                  when={zone() === 'architect'}
                  fallback={<MigratedZoneHost zone={zone()} />}
                >
                  <aside class="nav-col col">
                    <ModulesTree selected={props.selectedModule} onSelect={props.onSelectModule} />
                  </aside>

                  <Splitter resize="col-nav" />

                  <aside class="left-col col">
                    <div class="subtab-bar">
                      <SubTab id="roadmap"  label="Roadmap"  active={tab() === 'roadmap'}  onSelect={setTab} global />
                      <span class="subtab-divider" aria-hidden="true">›</span>
                      <SubTab id="tasks"    label="Tasks"    active={tab() === 'tasks'}    onSelect={setTab} />
                      <SubTab id="context"  label="Context"  active={tab() === 'context'}  onSelect={setTab} />
                      <SubTab id="diagrams" label="Diagrams" active={tab() === 'diagrams'} onSelect={setTab} />
                      <div class="flex-1" />
                      <div class="flex items-center gap-1 pr-2 self-center">
                        <button type="button" title="New task" class="text-gray-500 hover:text-emerald-400 transition px-1 py-0.5 rounded hover:bg-emerald-500/10">
                          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4"><path d="M12 4v16M4 12h16" /></svg>
                        </button>
                        <button type="button" title="Reload state" class="text-gray-500 hover:text-emerald-400 transition px-1 py-0.5 rounded hover:bg-emerald-500/10"
                          onClick={() => {
                            const c = daemonStore.state.client;
                            const id = daemonStore.state.activeId;
                            if (c && id) void serverStore.refreshNow(c, id);
                          }}>
                          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 4v6h6M20 20v-6h-6M5 13a8 8 0 1014.5-3.5M19 11a8 8 0 00-14.5 3.5" /></svg>
                        </button>
                      </div>
                    </div>
                    <Switch>
                      <Match when={tab() === 'roadmap'}>
                        <div class="ws-panel"><InitiativesPanel /></div>
                      </Match>
                      <Match when={tab() === 'tasks'}>
                        <div class="ws-panel"><RoadmapList moduleId={props.selectedModule} onSelectModule={props.onSelectModule} /></div>
                      </Match>
                      <Match when={tab() === 'context'}>
                        <div class="ws-panel"><ContextPanel moduleId={props.selectedModule} /></div>
                      </Match>
                      <Match when={tab() === 'diagrams'}>
                        <div class="ws-panel"><DiagramsPanel moduleId={props.selectedModule} /></div>
                      </Match>
                    </Switch>
                  </aside>
                </Show>

                <Splitter resize="col-chat" />

                <div class="center-col col" id="chat-col">
                  <div class="chat-body flex-1 flex min-h-0">
                    <ChatRail onNewAgent={() => openNewAgentWizard({ scope: { module: props.selectedModule } })} />
                    <Splitter resize="chat-rail" title="Drag to resize agent rail" />
                    <div class="chat-main flex-1 flex flex-col min-h-0">
                      <ChatPanel />
                    </div>
                  </div>
                </div>
              </section>
            </Show>
            </Show>
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
 * Empty placeholder shown in the cockpit's center body when the
 * active daemon is outdated. The DaemonOutdatedModal floats on top
 * and owns the entire conversation about the update — this panel
 * just blanks out the area so stale roadmap / chat from the
 * outgoing daemon doesn't leak through. As soon as the upgraded
 * daemon connects, `state.outdated` flips false and the real
 * columns mount again, populated by the side-effect bus.
 */
function DaemonPausedPanel() {
  return <section class="flex-1" />;
}

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
function DaemonAheadBanner() {
  const [dismissed, setDismissed] = createSignal(
    typeof sessionStorage !== 'undefined' && sessionStorage.getItem('mc-daemon-ahead-dismissed') === '1',
  );
  const visible = () => daemonStore.state.ahead && !dismissed();
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
