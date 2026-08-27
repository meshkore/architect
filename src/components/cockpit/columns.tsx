/**
 * cockpit/columns — the two MAIN columns of the workspace and the
 * top-tab zone views that replace the roadmap column's content.
 *
 * Split out of `Cockpit.tsx` (ST-13) so the file that owns the boot gate
 * owns only the gate. `Slot` is the indirection the column-reorder
 * system needs: `layoutStore.order()` decides which panel renders on
 * which side, and each branch carries `data-panel-id` so the drag
 * handler can identify the drop target.
 */

import { Match, Show, Switch } from 'solid-js';
import ModulesTree from '~/components/ModulesTree';
import InitiativesPanel from '~/components/InitiativesPanel';
import ContextPanel from '~/components/ContextPanel';
import DiagramsPanel from '~/components/DiagramsPanel';
import ChatPanel from '~/components/ChatPanel';
import ChatRail from '~/components/ChatRail';
import AgentsPanel from '~/components/zones/AgentsPanel';
import ConfigPanel from '~/components/zones/ConfigPanel';
import BookmarksPanel from '~/components/zones/BookmarksPanel';
import CronsPanel from '~/components/zones/CronsPanel';
import LinksPanel from '~/components/zones/LinksPanel';
import ProtocolsPanel from '~/components/zones/ProtocolsPanel';
import DiaryPanel from '~/components/zones/DiaryPanel';
import Splitter, { setLayoutWidth } from '~/components/Splitter';
import { MODULES_COLLAPSE_PX } from '~/components/modules-tree/widths';
import ColumnDragGrip from '~/components/ColumnDragGrip';
import { chatStore } from '~/state/chat';
import { teamStore } from '~/state/team';
import { DEFAULT_MODEL, DEFAULT_EFFORT } from '~/lib/models';
import { uiStore, type Zone } from '~/state/ui';
import { type ColumnId } from '~/state/layout';

// 2026-06-19: Tasks parked; Protocols moved in from the header zone.
export type Tab = 'roadmap' | 'context' | 'diagrams' | 'protocols';

// Width the collapsed modules strip expands to on click. The collapse
// threshold itself is shared with the tree (widths.ts).
const MODULES_EXPAND_PX = 220;

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

export function Slot(props: SlotProps) {
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
      {/* ATM12 follow-up (2026-07-07 operator correction) — the
          fixed-agent explainer moved OUT of this column header and into
          ChatScopeStrip, as a second line under each fixed agent's own
          name/model row (only shown while that agent is selected),
          instead of one combined note always sitting above the rail. */}
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
