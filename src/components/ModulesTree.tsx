/**
 * ModulesTree — left rail showing the cluster's modules.
 * Click a module to filter the roadmap. "All" shows everything.
 */

import { For, Show } from 'solid-js';
import { store } from '~/state/store';

export default function ModulesTree(props: { selected: string | null; onSelect: (id: string | null) => void }) {
  return (
    <nav class="text-sm select-none">
      <div class="text-xs font-mono uppercase tracking-wider text-gray-500 mb-2 px-2">Modules</div>
      <button
        type="button"
        onClick={() => props.onSelect(null)}
        class={`w-full text-left px-2 py-1.5 rounded-md flex items-center justify-between gap-2 transition-colors ${
          props.selected === null
            ? 'bg-emerald-500/10 text-emerald-300'
            : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
        }`}
      >
        <span>All</span>
        <span class="font-mono text-[10px] text-gray-500">{store.tasks().length}</span>
      </button>
      <For each={store.modules()}>
        {(m) => (
          <ModuleRow
            mod={m}
            selected={props.selected === m.id}
            onSelect={() => props.onSelect(m.id)}
            count={store.tasks().filter((t) => t.category === m.id).length}
          />
        )}
      </For>
      <Show when={store.modules().length === 0}>
        <p class="text-xs text-gray-600 px-2 mt-3 leading-relaxed">
          No modules declared in <span class="font-mono">cluster.yaml</span>. Add a <span class="font-mono">modules:</span> block and reload.
        </p>
      </Show>
    </nav>
  );
}

function ModuleRow(props: { mod: { id: string; name?: string; kind?: string }; selected: boolean; count: number; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      class={`w-full text-left px-2 py-1.5 rounded-md flex items-center justify-between gap-2 transition-colors ${
        props.selected ? 'bg-emerald-500/10 text-emerald-300' : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
      }`}
    >
      <span class="truncate" title={props.mod.id}>{props.mod.name ?? props.mod.id}</span>
      <span class="font-mono text-[10px] text-gray-500">{props.count}</span>
    </button>
  );
}
