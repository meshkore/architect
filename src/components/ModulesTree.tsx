import { createMemo, For, Show } from 'solid-js';
import { allModules, allTasks } from '~/state/server';
import { uiStore, type ModulesPill } from '~/state/ui';
import { viewStore } from '~/state/view';
import ModuleNode from './ModuleNode';
import ColumnDragGrip from './ColumnDragGrip';
import { buildModuleTree, modulePasses } from './modules-tree/tree-build';
import { projectDocs } from './modules-tree/doc-index';

const PILLS: ModulesPill[] = ['all', 'work', 'stb'];

export default function ModulesTree(props: { selected: string | null; onSelect: (id: string | null) => void }) {
  // V84 — module expansion lives in viewStore, persisted per-project.
  // Default is fully collapsed (the previous `Set(['project'])` default
  // pre-expanded the root, but the operator wants a clean collapsed
  // shape on first load).
  const expanded = createMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const [id, v] of Object.entries(viewStore.state.view.modules)) {
      if (v) set.add(id);
    }
    return set;
  });

  const tree = createMemo(() => buildModuleTree());
  const passes = (id: string): boolean => modulePasses(id, tree(), uiStore.state.modulesPill);

  const toggle = (id: string): void => { viewStore.toggleModule(id); };

  const rootKids = createMemo(() => (tree().byParent.get('__root__') ?? []).filter((m) => passes(m.id)));

  return (
    <nav class="text-sm select-none flex flex-col h-full min-h-0">
      {/* V107.19 — Header uses the same `.col-header-row` styling as
          the .subtab-bar in the next column (38px height, col-pad-x
          padding, border-bottom + bg-bar). Visual unity per operator
          ask 2026-06-01: "Fíjate la siguiente columna del roadmap,
          como las letras tienen su padding arriba, izquierda,
          derecha, abajo." */}
      <div class="col-header-row" style={{ 'justify-content': 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
          <ColumnDragGrip panelId="nav" />
          <button
            type="button"
            onClick={() => uiStore.toggleModulesCollapsed()}
            title="Collapse modules column"
            style={{ 'font-size': 'var(--fs-title, 11px)' }}
            class="font-mono uppercase tracking-wider text-gray-500 hover:text-emerald-300 transition-colors bg-transparent border-0 p-0 cursor-pointer"
          >
            Modules
          </button>
        </div>
        {/* RJJ: filter pills (all / work / stb) hidden for now — de momento
            esto no lo filtramos. Code preserved below, gated by a Show that
            never renders, so it can be re-enabled by flipping the flag. */}
        <Show when={false}>
          <div class="flex gap-1">
            <For each={PILLS}>
              {(p) => (
                <button
                  type="button"
                  onClick={() => uiStore.setModulesPill(p)}
                  title={p === 'work' ? 'modules with active tasks' : p === 'stb' ? 'leaf modules without active tasks' : 'all modules'}
                  class={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                    uiStore.state.modulesPill === p
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20'
                      : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200'
                  }`}
                >
                  {p}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-2 pt-2 pb-3">
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
          <span class="font-mono text-[10px] text-gray-500">{allTasks().length}</span>
        </button>
        <For each={rootKids()}>
          {(m) => (
            <ModuleNode
              mod={m}
              depth={0}
              tree={tree()}
              expanded={expanded()}
              passes={passes}
              selectedId={props.selected}
              onSelect={props.onSelect}
              onToggle={toggle}
            />
          )}
        </For>
        <Show when={allModules().length === 0}>
          <p class="text-xs text-gray-600 px-2 mt-3 leading-relaxed">
            No modules declared in <span class="font-mono">cluster.yaml</span>. Add a <span class="font-mono">modules:</span> block and reload.
          </p>
        </Show>

        {/* V86i — project-level docs section. Renders below the modules
            tree. These are docs that live at the project root (architecture,
            security, deploy, conventions, …) and don't belong to a single
            module. Selecting one re-scopes Context + Diagrams panels via
            `doc:<category>/<slug>`. */}
        <Show when={projectDocs().length > 0}>
          <div class="mt-4 pt-3 border-t border-gray-800/60">
            <div class="text-xs font-mono uppercase tracking-wider text-gray-500 px-2 mb-1">Project</div>
            <For each={projectDocs()}>
              {(d) => (
                <button
                  type="button"
                  onClick={() => props.onSelect(d.scopeId)}
                  class={`w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors ${
                    props.selected === d.scopeId
                      ? 'bg-emerald-500/10 text-emerald-300'
                      : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'
                  }`}
                >
                  <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400/80"
                    title="Has context — open in CONTEXT tab"
                    aria-label="has context doc" />
                  <span class="truncate flex-1" title={`${d.category}/${d.slug}`}>{d.label}</span>
                  <Show when={d.hasDiagrams}>
                    <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-orange-400"
                      title="Diagram(s) declared — open in DIAGRAMS tab"
                      aria-label="has diagram(s)" />
                  </Show>
                  <span class="font-mono text-[9px] text-gray-600 uppercase tracking-wider">{d.category}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </nav>
  );
}
