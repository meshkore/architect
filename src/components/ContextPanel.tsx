/**
 * ContextPanel — V107.34 (Standard v14 rewrite).
 *
 * Renders the project's context tree (`.meshkore/context/`) as an
 * INDEPENDENT panel — no longer driven by the Modules tree selection.
 * Left half: expandable tree with +/- toggles, persisted expand
 * state per cluster. Right half: markdown body of the selected node.
 * Top: token-budget badge.
 *
 * Data source: daemon `/context` endpoint (py-1.12.10+) returns the
 * tree shape + word/token counts + budget warnings. Per-file body
 * fetched lazily via `/context/<path>` on first selection.
 *
 * Theory: context is project-wide invariant knowledge agents need at
 * every spawn. The tree is conceptual (overview, product, stack,
 * architecture, constraints, glossary + decisions/ + criteria/),
 * NOT tied to the modules taxonomy. See standard v14 §3.5.
 *
 * `moduleId` prop is kept for back-compat with the Cockpit wiring but
 * ignored — context is module-independent.
 */

import { createEffect, createMemo, createResource, createSignal, For, Show } from 'solid-js';
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

  // Flatten tree into a list of leaf paths for default-selection logic.
  const allLeaves = createMemo<ContextNode[]>(() => {
    const out: ContextNode[] = [];
    const walk = (nodes: ContextNode[]) => {
      for (const n of nodes) {
        if (n.kind === 'file') out.push(n);
        else if (n.children) walk(n.children);
      }
    };
    walk(treeRes()?.tree ?? []);
    return out;
  });

  // Selection — default to overview.md if present, else first leaf.
  const [selected, setSelected] = createSignal<string | null>(null);
  createEffect(() => {
    if (selected()) return; // operator already picked something
    const leaves = allLeaves();
    if (leaves.length === 0) return;
    const ov = leaves.find((l) => l.path === 'overview.md');
    setSelected((ov ?? leaves[0]).path);
  });

  // Body lazy-load for the selected leaf.
  const [bodyRes] = createResource(
    () => selected(),
    async (path: string | null | undefined) => {
      if (!path) return null;
      const cached = bodyCache.get(path);
      if (cached !== undefined) return cached;
      const client = daemonStore.state.client;
      if (!client) return null;
      const r = await client.contextFile(path);
      if (!r.ok) return null;
      // Strip YAML frontmatter for display (the body is what matters).
      let body = r.body;
      if (body.startsWith('---\n')) {
        const end = body.indexOf('\n---\n', 4);
        if (end !== -1) body = body.slice(end + 5);
      }
      bodyCache.set(path, body);
      return body;
    },
  );

  // Marked render of the body markdown.
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
              {/* LEFT — tree */}
              <div class="w-[280px] flex-shrink-0 overflow-y-auto border-r border-gray-800/60 py-2">
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

              {/* RIGHT — body */}
              <div class="flex-1 overflow-y-auto px-6 py-5">
                <Show when={selected()} fallback={
                  <p class="text-gray-500 text-sm">Select a context node on the left.</p>
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
                    <div
                      class="prose prose-sm prose-invert max-w-none text-[13px] text-gray-300 leading-relaxed
                        [&_h1]:hidden
                        [&_h2]:text-[12px] [&_h2]:font-mono [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:text-gray-400 [&_h2]:mt-4 [&_h2]:mb-2
                        [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-gray-200 [&_h3]:mt-3 [&_h3]:mb-1
                        [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_li]:my-0.5
                        [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-emerald-300/90 [&_code]:bg-gray-900/60 [&_code]:px-1 [&_code]:rounded
                        [&_pre]:bg-gray-950/70 [&_pre]:border [&_pre]:border-gray-800/60 [&_pre]:rounded [&_pre]:p-3 [&_pre]:my-3
                        [&_a]:text-sky-300 [&_a]:underline
                        [&_table]:border-collapse [&_table]:my-3 [&_table]:w-full
                        [&_th]:text-left [&_th]:px-2 [&_th]:py-1 [&_th]:border [&_th]:border-gray-800/60 [&_th]:bg-gray-900/40 [&_th]:text-[11px]
                        [&_td]:px-2 [&_td]:py-1 [&_td]:border [&_td]:border-gray-800/60 [&_td]:text-[12px]"
                      innerHTML={html() ?? ''}
                    />
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
  const toggle = (e: MouseEvent) => {
    e.stopPropagation();
    viewStore.toggleContextNode(props.node.path);
  };
  const isSelected = () => props.selected === props.node.path;

  // Directories with a README → clicking the row picks the README's
  // content; the toggle button (left chevron) just expands.
  const readmePath = (): string | null => {
    if (!isDir() || !props.node.children) return null;
    const r = props.node.children.find((c) => c.kind === 'file' && c.name === 'README.md');
    return r ? r.path : null;
  };

  const click = () => {
    if (isFile()) {
      props.onSelect(props.node.path);
      return;
    }
    const rp = readmePath();
    if (rp) {
      props.onSelect(rp);
      // Auto-expand on first click so the operator sees the children.
      if (!isExpanded()) viewStore.toggleContextNode(props.node.path);
    } else {
      viewStore.toggleContextNode(props.node.path);
    }
  };

  return (
    <li>
      <div
        onClick={click}
        class={`flex items-center gap-1 px-2 py-1 cursor-pointer rounded transition-colors ${
          isSelected() ? 'bg-emerald-500/10 text-emerald-200' : 'hover:bg-gray-800/40 text-gray-300'
        }`}
        style={{ 'padding-left': `${0.5 + props.depth * 0.85}rem` }}
      >
        <Show when={isDir()} fallback={<span class="w-3.5" aria-hidden="true">·</span>}>
          <button
            type="button"
            onClick={toggle}
            class="w-3.5 h-3.5 inline-flex items-center justify-center text-gray-500 hover:text-gray-200 font-mono text-[10px] leading-none"
            title={isExpanded() ? 'collapse' : 'expand'}
          >
            {isExpanded() ? '−' : '+'}
          </button>
        </Show>
        <span class="truncate text-[12.5px]">{props.node.title}</span>
        <Show when={props.node.over_cap}>
          <span class="text-[9px] text-amber-300 font-mono ml-auto flex-shrink-0" title={`over the ${props.node.words}w cap`}>!</span>
        </Show>
      </div>
      <Show when={isDir() && isExpanded() && props.node.children}>
        <ul>
          <For each={props.node.children!.filter((c) => !(c.kind === 'file' && c.name === 'README.md'))}>
            {(child) => (
              <TreeNode node={child} depth={props.depth + 1} selected={props.selected} onSelect={props.onSelect} />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
}
