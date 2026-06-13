/**
 * ContextPanel — V107.38 (single-column nested-tree accordion).
 *
 * Renders the project's context tree (`.meshkore/context/`, daemon
 * `/context`, py-1.14.1+) as ONE full-width column:
 *
 *   • Every node — folders AND files — carries a +/− toggle.
 *   • Expanding a FOLDER reveals its children (README.md included).
 *   • Expanding a FILE reveals its FULL markdown body inline, in a
 *     bordered box that spans the container's full width (respecting
 *     the column's padding + a small per-depth indent for hierarchy).
 *
 * No right panel — the tree IS the document. The operator unfolds the
 * skeleton (idea → product → stack → architecture → constraints →
 * decisions → criteria) top-to-bottom and reads each node in place.
 * Expand state persists per cluster (viewStore).
 *
 * Data source: daemon `/context` (tree + word/token counts + budget
 * warnings) and `/context/<path>` (per-file markdown body, lazy +
 * cached). `moduleId` is accepted for Cockpit wiring but ignored —
 * context is module-independent (standard v14 §3.5).
 */

import { createResource, For, Show } from 'solid-js';
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

// Shared body loader. Strips YAML frontmatter (the body is what the
// operator reads) and memoizes by path so re-expanding is instant.
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

// Markdown class set for the inline body.
const PROSE = [
  'prose prose-sm prose-invert max-w-none text-[13px] text-gray-300 leading-relaxed',
  '[&_h1]:hidden',
  '[&_h2]:text-[11px] [&_h2]:font-mono [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:text-gray-400 [&_h2]:mt-4 [&_h2]:mb-2',
  '[&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-gray-200 [&_h3]:mt-3 [&_h3]:mb-1',
  '[&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_li]:my-0.5',
  '[&_code]:font-mono [&_code]:text-[12px] [&_code]:text-emerald-300/90 [&_code]:bg-gray-900/60 [&_code]:px-1 [&_code]:rounded',
  '[&_pre]:bg-gray-950/70 [&_pre]:border [&_pre]:border-gray-800/60 [&_pre]:rounded [&_pre]:p-3 [&_pre]:my-3',
  '[&_a]:text-sky-300 [&_a]:underline',
  '[&_table]:border-collapse [&_table]:my-3 [&_table]:w-full',
  '[&_th]:text-left [&_th]:px-2 [&_th]:py-1 [&_th]:border [&_th]:border-gray-800/60 [&_th]:bg-gray-900/40 [&_th]:text-[11px]',
  '[&_td]:px-2 [&_td]:py-1 [&_td]:border [&_td]:border-gray-800/60 [&_td]:text-[12px]',
].join(' ');

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
            {/* SINGLE COLUMN — the tree IS the document */}
            <div class="flex-1 overflow-y-auto px-4 py-3">
              <Show when={t().exists && t().tree.length > 0} fallback={<EmptyTree />}>
                <ul class="text-[13px]">
                  <For each={t().tree}>
                    {(node, i) => (
                      <TreeNode
                        node={node}
                        depth={0}
                        isLast={i() === t().tree.length - 1}
                        ancestorLines={[]}
                      />
                    )}
                  </For>
                </ul>
              </Show>
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

// ── Tree-guide geometry ───────────────────────────────────────────────
// The connector skeleton (├─ │ └─) is drawn with absolutely-positioned
// 1px divs rather than borders/masks, so it stays correct at any depth
// and never depends on the (themeable) background colour.
const INDENT = 18;     // px per nesting level
const HALF = 12;       // px — the vertical drops under the parent's +/−
                       //      toggle centre (rowPad 4 + toggle half 8 = 12)
const ROWCENTER = 13;  // px — vertical centre of a row; where the elbow sits
// Bold, high-contrast emerald guides — the operator wants the tree
// skeleton to read CLEARLY, no subtle hairlines. 2px wide.
const LINE = 'bg-emerald-500/70';
const VW = '2px';      // vertical line width
const HH = '2px';      // horizontal elbow thickness

function TreeNode(props: {
  node: ContextNode;
  depth: number;
  isLast: boolean;
  ancestorLines: boolean[]; // slots 0..depth-2: draw a through-line iff that ancestor has more siblings below
}) {
  const isFile = () => props.node.kind === 'file';
  const isDir = () => props.node.kind === 'dir';
  const isExpanded = () => viewStore.isContextNodeExpanded(props.node.path);
  const hasChildren = () => isDir() && !!props.node.children && props.node.children.length > 0;

  const toggle = () => {
    if (isDir() && !hasChildren()) return;
    viewStore.toggleContextNode(props.node.path);
  };

  // Lines handed to THIS node's children: my ancestors' lines + my own
  // continuation (true iff I have a sibling below me). Top-level (depth
  // 0) draws no connector, so its children start a fresh slot at 0.
  const childLines = (): boolean[] =>
    props.depth === 0 ? [] : [...props.ancestorLines, !props.isLast];

  // Full body — fetched once the file node is expanded.
  const [bodyHtml] = createResource(
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

  const rowPad = () => `${4 + props.depth * INDENT}px`;
  const ownX = (props.depth - 1) * INDENT + HALF; // x of this node's connector slot
  const boxIndent = () => `${props.depth * INDENT + 26}px`;

  return (
    <li class="relative">
      {/* ── tree-guide rails (absolute, full li height, above the row's
            hover bg so they never get painted over) ── */}
      <Show when={props.depth >= 1}>
        <div class="absolute inset-0 z-10 pointer-events-none">
          {/* through-lines for ancestors that still have siblings below */}
          <For each={props.ancestorLines}>
            {(on, i) => (
              <Show when={on}>
                <div
                  class={`absolute rounded-full ${LINE}`}
                  style={{ left: `${i() * INDENT + HALF - 1}px`, top: '0', bottom: '0', width: VW }}
                />
              </Show>
            )}
          </For>
          {/* this node's vertical: from the top down to the elbow; it
              continues to the bottom only if a sibling follows (else it
              becomes a └ corner) */}
          <div
            class={`absolute rounded-full ${LINE}`}
            style={
              props.isLast
                ? { left: `${ownX - 1}px`, top: '0', height: `${ROWCENTER}px`, width: VW }
                : { left: `${ownX - 1}px`, top: '0', bottom: '0', width: VW }
            }
          />
          {/* horizontal elbow into the row */}
          <div
            class={`absolute rounded-full ${LINE}`}
            style={{ left: `${ownX - 1}px`, top: `${ROWCENTER - 1}px`, width: `${INDENT + 2}px`, height: HH }}
          />
        </div>
      </Show>

      <div
        onClick={toggle}
        class={`group relative flex items-center gap-1.5 px-2 min-h-[26px] cursor-pointer rounded transition-colors ${
          isExpanded() && isFile() ? 'text-emerald-200' : 'hover:bg-gray-800/40 text-gray-300'
        }`}
        style={{ 'padding-left': rowPad() }}
      >
        {/* +/− toggle on EVERY node. A childless dir shows a disabled glyph. */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          disabled={isDir() && !hasChildren()}
          class={`w-4 h-4 flex-shrink-0 inline-flex items-center justify-center rounded font-mono text-[11px] leading-none transition-colors ${
            isDir() && !hasChildren()
              ? 'text-gray-700 cursor-default'
              : isExpanded()
                ? 'text-emerald-300 bg-emerald-500/10'
                : 'text-gray-500 bg-gray-900/60 hover:text-emerald-300 hover:bg-emerald-500/10'
          }`}
          title={isExpanded() ? 'colapsar' : 'expandir'}
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
            <span class={`text-[10px] font-mono ${isExpanded() ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity ${props.node.over_cap ? 'text-amber-300/80' : 'text-gray-600'}`}>
              {props.node.words}w
            </span>
          </Show>
        </span>
      </div>

      {/* FILE expanded → full-width body box */}
      <Show when={isFile() && isExpanded()}>
        <div
          class="my-1.5 mr-2 rounded-lg border border-gray-800/70 bg-gray-950/40 overflow-hidden"
          style={{ 'margin-left': boxIndent() }}
        >
          <div class="flex items-center gap-3 px-4 py-2 border-b border-gray-800/60 bg-gray-900/30 text-[10px] text-gray-500">
            <span class="font-mono uppercase tracking-wider text-gray-400">{props.node.name}</span>
            <Show when={props.node.updated}><span>updated: {props.node.updated}</span></Show>
            <Show when={props.node.status}><span>status: {props.node.status}</span></Show>
            <Show when={props.node.words}>
              <span class={`ml-auto font-mono ${props.node.over_cap ? 'text-amber-300' : ''}`}>{props.node.words}w</span>
            </Show>
          </div>
          <div class="px-4 py-3">
            <Show
              when={bodyHtml.state === 'ready' || bodyHtml.state === 'refreshing'}
              fallback={<p class="text-[11px] text-gray-500 italic">loading…</p>}
            >
              <Show
                when={bodyHtml()}
                fallback={<p class="text-[11px] text-amber-300/70 italic">no se pudo cargar el contenido</p>}
              >
                <div class={PROSE} innerHTML={bodyHtml() ?? ''} />
              </Show>
            </Show>
          </div>
        </div>
      </Show>

      {/* DIR expanded → children (README included) */}
      <Show when={isDir() && isExpanded() && hasChildren()}>
        <ul>
          <For each={props.node.children!}>
            {(child, i) => (
              <TreeNode
                node={child}
                depth={props.depth + 1}
                isLast={i() === props.node.children!.length - 1}
                ancestorLines={childLines()}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}
