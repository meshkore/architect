import { For, Show } from 'solid-js';
import type { ServerModule } from '~/state/server';
import { moduleDocFlags } from '~/components/modules-tree/doc-index';

export interface ModuleTreeIndex {
  byParent: Map<string, ServerModule[]>;
  byId: Map<string, ServerModule>;
  agg: Map<string, { total: number; active: number }>;
}

export default function ModuleNode(props: {
  mod: ServerModule;
  depth: number;
  tree: ModuleTreeIndex;
  expanded: Set<string>;
  passes: (id: string) => boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const kids = () => (props.tree.byParent.get(props.mod.id) ?? []).filter((k) => props.passes(k.id));
  const isExpanded = () => props.expanded.has(props.mod.id);
  const isActive = () => props.selectedId === props.mod.id;
  const counts = () => props.tree.agg.get(props.mod.id) ?? { total: 0, active: 0 };
  const count = () => (counts().active > 0 ? counts().active : counts().total);
  // V86i — context + diagram presence flags. The module is "documented"
  // if the daemon serves a README under docs/modules/<id>.md; that doc
  // can carry an inline `diagrams:` block that we surface as the orange
  // marker on the right edge of the row.
  const docFlags = () => moduleDocFlags().get(props.mod.id) ?? { hasContext: false, hasDiagrams: false };

  return (
    <div>
      <div
        class={`px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors cursor-pointer ${
          isActive() ? 'bg-emerald-500/10 text-emerald-300' : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
        }`}
        style={{ 'padding-left': `${0.5 + props.depth * 0.75}rem` }}
        onClick={() => props.onSelect(props.mod.id)}
      >
        {/* Status dot: live (active tasks) vs idle (no tasks moving).
            Title makes it screen-reader friendly. */}
        <span
          aria-label={counts().active > 0 ? `${counts().active} active tasks` : 'no active tasks'}
          title={counts().active > 0 ? `${counts().active} active task${counts().active === 1 ? '' : 's'}` : 'no active tasks'}
          class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${counts().active > 0 ? 'bg-emerald-400' : 'bg-transparent'}`}
        />
        <span class="truncate flex-1" title={props.mod.id}>{props.mod.name ?? props.mod.id}</span>

        {/* Context indicator — blue. Module has a README under docs/. */}
        <Show when={docFlags().hasContext}>
          <span
            aria-label="has context doc"
            title="Has context / README — open in CONTEXT tab"
            class="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400/80"
          />
        </Show>
        {/* Diagram indicator — orange. The module's doc declares mermaid blocks. */}
        <Show when={docFlags().hasDiagrams}>
          <span
            aria-label="has diagram(s)"
            title="Diagram(s) declared — open in DIAGRAMS tab"
            class="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-400"
          />
        </Show>

        <Show when={kids().length > 0}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); props.onToggle(props.mod.id); }}
            class="text-gray-500 hover:text-gray-200 transition-transform"
            classList={{ 'rotate-90': isExpanded() }}
            aria-label={isExpanded() ? 'collapse' : 'expand'}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </Show>
        <span class="font-mono text-[10px] text-gray-500">{count()}</span>
      </div>
      <Show when={kids().length > 0 && isExpanded()}>
        <For each={kids()}>
          {(k) => (
            <ModuleNode
              mod={k}
              depth={props.depth + 1}
              tree={props.tree}
              expanded={props.expanded}
              passes={props.passes}
              selectedId={props.selectedId}
              onSelect={props.onSelect}
              onToggle={props.onToggle}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
