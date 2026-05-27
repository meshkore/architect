/**
 * ProtocolsPanel — V86j.
 *
 * Reads the cluster's reusable runbooks from the daemon's
 * `/protocols` registry (Standard §14). Each entry is a P<N>-*.md
 * file under `.meshkore/protocols/`; the index returns frontmatter
 * (id, title, scope, status, priority, owner, updated, tags,
 * log_count), the per-entry body via `/protocols/<id>`.
 *
 * Layout is the same collapsible-card pattern as DiaryPanel: list of
 * runbooks at the top, click a card to expand its body in place,
 * markdown rendered via the CDN-loaded `marked` instance. Frontmatter
 * fields render as a chip strip above the body (status / scope /
 * priority / owner / tags) so the operator can scan applicability
 * without opening the body.
 */

import { For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { daemonStore } from '~/state/daemon';
import { ensureMarked } from '~/lib/cdn-loaders';
import { uiStore } from '~/state/ui';
import { log } from '~/lib/log';
import type { ProtocolSummary, ProtocolListResponse } from '~/lib/daemon-client';

interface BodyState {
  loading: boolean;
  body: string | null;
  html: string | null;
  error: string | null;
  frontmatter: Record<string, unknown> | null;
}

export default function ProtocolsPanel() {
  const [index] = createResource(
    () => daemonStore.state.client,
    async (client) => {
      const r = await client.protocols();
      if (!r.ok) {
        throw new Error(r.error ?? `HTTP ${r.status}: ${r.body.slice(0, 200)}`);
      }
      return r.data as ProtocolListResponse;
    },
  );

  const protocols = createMemo<ProtocolSummary[]>(() => index()?.protocols ?? []);
  const [search, setSearch] = createSignal('');
  const [scopeFilter, setScopeFilter] = createSignal<'all' | 'cluster' | 'project'>('all');
  const [expanded, setExpanded] = createSignal<string | null>(null);
  const [bodies, setBodies] = createStore<Record<string, BodyState>>({});

  const visible = createMemo<ProtocolSummary[]>(() => {
    const q = search().toLowerCase().trim();
    const scope = scopeFilter();
    return protocols().filter((p) => {
      if (scope !== 'all' && p.scope !== scope) return false;
      if (q) {
        const hay = `${p.id} ${p.title} ${(p.tags ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  const loadBody = async (id: string): Promise<void> => {
    if (bodies[id]?.body) return;
    if (bodies[id]?.loading) return;
    setBodies(id, { loading: true, body: null, html: null, error: null, frontmatter: null });
    const client = daemonStore.state.client;
    if (!client) {
      setBodies(id, { loading: false, body: null, html: null, error: 'no daemon', frontmatter: null });
      return;
    }
    const r = await client.protocolDetail(id);
    if (!r.ok) {
      setBodies(id, {
        loading: false,
        body: null,
        html: null,
        error: r.error ?? `HTTP ${r.status}`,
        frontmatter: null,
      });
      return;
    }
    let html: string | null = null;
    try {
      const marked = await ensureMarked();
      html = marked.parse(r.data.body, { gfm: true });
    } catch (e) {
      log.warn('protocols marked render failed', e instanceof Error ? e.message : String(e));
    }
    setBodies(id, {
      loading: false,
      body: r.data.body,
      html,
      error: null,
      frontmatter: r.data.frontmatter ?? null,
    });
  };

  const toggle = (id: string): void => {
    const next = expanded() === id ? null : id;
    setExpanded(next);
    if (next) void loadBody(next);
  };

  return (
    <div class="flex-1 min-h-0 flex flex-col bg-canvas">
      <header class="px-6 pt-6 pb-3 border-b border-gray-800/60 flex items-center gap-3 flex-shrink-0">
        <div class="w-8 h-8 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <svg class="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h10" />
            <circle cx="18" cy="17" r="2.5" />
          </svg>
        </div>
        <div>
          <h1 class="text-base font-semibold text-gray-100">Protocols</h1>
          <p class="text-xs text-gray-500">
            Reusable runbooks from{' '}
            <code class="font-mono text-violet-300/80">.meshkore/protocols/</code>
          </p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <Show when={protocols().length > 0}>
            <span class="text-[10px] font-mono uppercase tracking-wider text-gray-500">
              {visible().length} of {protocols().length}
            </span>
          </Show>
          <button
            type="button"
            onClick={() => uiStore.setActiveZone('architect')}
            class="px-2.5 py-1 rounded-md bg-gray-800/60 hover:bg-gray-700/60 text-gray-300 text-[11px] font-mono uppercase tracking-wider transition-colors"
          >
            ← back
          </button>
        </div>
      </header>

      <div class="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <div class="max-w-3xl mx-auto">
          <div class="flex items-center gap-2 mb-4">
            <input
              type="text"
              placeholder="Search by id, title, tag…"
              value={search()}
              onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
              class="bg-gray-900/60 border border-gray-800 rounded-md px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500/50 flex-1 max-w-xs"
            />
            <div class="flex items-center gap-1">
              <ScopePill label="all" active={scopeFilter() === 'all'} onClick={() => setScopeFilter('all')} />
              <ScopePill label="cluster" active={scopeFilter() === 'cluster'} onClick={() => setScopeFilter('cluster')} />
              <ScopePill label="project" active={scopeFilter() === 'project'} onClick={() => setScopeFilter('project')} />
            </div>
          </div>

          <Show when={index.error}>
            <div class="rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200 mb-4">
              <p class="font-semibold mb-1">Couldn't load the protocols registry.</p>
              <p class="text-red-300/80 font-mono text-[12px]">{String(index.error)}</p>
            </div>
          </Show>
          <Show when={index.loading && protocols().length === 0}>
            <p class="text-sm text-gray-500">Loading the protocols registry…</p>
          </Show>
          <Show when={!index.loading && protocols().length === 0 && !index.error}>
            <p class="text-sm text-gray-500">No protocols declared in this project yet.</p>
          </Show>

          <ul class="space-y-3">
            <For each={visible()}>
              {(p) => (
                <ProtocolCard
                  proto={p}
                  expanded={expanded() === p.id}
                  state={bodies[p.id] ?? { loading: false, body: null, html: null, error: null, frontmatter: null }}
                  onToggle={() => toggle(p.id)}
                />
              )}
            </For>
          </ul>
        </div>
      </div>
    </div>
  );
}

function ScopePill(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`px-2.5 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider transition-colors ${
        props.active
          ? 'bg-violet-500/15 text-violet-300 border border-violet-500/40'
          : 'text-gray-500 hover:text-gray-300 border border-transparent'
      }`}
    >
      {props.label}
    </button>
  );
}

function ProtocolCard(props: {
  proto: ProtocolSummary;
  expanded: boolean;
  state: BodyState;
  onToggle: () => void;
}) {
  return (
    <li class="bg-gray-900/40 border border-gray-800/70 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={props.onToggle}
        class="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-gray-900/60 transition-colors"
      >
        <span class="font-mono text-[10px] text-violet-300/90 bg-violet-500/10 border border-violet-500/25 rounded px-1.5 py-0.5 uppercase tracking-wider mt-0.5 flex-shrink-0">
          {props.proto.id}
        </span>
        <div class="flex-1 min-w-0">
          <div class="text-sm text-gray-100 font-medium">{props.proto.title}</div>
          <div class="text-[10px] text-gray-500 mt-0.5 flex flex-wrap items-center gap-2">
            <Show when={props.proto.scope}>
              <span class="font-mono uppercase tracking-wider">{props.proto.scope}</span>
            </Show>
            <Show when={props.proto.status}>
              <span class="text-gray-700">·</span>
              <StatusBadge status={props.proto.status as string} />
            </Show>
            <Show when={props.proto.priority}>
              <span class="text-gray-700">·</span>
              <span class="font-mono uppercase tracking-wider">{props.proto.priority}</span>
            </Show>
            <Show when={props.proto.log_count !== undefined && props.proto.log_count > 0}>
              <span class="text-gray-700">·</span>
              <span class="font-mono">{props.proto.log_count} run{props.proto.log_count === 1 ? '' : 's'}</span>
            </Show>
            <Show when={props.proto.updated}>
              <span class="text-gray-700">·</span>
              <span class="font-mono">updated {props.proto.updated}</span>
            </Show>
          </div>
          <Show when={(props.proto.tags ?? []).length > 0}>
            <div class="mt-1 flex flex-wrap gap-1">
              <For each={props.proto.tags}>
                {(t) => (
                  <span class="font-mono text-[9px] text-gray-400 bg-gray-800/60 border border-gray-700/60 rounded px-1.5 py-0.5">{t}</span>
                )}
              </For>
            </div>
          </Show>
        </div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          class={`text-gray-600 flex-shrink-0 mt-1 transition-transform ${props.expanded ? 'rotate-180' : ''}`}>
          <path d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      <Show when={props.expanded}>
        <div class="px-4 pb-4 pt-2 border-t border-gray-800/60">
          <Show when={props.state.loading}>
            <p class="text-xs text-gray-500 font-mono">loading…</p>
          </Show>
          <Show when={props.state.error}>
            <p class="text-xs text-red-400 font-mono">load failed — {props.state.error}</p>
          </Show>
          <Show when={props.state.html}>
            <div class="md prose prose-invert max-w-none text-[13px] leading-relaxed" innerHTML={props.state.html ?? ''} />
          </Show>
          <Show when={!props.state.html && props.state.body && !props.state.loading}>
            <pre class="whitespace-pre-wrap text-[12px] text-gray-300 font-mono leading-relaxed">{props.state.body ?? ''}</pre>
          </Show>
        </div>
      </Show>
    </li>
  );
}

function StatusBadge(props: { status: string }) {
  const cls = () => {
    switch (props.status) {
      case 'stable': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'draft': return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'deprecated': return 'bg-gray-700/40 text-gray-500 border-gray-700';
      default: return 'bg-gray-800/60 text-gray-400 border-gray-700';
    }
  };
  return (
    <span class={`px-1.5 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider ${cls()}`}>
      {props.status}
    </span>
  );
}
