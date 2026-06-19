/**
 * ContextPanel — knowledge-tree-unified KT3 (the unified knowledge viewer).
 *
 * Renders the project's UNIFIED KNOWLEDGE TREE (daemon `/knowledge`,
 * py-1.24.0+) as ONE full-width column of CONCEPTS — never filenames. The
 * tree is a manifest-driven overlay over context/+docs/+modules/; each node
 * is a concept with a 1-line description, a load policy, and (optionally) a
 * processed body fetched lazily on expand.
 *
 *   • A circled-C ROOT sits at the top; bold emerald guides (├─ │ └─) drop
 *     from it so the tree reads as one connected whole.
 *   • Every node shows its concept title + 1-line description + a load
 *     badge (● pinned / ● skeleton / ● on-demand) + an optional ◆ feeds pill.
 *   • Expanding a node reveals its FULL section description (1-3 lines) as an
 *     intro, then its processed body (if any, lazy) and/or its child concepts.
 *
 * The top budget badge shows the SPAWN PAYLOAD — the skeleton map + pinned
 * bodies the daemon injects into every agent at onboarding — vs the §3.5
 * 4500-token budget. That is the whole point: what you pin here is what
 * every agent pays for on every turn.
 *
 * Live: the daemon broadcasts `context.changed` on any context/ edit; the
 * event-bus bumps `contextRev` and this panel refetches the tree + expanded
 * bodies. `moduleId` is accepted for Cockpit wiring but ignored (knowledge
 * is project-wide).
 */

import { createResource, For, Show } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { ensureMarked } from '~/lib/cdn-loaders';
import { viewStore } from '~/state/view';
import { contextRev } from '~/state/context-sync';
import { log } from '~/lib/log';
import type { KnowledgeNode, KnowledgeLoad } from '~/lib/daemon-client';

interface Props {
  // Accepted for layout compatibility; deliberately unused — knowledge is a
  // project-wide surface and decouples from per-module selection.
  moduleId?: string | null;
}

// Body cache keyed by `${rev}|${id}`. A new revision (daemon `context.changed`
// WS event) is a fresh key → fresh fetch, so expanded bodies update live.
const bodyCache = new Map<string, string>();

async function loadNodeBody(id: string, rev: number): Promise<string | null> {
  const key = `${rev}|${id}`;
  const cached = bodyCache.get(key);
  if (cached !== undefined) return cached;
  const client = daemonStore.state.client;
  if (!client) return null;
  const r = await client.knowledgeNode(id);
  if (!r.ok || !r.data.has_body || !r.data.body) return null;
  const body = r.data.body.trim();
  bodyCache.set(key, body);
  return body;
}

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
  const [treeRes] = createResource(
    () => `${daemonStore.state.activeId ?? ''}|${contextRev()}`,
    async () => {
      const client = daemonStore.state.client;
      if (!client) return null;
      try {
        const r = await client.knowledgeTree();
        if (!r.ok) {
          log.warn('knowledgeTree fetch failed', { status: r.status });
          return null;
        }
        return r.data;
      } catch (e) {
        log.warn('knowledgeTree threw', e instanceof Error ? e.message : String(e));
        return null;
      }
    },
  );

  return (
    <div class="flex flex-col h-full min-h-0">
      <Show when={treeRes()}
        fallback={
          <div class="text-gray-500 text-sm px-4 py-6">
            <Show when={!daemonStore.state.client} fallback={<>Loading knowledge tree…</>}>
              No daemon connected.
            </Show>
          </div>
        }
      >
        {(t) => (
          <>
            <SpawnBadge tree={t()} />
            <Legend />
            <div class="flex-1 overflow-y-auto px-4 py-3">
              <Show when={t().exists && t().tree.length > 0} fallback={<EmptyTree />}>
                <div class="relative">
                  <div class="relative flex items-center" style={{ height: '30px' }}>
                    <div
                      class={`absolute rounded-full ${LINE}`}
                      style={{ left: `${HALF - 1}px`, top: '15px', bottom: '0', width: VW }}
                    />
                    <span
                      class="relative z-10 inline-flex items-center justify-center rounded-full border-2 border-emerald-500/80 bg-black text-emerald-400 text-[10px] font-bold leading-none"
                      style={{ width: '18px', height: '18px', 'margin-left': `${HALF - 9}px` }}
                      title="knowledge root"
                    >
                      C
                    </span>
                    <span class="ml-2 text-[11px] font-mono uppercase tracking-wider text-gray-500">conocimiento</span>
                  </div>
                  <ul class="text-[13px]">
                    <For each={t().tree}>
                      {(node, i) => (
                        <TreeNode
                          node={node}
                          depth={1}
                          isLast={i() === t().tree.length - 1}
                          ancestorLines={[]}
                        />
                      )}
                    </For>
                  </ul>
                </div>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function SpawnBadge(props: {
  tree: { spawn_tokens: number; skeleton_tokens?: number; pinned_tokens?: number; budget_tokens: number; over_budget: boolean; warnings: string[] };
}) {
  const pct = (): number => Math.min(100, Math.round((props.tree.spawn_tokens / props.tree.budget_tokens) * 100));
  const cls = (): string => {
    if (props.tree.over_budget) return 'text-red-300 border-red-500/40 bg-red-500/10';
    if (pct() >= 80) return 'text-amber-300 border-amber-500/40 bg-amber-500/10';
    return 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5';
  };
  return (
    <div class="flex items-center gap-3 px-4 py-2 border-b border-gray-800/60 text-[11px]">
      <span class={`font-mono px-2 py-0.5 rounded border ${cls()}`} title="Lo que el daemon inyecta en cada spawn: mapa skeleton + cuerpos pinned">
        spawn {props.tree.spawn_tokens.toLocaleString()} / {props.tree.budget_tokens.toLocaleString()} tok · {pct()}%
      </span>
      <Show when={props.tree.skeleton_tokens !== undefined && props.tree.pinned_tokens !== undefined}>
        <span class="text-gray-500 font-mono">
          {props.tree.skeleton_tokens!.toLocaleString()} skeleton + {props.tree.pinned_tokens!.toLocaleString()} pinned
        </span>
      </Show>
      <Show when={props.tree.warnings.length > 0}>
        <span class="text-amber-300/80 truncate" title={props.tree.warnings.join('\n')}>
          ⚠ {props.tree.warnings.length} warning{props.tree.warnings.length > 1 ? 's' : ''}
        </span>
      </Show>
      <div class="flex-1" />
      <span class="flex items-center gap-1.5 text-gray-500" title="Sincronizado en vivo con el daemon">
        <span class="relative flex h-1.5 w-1.5">
          <span class="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 animate-ping" />
          <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        en vivo
      </span>
    </div>
  );
}

function Legend() {
  return (
    <div class="flex items-center gap-4 px-4 py-1.5 border-b border-gray-800/40 text-[10px] text-gray-500">
      <span class="flex items-center gap-1.5"><Dot load="pinned" />pinned — cuerpo en cada spawn</span>
      <span class="flex items-center gap-1.5"><Dot load="skeleton" />skeleton — solo título + descripción</span>
      <span class="flex items-center gap-1.5"><Dot load="on-demand" />on-demand — se pide al daemon</span>
      <span class="text-violet-300/70">◆ alimenta otra superficie</span>
    </div>
  );
}

const DOT_CLS: Record<KnowledgeLoad, string> = {
  pinned: 'bg-emerald-400',
  skeleton: 'bg-sky-400',
  'on-demand': 'bg-gray-500',
};
function Dot(props: { load: KnowledgeLoad }) {
  return <span class={`inline-block w-2 h-2 rounded-sm flex-shrink-0 ${DOT_CLS[props.load]}`} aria-hidden="true" />;
}

function EmptyTree() {
  return (
    <div class="text-[12px] text-gray-500 italic px-4 py-3 leading-relaxed">
      <p class="mb-2">No <code class="font-mono text-gray-400">.meshkore/context/_index.yaml</code> manifest yet.</p>
      <p>Author the knowledge manifest (knowledge-tree-unified) — a flat list of concept nodes mapping titles to real files under context/ docs/ modules/.</p>
    </div>
  );
}

// ── Tree-guide geometry (unchanged — drawn with absolute 1px divs so it
// stays correct at any depth, independent of background colour) ──
const INDENT = 18;
const HALF = 12;
const ROWCENTER = 13;
const LINE = 'bg-emerald-500/70';
const VW = '2px';
const HH = '2px';

function TreeNode(props: {
  node: KnowledgeNode;
  depth: number;
  isLast: boolean;
  ancestorLines: boolean[];
}) {
  const hasChildren = () => !!props.node.children && props.node.children.length > 0;
  const hasBody = () => props.node.has_body;
  // The tree STRUCTURE (titles + descriptions + children) is ALWAYS shown.
  // The toggle only opens/closes a node's on-demand BODY (the file content).
  const isBodyOpen = () => viewStore.isContextNodeExpanded(props.node.id);

  const toggle = () => {
    if (!hasBody()) return;
    viewStore.toggleContextNode(props.node.id);
  };

  const childLines = (): boolean[] => [...props.ancestorLines, !props.isLast];

  // Body fetched when opened AND the node carries a body; refetched on a
  // contextRev bump so an open body updates live.
  const [bodyHtml] = createResource(
    () => (hasBody() && isBodyOpen() ? `${props.node.id}|${contextRev()}` : null),
    async (key: string | null) => {
      if (!key) return '';
      const sep = key.lastIndexOf('|');
      const id = key.slice(0, sep);
      const rev = Number(key.slice(sep + 1));
      const raw = await loadNodeBody(id, rev);
      if (raw === null) return null;
      try {
        const m = await ensureMarked();
        return m.parse(raw, { gfm: true }) as string;
      } catch {
        return raw;
      }
    },
  );

  const rowPad = () => `${4 + props.depth * INDENT}px`;
  const ownX = (props.depth - 1) * INDENT + HALF;
  // Align the description (and body) under the TITLE's first letter:
  // rowPad (4 + depth*INDENT) + toggle 16 + gap 6 + dot 8 + gap 6 ≈ +40.
  const descIndent = () => `${props.depth * INDENT + 40}px`;

  return (
    <li class="relative">
      <Show when={props.depth >= 1}>
        <div class="absolute inset-0 z-10 pointer-events-none">
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
          <div
            class={`absolute rounded-full ${LINE}`}
            style={
              props.isLast
                ? { left: `${ownX - 1}px`, top: '0', height: `${ROWCENTER}px`, width: VW }
                : { left: `${ownX - 1}px`, top: '0', bottom: '0', width: VW }
            }
          />
          <div
            class={`absolute rounded-full ${LINE}`}
            style={{ left: `${ownX - 1}px`, top: `${ROWCENTER - 1}px`, width: `${INDENT + 2}px`, height: HH }}
          />
        </div>
      </Show>

      <div
        onClick={toggle}
        class={`group relative flex items-center gap-1.5 px-2 min-h-[26px] rounded transition-colors ${
          hasBody() ? 'cursor-pointer' : 'cursor-default'
        } ${isBodyOpen() ? 'text-emerald-100' : 'hover:bg-gray-800/40 text-gray-300'}`}
        style={{ 'padding-left': rowPad() }}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          disabled={!hasBody()}
          class={`w-4 h-4 flex-shrink-0 inline-flex items-center justify-center rounded font-mono text-[11px] leading-none transition-colors ${
            !hasBody()
              ? 'text-transparent cursor-default'
              : isBodyOpen()
                ? 'text-emerald-300 bg-emerald-500/10'
                : 'text-gray-500 bg-gray-900/60 hover:text-emerald-300 hover:bg-emerald-500/10'
          }`}
          title={hasBody() ? (isBodyOpen() ? 'cerrar contenido' : 'abrir contenido') : ''}
          aria-label={hasBody() ? (isBodyOpen() ? 'collapse body' : 'open body') : ''}
        >
          {hasBody() ? (isBodyOpen() ? '−' : '+') : ''}
        </button>

        {/* load policy dot */}
        <Dot load={props.node.load} />

        {/* concept title */}
        <span class={`flex-shrink-0 ${hasChildren() ? 'font-semibold text-gray-100' : 'text-gray-200'}`}>
          {props.node.title}
        </span>

        {/* feeds pill */}
        <Show when={props.node.feeds}>
          <span class="flex-shrink-0 text-[9px] text-violet-300/80 border border-violet-500/30 bg-violet-500/10 rounded-full px-1.5 leading-tight py-0.5" title="alimenta otra superficie">
            ◆ {props.node.feeds}
          </span>
        </Show>

        {/* token weight (pinned only — that's the spawn cost) */}
        <span class="ml-auto flex items-center gap-1.5 flex-shrink-0 pl-2">
          <Show when={props.node.load === 'pinned' && props.node.words}>
            <span class="text-[10px] font-mono text-emerald-400/70" title="cuerpo inyectado en cada spawn">
              {Math.round(props.node.words * 1.5)}t
            </span>
          </Show>
        </span>
      </div>

      {/* Description — ALWAYS below the title (no box), smaller, left-aligned
          under the title's first letter, 1-3 lines, within the branch lines. */}
      <Show when={props.node.desc}>
        <p
          class="text-[12px] text-gray-500 leading-relaxed pr-3 pb-1"
          style={{ 'margin-left': descIndent() }}
        >
          {props.node.desc}
        </p>
      </Show>

      {/* On-demand body (the file content) — opens on click, for nodes that
          carry one. */}
      <Show when={hasBody() && isBodyOpen()}>
        <div
          class="my-1.5 mr-2 rounded-lg border border-gray-800/70 bg-gray-950/40 overflow-hidden"
          style={{ 'margin-left': descIndent() }}
        >
          <div class="flex items-center gap-3 px-4 py-2 border-b border-gray-800/60 bg-gray-900/30 text-[10px] text-gray-500">
            <span class="font-mono uppercase tracking-wider text-gray-400">{props.node.title}</span>
            <Show when={props.node.updated}><span>updated: {props.node.updated}</span></Show>
            <span class="ml-auto font-mono text-gray-600">{props.node.load}</span>
          </div>
          <div class="px-4 py-3">
            <Show
              when={bodyHtml.state === 'ready' || bodyHtml.state === 'refreshing'}
              fallback={<p class="text-[11px] text-gray-500 italic">cargando…</p>}
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

      {/* Child concepts — ALWAYS visible (the structure is open). */}
      <Show when={hasChildren()}>
        <ul>
          <For each={props.node.children}>
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
