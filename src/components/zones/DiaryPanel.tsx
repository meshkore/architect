/**
 * DiaryPanel — V86j.
 *
 * Reverse-chronological viewer over `.meshkore/log/<YYYY-MM-DD>.md`.
 * Boots by hitting `GET /log` (py-1.9.0, `files.log` feature) to get
 * the descending date index, then lazy-loads each day's body the
 * first time it scrolls into view. Pages are kept once loaded so
 * scroll-up doesn't re-fetch.
 *
 * Why this design instead of "load everything":
 *   - 10-30 KB markdown per day adds up over months. Lazy paging
 *     keeps the initial paint cheap.
 *   - The cockpit re-renders this panel on every project hot-swap;
 *     keeping state in a `createStore` lets the previous fetches
 *     survive the swap.
 *
 * Operator UX:
 *   - Newest day always at the top. Each day is a collapsible card
 *     that defaults to expanded for the first 3 days (so the diary
 *     reads as a feed) and collapsed below that (so you scroll
 *     titles, expand the day you want).
 *   - The whole list scrolls; an IntersectionObserver at the bottom
 *     triggers the next batch of body fetches as you approach the end.
 *   - If the daemon doesn't expose `files.log` yet (older py-1.8.x),
 *     a banner tells the operator to upgrade and points at the
 *     command the cockpit already knows how to run.
 */

import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import { daemonStore } from '~/state/daemon';
import { ensureMarked } from '~/lib/cdn-loaders';
import { uiStore } from '~/state/ui';
import type { LogEntry } from '~/lib/daemon-client';

const DEFAULT_EXPANDED = 3;     // expand this many newest days by default
const BATCH_SIZE = 5;            // load this many bodies per IO trigger

interface BodyState { loading: boolean; body: string | null; error: string | null; html: string | null; }

export default function DiaryPanel() {
  const supported = createMemo(() => {
    const features = daemonStore.state.health?.features ?? [];
    return features.includes('files.log');
  });

  const [index] = createResource(
    () => daemonStore.state.client,
    async (client) => {
      const r = await client.logList();
      if (!r.ok) {
        throw new Error(r.error ?? `HTTP ${r.status}: ${r.body.slice(0, 200)}`);
      }
      return r.data;
    },
  );

  const entries = createMemo<LogEntry[]>(() => index()?.entries ?? []);

  // body cache keyed by entry.name. Survives the panel mount/unmount
  // cycle of the zone switcher (uiStore re-renders Cockpit children
  // when activeZone flips back to architect and back to diary).
  const [bodies, setBodies] = createStore<Record<string, BodyState>>({});
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [batchHead, setBatchHead] = createSignal(BATCH_SIZE);

  // V107.2 — On project swap, the daily-log entries collide by name
  // across clusters (every cluster has its own `.meshkore/log/<date>.md`
  // with different content). Reset the body cache + expanded set +
  // batchHead so the new cluster's diary can't accidentally render
  // the previous cluster's body.
  createEffect(() => {
    void daemonStore.state.client; // track for reactivity
    setBodies({});
    setExpanded(new Set<string>());
    setBatchHead(BATCH_SIZE);
  });

  // Auto-expand the first N entries when the index lands.
  const seedExpansion = (list: LogEntry[]): void => {
    if (expanded().size > 0) return;
    const init = new Set<string>();
    for (const e of list.slice(0, DEFAULT_EXPANDED)) init.add(e.name);
    setExpanded(init);
  };

  const toggle = (name: string): void => {
    const next = new Set(expanded());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpanded(next);
  };

  const loadBody = async (name: string): Promise<void> => {
    if (bodies[name]?.body !== undefined && bodies[name]?.body !== null) return;
    if (bodies[name]?.loading) return;
    setBodies(name, { loading: true, body: null, error: null, html: null });
    const client = daemonStore.state.client;
    if (!client) {
      setBodies(name, { loading: false, body: null, error: 'no daemon', html: null });
      return;
    }
    const r = await client.logFile(name);
    if (!r.ok) {
      setBodies(name, {
        loading: false,
        body: null,
        error: r.error ?? `HTTP ${r.status}`,
        html: null,
      });
      return;
    }
    // QX6 — we no longer pre-render the whole day to one HTML blob; the
    // diary parses each day into `## HH:MM · …` headlines and renders a
    // section's markdown lazily only when the operator expands it.
    setBodies(name, { loading: false, body: r.body, error: null, html: null });
  };

  // Whenever the index lands or batchHead grows, pre-fetch the bodies
  // for visible entries so expand/scroll is instant. We don't render
  // past `batchHead` until the sentinel scrolls into view.
  const ensureBatch = (): void => {
    const list = entries();
    seedExpansion(list);
    const head = Math.min(batchHead(), list.length);
    for (let i = 0; i < head; i += 1) {
      void loadBody(list[i]!.name);
    }
  };

  // Watch entries() reactively to kick off the initial batch fetch.
  createMemo(() => {
    if (entries().length === 0) return;
    ensureBatch();
  });

  // Infinite-scroll sentinel
  let sentinel: HTMLDivElement | undefined;
  let observer: IntersectionObserver | undefined;
  onMount(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver((records) => {
      for (const rec of records) {
        if (rec.isIntersecting) {
          setBatchHead((h) => Math.min(h + BATCH_SIZE, entries().length));
          ensureBatch();
          break;
        }
      }
    }, { rootMargin: '200px' });
    if (sentinel) observer.observe(sentinel);
  });
  onCleanup(() => { observer?.disconnect(); });

  const visible = createMemo<LogEntry[]>(() => entries().slice(0, batchHead()));

  return (
    <div class="flex-1 min-h-0 flex flex-col">
      <header class="px-6 pt-6 pb-3 border-b border-gray-800/60 flex items-center gap-3 flex-shrink-0">
        <div class="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <svg class="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M4 4h12a2 2 0 012 2v14l-4-2-4 2-4-2-2 2V6a2 2 0 012-2z" />
            <path d="M8 8h8M8 12h8M8 16h5" />
          </svg>
        </div>
        <div>
          <h1 class="text-base font-semibold text-gray-100">Diary</h1>
          <p class="text-xs text-gray-500">
            What got done, newest first — headlines you can skim, detail on tap
          </p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <Show when={entries().length > 0}>
            <span class="text-[10px] font-mono uppercase tracking-wider text-gray-500">
              {entries().length} day{entries().length === 1 ? '' : 's'}
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
        <Show when={supported()} fallback={<UnsupportedNotice />}>
          <Show when={index.error}>
            <ErrorNotice error={String(index.error)} />
          </Show>
          <Show when={index.loading && entries().length === 0}>
            <p class="text-sm text-gray-500">Loading the diary index…</p>
          </Show>
          <Show when={!index.loading && entries().length === 0 && !index.error}>
            <EmptyNotice />
          </Show>

          <ul class="space-y-4 max-w-3xl mx-auto">
            <For each={visible()}>
              {(entry) => (
                <DayCard
                  entry={entry}
                  expanded={expanded().has(entry.name)}
                  state={bodies[entry.name] ?? { loading: false, body: null, error: null, html: null }}
                  onToggle={() => toggle(entry.name)}
                  onRequestLoad={() => void loadBody(entry.name)}
                />
              )}
            </For>
          </ul>

          <Show when={batchHead() < entries().length}>
            <div ref={(el) => (sentinel = el)} class="text-center text-[11px] text-gray-600 py-6 font-mono uppercase tracking-wider">
              loading more days…
            </div>
          </Show>
          <Show when={batchHead() >= entries().length && entries().length > BATCH_SIZE}>
            <div class="text-center text-[11px] text-gray-700 py-6 font-mono uppercase tracking-wider">
              end of the log · {entries().length} day{entries().length === 1 ? '' : 's'} loaded
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

interface DaySection { time: string; title: string; body: string; }

/** Split a day's log markdown into its `## HH:MM · summary` sections.
 *  Everything before the first `##` (after the `# <date>` H1) is the
 *  lead. Each section keeps its time (when the heading is `HH:MM · …`)
 *  and its body markdown for on-demand rendering. */
function splitDaySections(md: string): { lead: string; sections: DaySection[] } {
  const text = md.replace(/^#\s+.*\n?/, ''); // strip the `# <date>` H1
  const lead: string[] = [];
  const sections: DaySection[] = [];
  let cur: { heading: string; body: string[] } | null = null;
  const flush = (): void => {
    if (!cur) return;
    const h = cur.heading.replace(/^##\s+/, '').trim();
    const tm = /^(\d{1,2}:\d{2})\s*·\s*(.*)$/.exec(h);
    sections.push({
      time: tm ? tm[1]! : '',
      title: tm ? tm[2]!.trim() : h,
      body: cur.body.join('\n').trim(),
    });
  };
  for (const ln of text.split('\n')) {
    if (/^##\s+/.test(ln)) { flush(); cur = { heading: ln, body: [] }; }
    else if (cur) cur.body.push(ln);
    else lead.push(ln);
  }
  flush();
  return { lead: lead.join('\n').trim(), sections };
}

/** Lazily renders a markdown string to HTML (marked loaded on demand);
 *  falls back to a mono pre-block while/if the renderer is unavailable. */
function MarkdownBlock(props: { text: string }) {
  const [html] = createResource(
    () => props.text,
    async (text) => {
      if (!text.trim()) return '';
      try {
        const marked = await ensureMarked();
        return marked.parse(text, { gfm: true }) as string;
      } catch {
        return '';
      }
    },
  );
  return (
    <Show
      when={html()}
      fallback={<pre class="whitespace-pre-wrap text-[12px] text-gray-400 font-mono leading-relaxed">{props.text}</pre>}
    >
      <div class="md prose prose-invert max-w-none text-[13px] leading-relaxed" innerHTML={html() ?? ''} />
    </Show>
  );
}

/** One headline row — `▸ HH:MM  summary`; expands to the section detail. */
function SectionRow(props: { section: DaySection }) {
  const [open, setOpen] = createSignal(false);
  const hasBody = (): boolean => props.section.body.length > 0;
  return (
    <li class="border-b border-gray-800/40 last:border-0">
      <button
        type="button"
        onClick={() => hasBody() && setOpen(!open())}
        class="w-full flex items-baseline gap-2 py-1.5 px-1 text-left rounded hover:bg-gray-900/40 transition-colors"
        classList={{ 'cursor-default': !hasBody() }}
      >
        <span class="text-gray-600 text-[10px] w-3 flex-shrink-0">{hasBody() ? (open() ? '▾' : '▸') : '·'}</span>
        <Show when={props.section.time}>
          <span class="font-mono text-[11px] text-amber-300/80 tabular-nums flex-shrink-0">{props.section.time}</span>
        </Show>
        <span class="text-[13px] text-gray-200 leading-snug">{props.section.title}</span>
      </button>
      <Show when={open() && hasBody()}>
        <div class="pl-6 pr-1 pb-3 pt-1">
          <MarkdownBlock text={props.section.body} />
        </div>
      </Show>
    </li>
  );
}

function DayCard(props: {
  entry: LogEntry;
  expanded: boolean;
  state: BodyState;
  onToggle: () => void;
  onRequestLoad: () => void;
}) {
  // Kick off the body fetch the first time the card expands, in case
  // the auto-batcher hasn't reached this entry yet.
  const handleToggle = (): void => {
    if (!props.expanded && !props.state.body && !props.state.loading) {
      props.onRequestLoad();
    }
    props.onToggle();
  };

  const parsed = createMemo(() =>
    props.state.body ? splitDaySections(props.state.body) : { lead: '', sections: [] },
  );

  return (
    <li class="bg-gray-900/40 border border-gray-800/70 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={handleToggle}
        class="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-900/60 transition-colors"
      >
        <div class="flex flex-col min-w-0">
          <span class="text-sm font-semibold text-gray-100">
            {props.entry.date ?? props.entry.name.replace(/\.md$/, '')}
          </span>
          <Show when={props.state.body && parsed().sections.length > 0}>
            <span class="text-[10px] text-gray-600 font-mono">
              {parsed().sections.length} entr{parsed().sections.length === 1 ? 'y' : 'ies'}
            </span>
          </Show>
        </div>
        <span class="ml-auto text-gray-600 flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            class={`transition-transform ${props.expanded ? 'rotate-180' : ''}`}>
            <path d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </span>
      </button>

      <Show when={props.expanded}>
        <div class="px-4 pb-3 pt-1 border-t border-gray-800/60">
          <Show when={props.state.loading}>
            <p class="text-xs text-gray-500 font-mono">loading…</p>
          </Show>
          <Show when={props.state.error}>
            <p class="text-xs text-red-400 font-mono">load failed — {props.state.error}</p>
          </Show>
          <Show when={props.state.body && !props.state.loading}>
            <Show when={parsed().lead}>
              <div class="pb-2 mb-1 border-b border-gray-800/40 opacity-80">
                <MarkdownBlock text={parsed().lead} />
              </div>
            </Show>
            <Show
              when={parsed().sections.length > 0}
              fallback={<MarkdownBlock text={props.state.body!} />}
            >
              <ul>
                <For each={parsed().sections}>{(s) => <SectionRow section={s} />}</For>
              </ul>
            </Show>
          </Show>
        </div>
      </Show>
    </li>
  );
}

function UnsupportedNotice() {
  return (
    <div class="max-w-xl mx-auto rounded-lg border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-200">
      <p class="font-semibold mb-1">Daemon doesn't expose <code class="font-mono">files.log</code> yet.</p>
      <p class="text-amber-300/80 leading-relaxed">
        Upgrade the daemon to <span class="font-mono">py-1.9.0</span> or later. Once it answers{' '}
        <code class="font-mono">/log</code>, this view will populate automatically.
      </p>
    </div>
  );
}

function ErrorNotice(props: { error: string }) {
  return (
    <div class="max-w-xl mx-auto rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200">
      <p class="font-semibold mb-1">Couldn't load the diary index.</p>
      <p class="text-red-300/80 font-mono text-[12px]">{props.error}</p>
    </div>
  );
}

function EmptyNotice() {
  return (
    <div class="max-w-xl mx-auto rounded-lg border border-gray-800/70 bg-gray-900/40 px-5 py-6 text-sm text-gray-400 text-center">
      <p class="mb-1">No day-logs yet.</p>
      <p class="text-[12px] text-gray-500">
        New entries land in <code class="font-mono">.meshkore/log/&lt;YYYY-MM-DD&gt;.md</code> as the closure protocol runs.
      </p>
    </div>
  );
}

