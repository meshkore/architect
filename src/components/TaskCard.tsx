/**
 * TaskCard — V107.22.
 *
 * Single-line row by default: id chip + title + priority dot. Click
 * anywhere on the row → inline expansion:
 *   - Rich-text body (Goal / Done when / How — full markdown via
 *     marked.js).
 *   - "Files" chip row (the planned `## Files` paths from the task
 *     body; click-to-copy).
 *   - Module badge (small pill with the task's `category:` module).
 *
 * Body is fetched lazy via `client.readMarkdownFile(task.path)` only
 * when the row is FIRST expanded, then cached for the life of the
 * card. /state stays slim — no body payload across N tasks.
 *
 * ID display: dotted-numeric ids (`1`, `1.1`, `1.1.1`) render with
 * a `#` prefix (`#1.1.1`); legacy alphanumeric ids (`T4`, `M1.1`,
 * `MKT5`, `CRON-02`) render literally.
 */

import { For, Show, createMemo, createResource } from 'solid-js';
import type { ServerTask } from '~/state/server';
import { activeTaskIds, allModules } from '~/state/server';
import { daemonStore } from '~/state/daemon';
import { viewStore } from '~/state/view';
import { displayTaskId, parseTaskBody } from '~/lib/task-id';
import { ensureMarked } from '~/lib/cdn-loaders';
import { log } from '~/lib/log';

// V107.23 — Module-level body cache. Keyed by full daemon URL (which
// embeds httpBase + port + path), so two clusters' tasks with the
// same relative path can't collide. Survives For-loop remounts caused
// by serverStore.refresh, so a row that was already expanded
// re-renders INSTANTLY without flashing "loading task body…" while
// the fetch round-trips again.
const taskBodyCache = new Map<string, string>();

function codeChipClass(status: string): string {
  switch (status) {
    case 'done':
      return 'bg-emerald-500/25 text-emerald-100 border-emerald-500/50';
    case 'active':
    case 'in_progress':
      return 'bg-amber-500/30 text-amber-100 border-amber-400/70 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.35)]';
    case 'next':
      return 'bg-amber-500/12 text-amber-300 border-amber-500/35';
    case 'blocked':
      return 'bg-red-500/20 text-red-200 border-red-500/55';
    case 'pending-operator':
    case 'pending_operator':
      return 'bg-orange-500/20 text-orange-300 border-orange-500/55';
    case 'cancelled':
      return 'bg-gray-800/60 text-gray-500 border-gray-700/60 line-through decoration-gray-600';
    default:
      return 'bg-gray-800/60 text-gray-400 border-gray-700/70';
  }
}

function moduleBadgeClass(kind: string | undefined): string {
  // V107.23 — Borderless. The id chip on the left already carries
  // a colored border; adding one to the module badge on the right
  // made them read as "two ids" instead of "id + module". Color the
  // bg + text only.
  switch (kind) {
    case 'code':
      return 'bg-sky-500/15 text-sky-300';
    case 'area':
      return 'bg-violet-500/15 text-violet-300';
    case 'spec':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'docs':
      return 'bg-amber-500/15 text-amber-300';
    default:
      return 'bg-gray-800/60 text-gray-400';
  }
}

export default function TaskCard(props: { task: ServerTask }) {
  // V107.23 — Expanded state lives in `viewStore` (persisted per
  // cluster in localStorage). Local `createSignal` was being wiped
  // every time serverStore.refresh() landed and Solid's <For> rebuilt
  // the array with fresh task references — the operator saw the row
  // auto-collapse 1-2 s after opening it. viewStore survives the
  // remount and restores the expanded state immediately.
  const expanded = () => viewStore.isTaskExpanded(props.task.id);
  const toggle = (): void => viewStore.toggleTask(props.task.id);

  // V107.22 — Fetch the markdown file ONLY when the row is first
  // expanded. createResource keyed on (client, path, expanded gate).
  // Returns null until expanded; serves the parsed body afterwards.
  // V107.23 — Hits `taskBodyCache` first; only round-trips on first
  // open per file. Survives For-loop remounts.
  const [bodyRes] = createResource(
    () => (expanded() ? { client: daemonStore.state.client, path: props.task.path } : null),
    async (input) => {
      if (!input || !input.client || !input.path) return null;
      const cacheKey = input.client.transport.httpBase + ':' + input.path;
      const cached = taskBodyCache.get(cacheKey);
      if (cached !== undefined) return cached;
      const r = await input.client.readMarkdownFile(input.path);
      if (!r.ok) return null;
      taskBodyCache.set(cacheKey, r.body);
      return r.body;
    },
  );

  const parsed = createMemo(() => parseTaskBody(bodyRes() ?? ''));

  // Render the markdown body to HTML via marked.js (CDN-loaded).
  const [html] = createResource(
    () => parsed().body,
    async (raw) => {
      if (!raw) return '';
      try {
        const marked = await ensureMarked();
        return marked.parse(raw, { gfm: true }) as string;
      } catch (e) {
        log.warn('task-card marked render failed', e instanceof Error ? e.message : String(e));
        return '';
      }
    },
  );

  const moduleId = (): string => props.task.module ?? props.task.category ?? '';
  const moduleKind = (): string | undefined => {
    const id = moduleId();
    if (!id) return undefined;
    const m = allModules().find((x) => x.id === id);
    return (m?.kind as string | undefined) ?? undefined;
  };
  const moduleName = (): string => {
    const id = moduleId();
    if (!id) return '';
    const m = allModules().find((x) => x.id === id);
    return (m?.name as string | undefined) ?? id;
  };

  const idDisplay = (): string => displayTaskId(props.task.id);

  const copyFile = async (p: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(p);
    } catch (e) {
      log.warn('clipboard write failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      data-task-id={props.task.id}
      data-status={props.task.status}
      class="min-w-0"
    >
      {/* Single-line collapsed row — click anywhere to expand. V107.23:
          chevron dropped (cursor + hover bg are enough affordance).
          State persisted in viewStore so serverStore refresh doesn't
          auto-collapse. */}
      <button
        type="button"
        onClick={toggle}
        class="w-full text-left py-2.5 hover:bg-gray-800/30 rounded-md transition-colors"
      >
        <div class="flex items-baseline gap-3 min-w-0 px-1">
          <span
            aria-label={`status ${props.task.status}${activeTaskIds().has(props.task.id) ? ' · agent working live' : ''}`}
            title={
              activeTaskIds().has(props.task.id)
                ? `${props.task.status} · agent working live`
                : props.task.status
            }
            class={`flex-shrink-0 inline-block min-w-[3.5rem] text-center font-mono text-[10px] uppercase tracking-wider px-1.5 py-1 rounded border leading-none ${
              activeTaskIds().has(props.task.id)
                ? 'bg-amber-500/30 text-amber-100 border-amber-400/70 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.35)]'
                : codeChipClass(props.task.status)
            }`}
          >
            {idDisplay()}
          </span>
          <h4 class="text-[13px] font-medium text-gray-100 leading-snug break-words min-w-0 flex-1">
            {props.task.title}
          </h4>
          <Show when={moduleId()}>
            <span
              class={`flex-shrink-0 font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${moduleBadgeClass(moduleKind())}`}
              title={`Module: ${moduleName()}`}
            >
              {moduleId()}
            </span>
          </Show>
          <Show when={props.task.priority === 'high' || props.task.priority === 'critical'}>
            <span
              class="font-mono text-[9px] text-amber-400/80 flex-shrink-0 uppercase"
              title={`Priority: ${props.task.priority}`}
            >
              !
            </span>
          </Show>
        </div>
      </button>

      {/* Expanded body */}
      <Show when={expanded()}>
        <div class="pl-[4.5rem] pr-2 pb-3 space-y-3">
          {/* Module badge (full version with name when expanded) */}
          <Show when={moduleId()}>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono text-[9px] text-gray-500 uppercase tracking-wider">module</span>
              <span
                class={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${moduleBadgeClass(moduleKind())}`}
              >
                {moduleId()}
              </span>
              <Show when={moduleName() !== moduleId()}>
                <span class="text-[11px] text-gray-400">— {moduleName()}</span>
              </Show>
            </div>
          </Show>

          {/* Rich body */}
          <Show when={bodyRes.loading}>
            <p class="text-[11px] text-gray-500 italic">loading task body…</p>
          </Show>
          <Show when={!bodyRes.loading && html()}>
            <div
              class="prose prose-sm prose-invert max-w-none text-[12px] text-gray-300 leading-relaxed [&_h1]:hidden [&_h2]:text-[11px] [&_h2]:font-mono [&_h2]:uppercase [&_h2]:tracking-wider [&_h2]:text-gray-400 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5 [&_li]:my-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-emerald-300/90 [&_code]:bg-gray-900/60 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-gray-950/70 [&_pre]:border [&_pre]:border-gray-800/60 [&_pre]:rounded [&_pre]:p-2 [&_pre]:my-2 [&_a]:text-sky-300 [&_a]:underline"
              innerHTML={html() ?? ''}
            />
          </Show>
          <Show when={!bodyRes.loading && !html() && !props.task.path}>
            <p class="text-[11px] text-gray-600 italic">
              No body — this task has no markdown file on disk.
            </p>
          </Show>

          {/* Files block — rendered separately when the parser finds
              a `## Files` section. Markdown above already includes
              this section visually, but the chip row gives the
              operator a click-to-copy affordance. */}
          <Show when={parsed().files.length > 0}>
            <div class="space-y-1.5">
              <div class="font-mono text-[9px] text-gray-500 uppercase tracking-wider">
                planned files ({parsed().files.length})
              </div>
              <div class="flex flex-wrap gap-1.5">
                <For each={parsed().files}>
                  {(f) => (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void copyFile(f); }}
                      title={`Click to copy "${f}"`}
                      class="font-mono text-[10px] text-sky-200 bg-sky-500/10 border border-sky-500/30 hover:bg-sky-500/20 hover:border-sky-500/50 rounded px-1.5 py-0.5 transition-colors"
                    >
                      {f}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
