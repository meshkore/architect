import { For, Show } from 'solid-js';
import type { ServerModule } from '~/state/server';

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
  return (
    <div>
      <div
        class={`px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors cursor-pointer ${
          isActive() ? 'bg-emerald-500/10 text-emerald-300' : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
        }`}
        style={{ 'padding-left': `${0.5 + props.depth * 0.75}rem` }}
        onClick={() => props.onSelect(props.mod.id)}
      >
        <span
          class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${counts().active > 0 ? 'bg-emerald-400' : 'bg-transparent'}`}
        />
        <span class="truncate flex-1" title={props.mod.id}>{props.mod.name ?? props.mod.id}</span>
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
