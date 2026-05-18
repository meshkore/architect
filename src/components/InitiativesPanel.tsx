/**
 * InitiativesPanel — collapsible right rail showing top-level initiatives
 * with task progress per initiative. Same data source as the monolith's
 * initiatives view but minimal.
 */

import { For, Show } from 'solid-js';
import { store } from '~/state/store';

export default function InitiativesPanel() {
  return (
    <aside class="text-sm">
      <div class="text-xs font-mono uppercase tracking-wider text-gray-500 mb-2 px-2">Initiatives</div>
      <Show when={store.initiatives().length > 0} fallback={<EmptyInitiatives />}>
        <ul class="space-y-1.5">
          <For each={store.initiatives()}>
            {(it) => (
              <li class="px-2 py-2 rounded-md bg-gray-900/40 border border-gray-800/60">
                <div class="flex items-start justify-between gap-2 mb-1">
                  <span class="text-gray-200 font-medium text-sm truncate">{it.title}</span>
                  <Show when={it.status}>
                    <span class="font-mono text-[10px] text-gray-500 uppercase">{it.status}</span>
                  </Show>
                </div>
                <Show when={it.oneliner}>
                  <p class="text-xs text-gray-500 leading-snug">{it.oneliner}</p>
                </Show>
                <ProgressBar id={it.id} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </aside>
  );
}

function ProgressBar(props: { id: string }) {
  const tasks = () => store.tasks().filter((t) => t.initiative === props.id);
  const done = () => tasks().filter((t) => t.status === 'done').length;
  const total = () => tasks().length;
  const pct = () => total() === 0 ? 0 : Math.round((done() / total()) * 100);
  return (
    <div class="mt-2">
      <div class="h-1 bg-gray-800 rounded-full overflow-hidden">
        <div class="h-full bg-emerald-500/70" style={{ width: `${pct()}%` }} />
      </div>
      <div class="text-[10px] text-gray-600 mt-1 font-mono">{done()}/{total()} · {pct()}%</div>
    </div>
  );
}

function EmptyInitiatives() {
  return (
    <p class="text-xs text-gray-600 px-2 mt-3 leading-relaxed">
      No initiatives declared. Add files under <span class="font-mono">.meshkore/roadmap/initiatives/</span> and reload.
    </p>
  );
}
