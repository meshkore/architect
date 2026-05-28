/**
 * LinksPanel — V86t.
 *
 * Standard §13 deployment registry, served by the daemon at /links
 * (reads + watches `.meshkore/public/links.yaml`, broadcasts
 * `links.updated` over WS). Operator's mental model:
 *   - PROD is the canonical URL of a module — that's the link they
 *     actually click to verify the deploy. Sits big and primary.
 *   - LOCAL is the dev URL + the command the operator (or their code
 *     agent) runs to spin up that module locally. Cockpit never
 *     spawns; we just SHOW the command so the operator can copy/paste.
 *   - REPO is the branch + commit currently checked out, surfaced so
 *     the operator can tell at a glance whether the prod deploy is in
 *     sync with HEAD.
 *
 * The panel listens for `links.updated` so changes to links.yaml
 * (operator typing, code agent writing) show up without refresh.
 */

import { For, Show, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { uiStore } from '~/state/ui';
import { log } from '~/lib/log';
import type { LinksModule, LinksRegistry } from '~/lib/daemon-client';

export default function LinksPanel() {
  const [reloadKey, setReloadKey] = createSignal(0);

  const [registry] = createResource(
    () => ({ client: daemonStore.state.client, key: reloadKey() }),
    async (input) => {
      if (!input.client) throw new Error('no daemon client');
      const r = await input.client.links();
      if (!r.ok) {
        throw new Error(r.error ?? `HTTP ${r.status}: ${r.body.slice(0, 200)}`);
      }
      return r.data as LinksRegistry;
    },
  );

  // V86t — subscribe to `links.updated` so edits to links.yaml propagate
  // without a refresh. The daemon's LinksRegistry broadcasts on every
  // file mtime tick; we just bump our reload-key signal.
  onMount(() => {
    const ws = daemonStore.state.ws;
    if (!ws) return;
    const off = ws.on('links.updated', () => {
      log.debug('[LinksPanel] links.updated — refetch');
      setReloadKey((k) => k + 1);
    });
    onCleanup(off);
  });

  const modules = createMemo<LinksModule[]>(() => registry()?.modules ?? []);

  return (
    <div class="flex-1 min-h-0 flex flex-col">
      <header class="px-6 pt-6 pb-3 border-b border-gray-800/60 flex items-center gap-3 flex-shrink-0">
        <div class="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
          <svg class="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
        </div>
        <div>
          <h1 class="text-base font-semibold text-gray-100">Links</h1>
          <p class="text-xs text-gray-500">
            Deployment registry · <code class="font-mono text-sky-300/80">.meshkore/public/links.yaml</code>
          </p>
        </div>
        <div class="ml-auto flex items-center gap-2">
          <Show when={modules().length > 0}>
            <span class="text-[10px] font-mono uppercase tracking-wider text-gray-500">
              {modules().length} module{modules().length === 1 ? '' : 's'}
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
          <Show when={registry.error}>
            <ErrorNotice error={String(registry.error)} />
          </Show>
          <Show when={registry.loading && modules().length === 0}>
            <p class="text-sm text-gray-500">Loading links…</p>
          </Show>
          <Show when={!registry.loading && modules().length === 0 && !registry.error}>
            <EmptyNotice />
          </Show>

          <ul class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <For each={modules()}>
              {(m) => <ModuleCard mod={m} />}
            </For>
          </ul>
        </div>
      </div>
    </div>
  );
}

function ModuleCard(props: { mod: LinksModule }) {
  // V86v — compact card. Operator's feedback: tarjetas a la mitad,
  // menos contenido, más al grano. Dropped fields: displayName,
  // project (we know which project we're in), region, deploy_command
  // (deploy agent handles it), deployed sha/ts/by (timeline tracks
  // that), repo footer, health endpoint, out-of-sync banner.
  //
  // What stays: module id (header chip), prod URL pill + optional
  // provider tag, local URL pill + optional run command. The card
  // collapses to whatever it has — empty slots render nothing.
  const prodHref = () => props.mod.prod?.url?.trim() || null;
  const localHref = () => props.mod.local?.url?.trim() || null;
  const localCmd = () => props.mod.local?.command?.trim() || null;
  const provider = () => props.mod.prod?.provider?.trim() || null;

  return (
    <li class="rounded-lg border border-gray-800/60 bg-gray-900/30 px-3 py-2.5 flex flex-col gap-1.5">
      <header class="flex items-center gap-2">
        <span class="font-mono text-[10px] text-sky-300/90 bg-sky-500/10 border border-sky-500/25 rounded px-1.5 py-0.5 uppercase tracking-wider flex-shrink-0">
          {props.mod.id}
        </span>
        <Show when={provider()}>
          <span class="font-mono text-[9px] text-gray-500 uppercase tracking-wider">
            {provider()}
          </span>
        </Show>
      </header>

      <Show when={prodHref()}>
        <a
          href={prodHref()!}
          target="_blank"
          rel="noopener noreferrer"
          class="block px-2 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-200 font-mono text-[11px] truncate transition-colors"
          title={prodHref()!}
        >
          ↗ {prodHref()}
        </a>
      </Show>

      <Show when={localHref()}>
        <a
          href={localHref()!}
          target="_blank"
          rel="noopener noreferrer"
          class="block px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-emerald-200 font-mono text-[11px] truncate transition-colors"
          title={localHref()!}
        >
          ⌂ {localHref()}
        </a>
      </Show>

      <Show when={localCmd()}>
        <CommandBlock cmd={localCmd()!} />
      </Show>

      <Show when={!prodHref() && !localHref() && !localCmd()}>
        <p class="text-[11px] text-gray-600 italic">No links yet.</p>
      </Show>
    </li>
  );
}

function CommandBlock(props: { cmd: string }) {
  const [copied, setCopied] = createSignal(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard denied */ }
  };
  return (
    <div class="flex items-center gap-2 rounded border border-gray-800/60 bg-gray-950/60 px-2 py-1">
      <code class="flex-1 min-w-0 text-[10px] font-mono text-gray-400 truncate" title={props.cmd}>
        {props.cmd}
      </code>
      <button
        type="button"
        onClick={onCopy}
        class="text-[9px] font-mono uppercase tracking-wider text-gray-500 hover:text-emerald-300 flex-shrink-0"
      >
        {copied() ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

function ErrorNotice(props: { error: string }) {
  return (
    <div class="rounded-lg border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200 mb-4">
      <p class="font-semibold mb-1">Couldn't load the links registry.</p>
      <p class="text-red-300/80 font-mono text-[12px]">{props.error}</p>
    </div>
  );
}

function EmptyNotice() {
  return (
    <div class="rounded-lg border border-gray-800/70 bg-gray-900/40 px-5 py-6 text-sm text-gray-400">
      <p class="mb-2">No links declared yet.</p>
      <p class="text-[12px] text-gray-500 mb-3">
        Add a <code class="font-mono text-sky-300/80">.meshkore/public/links.yaml</code> with one block per module. Minimal example:
      </p>
      <pre class="text-[11px] font-mono text-gray-300 bg-gray-950/70 border border-gray-800/70 rounded-md px-3 py-2 whitespace-pre-wrap">{`version: 1
modules:
  - id: webapp
    prod:
      url: https://meshkore.com
      provider: cloudflare-pages
      project: meshkore-web
    local:
      url: http://localhost:8788
      command: cd webapp && npx wrangler pages dev . --port 8788
    repo:
      branch: main`}</pre>
    </div>
  );
}

