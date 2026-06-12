/**
 * ContextPanel — V107.37 (hybrid nested tree + inline preview).
 *
 * Renders the project's context tree (`.meshkore/context/`, daemon
 * `/context`, py-1.14.1+) as a HYBRID nested tree:
 *
 *   • Every node — folders AND files — carries a +/− toggle.
 *   • Expanding a FOLDER reveals its children (README.md included, no
 *     longer hidden — it's a uniform node like any other).
 *   • Expanding a FILE reveals a clamped markdown PREVIEW inline, in a
 *     bordered box right under the node, with an "Abrir completo →"
 *     action + a word badge.
 *   • Clicking a file's TITLE opens the full body in the right panel.
 *
 * So the operator can sweep the whole skeleton (idea → product → stack
 * → architecture → constraints → decisions → criteria) with quick
 * inline peeks, then drop into a full read on demand. Expand state +
 * the last-selected node persist per cluster (viewStore).
 *
 * Data source: daemon `/context` (tree + word/token counts + budget
 * warnings) and `/context/<path>` (per-file markdown body, lazy +
 * cached, shared between the inline preview and the right panel).
 *
 * `moduleId` prop is kept for back-compat with the Cockpit wiring but
 * ignored — context is module-independent (standard v14 §3.5).
 */

import { createResource, createSignal, For, Show } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { ensureMarked } from '~/lib/cdn-loaders';
import { viewStore } from '~/state/view';
import { log } from '~/lib/log';
import type { ContextNode } from '~/lib/daemon-client';

interface Props {
  // Accepted for layout compatibility; deliberately unused — context is
  // a project-wide surface and decouples from per-module selection.
  moduleId?: string | null;
}

const bodyCache = new Map<string, string>();

// Shared body loader — used by BOTH the inline preview (per expanded
// file) and the right-panel full view. Strips YAML frontmatter (the
// body is what the operator reads) and memoizes by path so re-expanding
// or re-selecting is instant.
async function loadContextBody(path: string): Promise<string | null> {
  const cached = bodyCache.get(path);
  if (cached !== undefined) return cached;
  const client = daemonStore.state.client;
  if (!client) return null;
  const r = await client.contextFile(path);
  if (!r.ok) return null;
  let body = r.body;
  if (body.startsWith('---\n')) {
    const end = body.indexOf('\n---\n', 4);
    if (end !== -1) body = body.slice(end + 5);
  }
  body = body.trim();
  bodyCache.set(path, body);
  return body;
}

// Markdown class set reused by the inline preview and the full body.
// `compact` trims the vertical rhythm for the cramped preview box.
function proseClasses(compact = false): string {
  return [
    'prose prose-sm prose-invert max-w-none text-gray-300',
    compact ? 'text-[12px] leading-relaxed' : 'text-[13px] leading-relaxed',
    '[&_h1]:hidden',
    '[&_h2]:text-[11px] [&_h2]:font-mono [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:text-gray-400 [&_h2]:mt-3 [&_h2]:mb-1.5',
    '[&_h3]:text-[12.5px] [&_h3]:font-semibold [&_h3]:text-gray-200 [&_h3]:mt-2 [&_h3]:mb-1',
    compact ? '[&_p]:my-1 [&_ul]:my-1 [&_li]:my-0' : '[&_p]:my-2 [&_ul]:my-2 [&_li]:my-0.5',
    '[&_ul]:list-disc [&_ul]:pl-5',
    '[&_code]:font-mono [&_code]:text-[12px] [&_code]:text-emerald-300/90 [&_code]:bg-gray-900/60 [&_code]:px-1 [&_code]:rounded',
    '[&_pre]:bg-gray-950/70 [&_pre]:border [&_pre]:border-gray-800/60 [&_pre]:rounded [&_pre]:p-3 [&_pre]:my-3',
    '[&_a]:text-sky-300 [&_a]:underline',
    '[&_table]:border-collapse [&_table]:my-2 [&_table]:w-full',
    '[&_th]:text-left [&_th]:px-2 [&_th]:py-1 [&_th]:border [&_th]:border-gray-800/60 [&_th]:bg-gray-900/40 [&_th]:text-[11px]',
    '[&_td]:px-2 [&_td]:py-1 [&_td]:border [&_td]:border-gray-800/60 [&_td]:text-[12px]',
  ].join(' ');
}

export default function ContextPanel(_props: Props) {
  // Fetch the tree on mount + refetch when the cluster changes.
  const [treeRes, { refetch }] = createResource(
    () => daemonStore.state.activeId,
    async () => {
      const client = daemonStore.state.client;
      if (!client) return null;
      try {
        const r = await client.contextTree();
        if (!r.ok) {
          log.warn('contextTree fetch failed', { status: r.status });
          return null;
        }
        return r.data;
      } catch (e) {
        log.warn('contextTree threw', e instanceof Error ? e.message : String(e));
        return null;
      }
    },
  );

  // Selection — null until the operator opens a file (no auto-open, so
  // the right panel starts on a clean "pick a node" hint and the tree
  // is the hero). Default-pick overview.md only as a convenience target.
  const [selected, setSelected] = createSignal<string | null>(null);

  // Full-body for the right panel.
  const [bodyRes] = createResource(
    () => selected(),
    async (path: string | null | undefined) => (path ? loadContextBody(path) : null),
  );

  const [html] = createResource(
    () => bodyRes(),
    async (raw: string | null | undefined) => {
      if (!raw) return '';
      try {
        const m = await ensureMarked();
        return m.parse(raw, { gfm: true }) as string;
      } catch (e) {
        log.warn('context marked render failed', e instanceof Error ? e.message : String(e));
        return '';
      }
    },
  );

  const selectedNode = (): ContextNode | null => {
    const p = selected();
    if (!p) return null;
    const walk = (nodes: ContextNode[]): ContextNode | null => {
      for (const n of nodes) {
        if (n.path === p) return n;
        if (n.children) {
          const hit = walk(n.children);
          if (hit) return hit;
        }
      }
      return null;
    };
    return walk(treeRes()?.tree ?? []);
  };

  const refresh = () => { void refetch(); };

  return (
    <div class="flex flex-col h-full min-h-0">
      <Show when={treeRes()}
        fallback={
          <div class="text-gray-500 text-sm px-4 py-6">
            <Show when={!daemonStore.state.client} fallback={<>Loading context tree…</>}>
              No daemon connected.
            </Show>
          </div>
        }
      >
        {(t) => (
          <>
            <BudgetBadge tree={t()} onRefresh={refresh} />
            <div class="flex-1 flex min-h-0">
              {/* LEFT — hybrid nested tree */}
              <div class="w-[340px] flex-shrink-0 overflow-y-auto border-r border-gray-800/60 py-2 px-1">
                <Show when={t().exists && t().tree.length > 0}
                  fallback={<EmptyTree />}
                >
                  <ul class="text-[13px]">
                    <For each={t().tree}>
                      {(node) => (
                        <TreeNode
                          node={node}
                          depth={0}
                          selected={selected()}
                          onSelect={(p) => setSelected(p)}
                        />
                      )}
                    </For>
                  </ul>
                </Show>
              </div>

              {/* RIGHT — full body of the selected node */}
              <div class="flex-1 overflow-y-auto px-6 py-5">
                <Show when={selected()} fallback={
                  <div class="text-gray-500 text-sm flex flex-col items-center justify-center h-full text-center gap-2">
                    <span class="text-2xl opacity-40">⌘</span>
                    <p>Despliega un nodo con <span class="font-mono text-gray-400">+</span> para ver un preview,<br />o haz click en su título para abrirlo aquí completo.</p>
                  </div>
                }>
                  <Show when={selectedNode()}>
                    {(n) => (
                      <header class="mb-4 pb-3 border-b border-gray-800/60">
                        <div class="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">
                          {n().path}
                        </div>
                        <h1 class="text-lg font-semibold text-gray-100 leading-tight">{n().title}</h1>
                        <div class="mt-2 flex gap-3 text-[11px] text-gray-500">
                          <Show when={n().updated}><span>updated: {n().updated}</span></Show>
                          <Show when={n().status}><span>status: {n().status}</span></Show>
                          <Show when={n().words}>
                            <span class={n().over_cap ? 'text-amber-300' : ''}>{n().words}w</span>
                          </Show>
                        </div>
                      </header>
                    )}
                  </Show>
                  <Show when={bodyRes.loading}>
                    <p class="text-[11px] text-gray-500 italic">loading…</p>
                  </Show>
                  <Show when={!bodyRes.loading && html()}>
                    <div class={proseClasses(false)} innerHTML={html() ?? ''} />
                  </Show>
                </Show>
              </div>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function BudgetBadge(props: { tree: { token_estimate: number; budget_tokens: number; over_budget: boolean; warnings: string[] }; onRefresh: () => void }) {
  const pct = (): number => Math.min(100, Math.round((props.tree.token_estimate / props.tree.budget_tokens) * 100));
  const cls = (): string => {
    if (props.tree.over_budget) return 'text-red-300 border-red-500/40 bg-red-500/10';
    if (pct() >= 80) return 'text-amber-300 border-amber-500/40 bg-amber-500/10';
    return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5';
  };
  return (
    <div class="flex items-center gap-3 px-4 py-2 border-b border-gray-800/60 text-[11px]">
      <span class={`font-mono px-2 py-0.5 rounded border ${cls()}`}>
        {props.tree.token_estimate.toLocaleString()} / {props.tree.budget_tokens.toLocaleString()} tokens · {pct()}%
      </span>
      <Show when={props.tree.warnings.length > 0}>
        <span class="text-amber-300/80 truncate" title={props.tree.warnings.join('\n')}>
          ⚠ {props.tree.warnings.length} warning{props.tree.warnings.length > 1 ? 's' : ''}
        </span>
      </Show>
      <div class="flex-1" />
      <button
        type="button"
        onClick={props.onRefresh}
        title="Refetch context tree"
        class="text-gray-500 hover:text-emerald-300 transition px-1.5 py-0.5 rounded hover:bg-emerald-500/10"
      >
        ↻
      </button>
    </div>
  );
}

function EmptyTree() {
  return (
    <div class="text-[12px] text-gray-500 italic px-4 py-3 leading-relaxed">
      <p class="mb-2">No <code class="font-mono text-gray-400">.meshkore/context/</code> tree yet.</p>
      <p>Have the Roadmap Author bootstrap it, or create the canonical files manually per standard v14 §3.5:</p>
      <ul class="list-disc pl-5 mt-2 space-y-0.5 text-[11px]">
        <li>overview.md · product.md · stack.md</li>
        <li>architecture.md · constraints.md</li>
        <li>glossary.md (optional)</li>
        <li>decisions/README.md + entries</li>
        <li>criteria/README.md + entries (optional)</li>
      </ul>
    </div>
  );
}

function TreeNode(props: { node: ContextNode; depth: number; selected: string | null; onSelect: (path: string) => void }) {
  const isFile = () => props.node.kind === 'file';
  const isDir = () => props.node.kind === 'dir';
  const isExpanded = () => viewStore.isContextNodeExpanded(props.node.path);
  const isSelected = () => props.selected === props.node.path;
  const hasChildren = () => isDir() && !!props.node.children && props.node.children.length > 0;

  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    viewStore.toggleContextNode(props.node.path);
  };

  // Click on the row label:
  //  • file  → open full body in the right panel (and reveal its inline
  //            preview if it wasn't already, so the click feels alive).
  //  • dir   → toggle expand (folders have no body of their own).
  const click = () => {
    if (isFile()) {
      props.onSelect(props.node.path);
      if (!isExpanded()) viewStore.toggleContextNode(props.node.path);
    } else {
      viewStore.toggleContextNode(props.node.path);
    }
  };

  // Inline preview — only fetched once the file node is expanded.
  const [previewHtml] = createResource(
    () => (isFile() && isExpanded() ? props.node.path : null),
    async (path: string | null) => {
      if (!path) return '';
      const raw = await loadContextBody(path);
      if (raw == null) return null; // null → render an error hint
      try {
        const m = await ensureMarked();
        return m.parse(raw, { gfm: true }) as string;
      } catch {
        return raw; // fall back to raw markdown text
      }
    },
  );

  return (
    <li>
      <div
        onClick={click}
        class={`group flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded transition-colors ${
          isSelected() ? 'bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/20' : 'hover:bg-gray-800/40 text-gray-300'
        }`}
        style={{ 'padding-left': `${0.4 + props.depth * 0.8}rem` }}
      >
        {/* +/− toggle on EVERY node. Files toggle the inline preview;
            dirs toggle their children. A childless dir still shows a
            disabled glyph so the column stays aligned. */}
        <button
          type="button"
          onClick={toggle}
          disabled={isDir() && !hasChildren()}
          class={`w-4 h-4 flex-shrink-0 inline-flex items-center justify-center rounded font-mono text-[11px] leading-none transition-colors ${
            isDir() && !hasChildren()
              ? 'text-gray-700 cursor-default'
              : 'text-gray-500 hover:text-emerald-300 hover:bg-emerald-500/10'
          }`}
          title={isExpanded() ? 'colapsar' : isFile() ? 'preview' : 'expandir'}
          aria-label={isExpanded() ? 'collapse' : 'expand'}
        >
          {isExpanded() ? '−' : '+'}
        </button>

        {/* Type glyph */}
        <span class={`flex-shrink-0 text-[11px] ${isDir() ? 'text-amber-300/70' : 'text-gray-600'}`} aria-hidden="true">
          {isDir() ? '▸' : '·'}
        </span>

        <span class={`truncate text-[12.5px] ${isDir() ? 'font-medium' : ''}`}>{props.node.title}</span>

        {/* word / over-cap badge, right-aligned */}
        <span class="ml-auto flex items-center gap-1.5 flex-shrink-0 pl-2">
          <Show when={props.node.over_cap}>
            <span class="text-[9px] text-amber-300 font-mono" title={`over the ${props.node.words}w cap`}>!</span>
          </Show>
          <Show when={isFile() && props.node.words}>
            <span class={`text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity ${props.node.over_cap ? 'text-amber-300/80' : 'text-gray-600'}`}>
              {props.node.words}w
            </span>
          </Show>
        </span>
      </div>

      {/* FILE expanded → inline preview box */}
      <Show when={isFile() && isExpanded()}>
        <div
          class="my-1 mr-2 rounded-lg border border-gray-800/70 bg-gray-950/40 overflow-hidden"
          style={{ 'margin-left': `${0.4 + props.depth * 0.8 + 1.4}rem` }}
        >
          <div class="relative max-h-44 overflow-hidden px-3 py-2.5">
            <Show
              when={previewHtml.state === 'ready' || previewHtml.state === 'refreshing'}
              fallback={<p class="text-[11px] text-gray-500 italic">loading preview…</p>}
            >
              <Show
                when={previewHtml()}
                fallback={<p class="text-[11px] text-amber-300/70 italic">no se pudo cargar el contenido</p>}
              >
                <div class={proseClasses(true)} innerHTML={previewHtml() ?? ''} />
              </Show>
            </Show>
            {/* bottom fade so the clamp reads as "there's more" */}
            <div class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-gray-950/90 to-transparent" />
          </div>
          <div class="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-gray-800/60 bg-gray-900/30">
            <span class="text-[10px] font-mono text-gray-600">{props.node.path}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); props.onSelect(props.node.path); }}
              class="text-[11px] text-sky-300/90 hover:text-sky-200 hover:underline transition"
            >
              Abrir completo →
            </button>
          </div>
        </div>
      </Show>

      {/* DIR expanded → children (README included, no longer hidden) */}
      <Show when={isDir() && isExpanded() && hasChildren()}>
        <ul class="border-l border-gray-800/50 ml-3">
          <For each={props.node.children!}>
            {(child) => (
              <TreeNode node={child} depth={props.depth + 1} selected={props.selected} onSelect={props.onSelect} />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}
