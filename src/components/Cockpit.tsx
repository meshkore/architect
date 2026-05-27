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

const HASH_ZONES: readonly Zone[] = ['architect', 'bookmarks', 'crons', 'links', 'protocols', 'diary', 'config'];
const MIGRATED_ZONES: readonly Zone[] = ['bookmarks', 'crons', 'links', 'protocols', 'diary', 'config'];

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
      <StoryBanner />
      <Show when={!MIGRATED_ZONES.includes(zone())} fallback={<ZoneView zone={zone()} />}>
        <div class="flex-1 flex min-h-0">
          <ProjectsRail />
          <main class="flex-1 min-h-0 relative">
            {/* V86 — while the active daemon is outdated, blank out the
                three-col body so the operator doesn't see (and can't
                act on) stale data from the version they're being asked
                to upgrade away from. Header + ProjectsRail stay live so
                they can keep working in other projects. The neutral
                placeholder reads through; the DaemonOutdatedModal sits
                on top with the upgrade actions. The bus's
                `notifyActiveChanged` will hydrate fresh data
                automatically once the upgraded daemon checks in. */}
            <Show
              when={!daemonStore.state.outdated}
              fallback={<DaemonPausedPanel />}
            >
              {/* V86b — offline-selected row: the rail's pick has no
                  live daemon. Replace the three-col body with the
                  OfflinePanel so the operator gets explicit guidance
                  on how to bring the daemon up. */}
              <Show
                when={!daemonStore.state.offlineSelection}
                fallback={<OfflinePanel />}
              >
              {/* V86c — no live `activeId` and no offline pick either:
                  the operator deleted the last selected project (or
                  has yet to pick one). Render the empty panel; it
                  decides between the "add/scan" CTAs and the
                  "select a project" hint based on how many rows the
                  rail has. The single-row case is auto-resolved in
                  App.tsx's effect, so this branch only renders for
                  0 or 2+ rows. */}
              <Show
                when={daemonStore.state.activeId}
                fallback={<RailEmptyPanel />}
              >
              <section class="tab-panel three-col">
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
      </Show>
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
      <Match when={props.zone === 'bookmarks'}><BookmarksPanel /></Match>
      <Match when={props.zone === 'crons'}><CronsPanel /></Match>
      <Match when={props.zone === 'links'}><LinksPanel /></Match>
      <Match when={props.zone === 'protocols'}><ProtocolsPanel /></Match>
      <Match when={props.zone === 'diary'}><DiaryPanel /></Match>
      <Match when={props.zone === 'config'}><ConfigPanel /></Match>
    </Switch>
  );
}
