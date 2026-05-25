/**
 * DiagramsPanel — DIAGRAMS subtab (M4.4). Lists every mermaid source
 * declared on the active scope's primary doc, renders the selected
 * one inline. Mermaid module is CDN-loaded lazily (see cdn-loaders).
 */

import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { serverStore } from '~/state/server';
import { renderDiagram, type DiagramRef } from '~/lib/diagram-render';

interface Doc {
  category: string;
  slug: string;
  diagrams?: DiagramRef[];
}

function activeDiagrams(snapshot: unknown, scope: string | null): DiagramRef[] {
  const tree = (snapshot as { docs?: { tree?: Array<{ items: Doc[] }> } } | null)?.docs?.tree ?? [];
  const flat = tree.flatMap((c) => c.items);
  const doc = !scope
    ? flat.find((d) => d.category === 'architecture' && d.slug === 'cluster-layout') ??
      flat.find((d) => d.category === 'architecture') ??
      flat[0]
    : flat.find((d) => d.category === 'modules' && d.slug === scope);
  return doc?.diagrams ?? [];
}

function kindIcon(kind: string): string {
  return kind === 'sequence' ? '⟿' : kind === 'schema' ? '⌑' : kind === 'flow' ? '⇢' : '◇';
}

export default function DiagramsPanel(props: { moduleId: string | null }) {
  const diagrams = createMemo(() => activeDiagrams(serverStore.state.snapshot, props.moduleId));
  const [activeSlug, setActiveSlug] = createSignal<string | null>(null);

  const current = createMemo<DiagramRef | null>(() => {
    const list = diagrams();
    if (!list.length) return null;
    const slug = activeSlug();
    return list.find((d) => d.slug === slug) ?? list[0] ?? null;
  });

  const [svg] = createResource(current, renderDiagram);

  return (
    <Show
      when={diagrams().length > 0}
      fallback={
        <div class="text-gray-500 text-sm px-4 py-6">
          No diagrams declared for this scope. Add a `diagrams:` block to the doc frontmatter.
        </div>
      }
    >
      <div class="flex flex-col h-full min-h-0">
        <div class="flex flex-wrap gap-1.5 px-1 py-2 border-b border-gray-800/60">
          <For each={diagrams()}>
            {(d) => (
              <button
                type="button"
                title={d.kind}
                onClick={() => setActiveSlug(d.slug)}
                class={`px-2.5 py-1 rounded text-[12px] font-mono ${
                  current()?.slug === d.slug
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-gray-900/40 text-gray-400 border border-gray-800 hover:border-gray-700'
                }`}
              >
                {kindIcon(d.kind)} {d.title || d.slug}
              </button>
            )}
          </For>
        </div>
        <div class="flex-1 overflow-y-auto px-6 py-6">
          <Show when={current()}>
            <header class="mb-4 pb-3 border-b border-gray-800/60 flex items-baseline gap-3 flex-wrap">
              <h2 class="text-base font-semibold tracking-tight">
                {current()!.title || current()!.slug}
              </h2>
              <span class="text-[10px] uppercase tracking-wider text-gray-500 font-mono">
                {current()!.kind}
              </span>
              <Show when={current()!.description}>
                <span class="text-xs text-gray-400">{current()!.description}</span>
              </Show>
            </header>
            <Show
              when={svg() !== undefined}
              fallback={
                <p class="text-center text-gray-500 py-8 text-sm">
                  {svg.error ? `Could not load diagram (${String(svg.error)}).` : 'Loading diagram…'}
                </p>
              }
            >
              <div class="diagram-svg" innerHTML={svg()} />
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  );
}
