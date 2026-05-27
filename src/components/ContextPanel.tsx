/**
 * ContextPanel — CONTEXT subtab (M4.4). Picks the active scope's
 * primary doc (architecture/cluster-layout for the "all" scope, else
 * the module README) and renders its markdown body via `marked`
 * (CDN-loaded). When the doc declares diagrams, a kindbar flips
 * between body and each diagram rendered with mermaid.
 */

import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { serverStore } from '~/state/server';
import { daemonStore } from '~/state/daemon';
import { ensureMarked } from '~/lib/cdn-loaders';
import { renderDiagram, type DiagramRef } from '~/lib/diagram-render';
import { findProjectDoc, isProjectDocScope } from '~/components/modules-tree/doc-index';

interface Doc {
  category: string;
  slug: string;
  path: string;
  title?: string;
  updated?: string;
  subpath?: string;
  diagrams?: DiagramRef[];
}

const mdCache = new Map<string, string>();

function pickDoc(snapshot: unknown, scope: string | null): Doc | null {
  const tree = (snapshot as { docs?: { tree?: Array<{ items: Doc[] }> } } | null)?.docs?.tree ?? [];
  const flat = tree.flatMap((c) => c.items);
  if (!scope) {
    return (
      flat.find((d) => d.category === 'architecture' && d.slug === 'cluster-layout') ??
      flat.find((d) => d.category === 'architecture') ??
      flat[0] ?? null
    );
  }
  // V86i — project-level doc scope (`doc:<category>/<slug>`) — used
  // by the ModulesTree's Project section to navigate non-module docs.
  if (isProjectDocScope(scope)) {
    const ref = findProjectDoc(scope);
    if (!ref) return null;
    return flat.find((d) => d.category === ref.category && d.slug === ref.slug) ?? null;
  }
  return flat.find((d) => d.category === 'modules' && d.slug === scope) ?? null;
}

async function loadDocBody(doc: Doc): Promise<string> {
  const client = daemonStore.state.client;
  if (!client) throw new Error('no daemon');
  const apiPath =
    doc.category === 'modules' ? '/' + doc.path : '/docs/' + doc.path.replace(/^docs\//, '');
  const url = client.transport.httpBase + apiPath;
  const cached = mdCache.get(url);
  if (cached) return cached;
  const token = client.transport.token;
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(String(r.status));
  let txt = await r.text();
  const head = txt.slice(0, 200).toLowerCase();
  if (head.includes('<!doctype') || head.includes('<html')) throw new Error('daemon returned HTML');
  txt = txt.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
  mdCache.set(url, txt);
  return txt;
}

const kindIcon = (k: string) => (k === 'sequence' ? '⟿' : k === 'schema' ? '⌑' : k === 'flow' ? '⇢' : '◇');

export default function ContextPanel(props: { moduleId: string | null }) {
  const doc = createMemo(() => pickDoc(serverStore.state.snapshot, props.moduleId));
  const [view, setView] = createSignal<string>('doc');
  const diagrams = createMemo<DiagramRef[]>(() => doc()?.diagrams ?? []);
  const currentDiagram = createMemo<DiagramRef | null>(() => {
    const v = view();
    return v === 'doc' ? null : diagrams().find((d) => d.slug === v) ?? null;
  });

  const [body] = createResource(
    () => (view() === 'doc' ? doc() : null),
    async (d: Doc) => (await ensureMarked()).parse(await loadDocBody(d), { gfm: true }),
  );
  const [svg] = createResource(currentDiagram, renderDiagram);

  const btnCls = (active: boolean) =>
    `px-2.5 py-1 rounded text-[12px] font-mono ${
      active
        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
        : 'bg-gray-900/40 text-gray-400 border border-gray-800 hover:border-gray-700'
    }`;

  return (
    <Show
      when={doc()}
      fallback={
        <div class="text-gray-500 text-sm px-4 py-6">
          {props.moduleId
            ? `No README.md for module "${props.moduleId}".`
            : 'No project-level docs found yet.'}
        </div>
      }
    >
      <div class="flex flex-col h-full min-h-0">
        <Show when={diagrams().length > 0}>
          <div class="flex flex-wrap gap-1.5 px-1 py-2 border-b border-gray-800/60">
            <button type="button" class={btnCls(view() === 'doc')} onClick={() => setView('doc')}>📄 doc</button>
            <For each={diagrams()}>
              {(d) => (
                <button type="button" class={btnCls(view() === d.slug)} onClick={() => setView(d.slug)}>
                  {kindIcon(d.kind)} {d.title || d.slug}
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="flex-1 overflow-y-auto px-6 py-6">
          <Show when={view() === 'doc'}>
            <header class="mb-6 pb-4 border-b border-gray-800/60">
              <div class="text-xs text-gray-500 font-mono mb-2">
                {doc()!.category}
                {doc()!.subpath ? '/' + doc()!.subpath : ''} · updated {doc()!.updated || ''}
              </div>
              <h1 class="text-2xl font-bold tracking-tight">{doc()!.title}</h1>
            </header>
            <Show when={body.error}>
              <div class="text-gray-500 text-sm">Could not load doc: {String(body.error)}</div>
            </Show>
            <div class="md prose prose-invert max-w-none" innerHTML={body() ?? '<p class="text-gray-500">Loading…</p>'} />
          </Show>
          <Show when={view() !== 'doc' && currentDiagram()}>
            <header class="mb-4 pb-3 border-b border-gray-800/60 flex items-baseline gap-3 flex-wrap">
              <h2 class="text-base font-semibold tracking-tight">{currentDiagram()!.title || currentDiagram()!.slug}</h2>
              <span class="text-[10px] uppercase tracking-wider text-gray-500 font-mono">{currentDiagram()!.kind}</span>
              <Show when={currentDiagram()!.description}>
                <span class="text-xs text-gray-400">{currentDiagram()!.description}</span>
              </Show>
            </header>
            <div
              class="diagram-svg"
              innerHTML={svg() ?? '<p class="text-center text-gray-500 py-8 text-sm">Loading diagram…</p>'}
            />
          </Show>
        </div>
      </div>
    </Show>
  );
}
