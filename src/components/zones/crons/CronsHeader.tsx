import { Show } from 'solid-js';
import { uiStore } from '~/state/ui';
import type { CronListResponse } from '~/lib/daemon-client';

export default function CronsHeader(props: { data: CronListResponse | null }) {
  return (
    <header class="flex items-center justify-between gap-4">
      <div>
        <h1 class="text-lg font-bold text-gray-100">Crons</h1>
        <p class="text-xs text-gray-500 mt-0.5">
          Jobs declared in <span class="font-mono text-gray-400">cluster.yaml.crons</span>.
          One daemon (the <span class="font-mono">crons_owner</span>) actually fires them;
          others observe.
        </p>
      </div>
      <Show when={props.data}>
        {(d) => (
          <div class="flex items-center gap-2 text-[11px] font-mono">
            <span class="px-2 py-1 rounded-md bg-gray-900/60 border border-gray-800 text-gray-400">
              tick {d().tick_sec}s
            </span>
            <span class="px-2 py-1 rounded-md bg-gray-900/60 border border-gray-800 text-gray-400 truncate max-w-[200px]" title={d().identity}>
              {d().identity}
            </span>
            <button
              type="button"
              onClick={() => uiStore.setActiveZone('architect')}
              class="px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
            >
              ← Architect
            </button>
          </div>
        )}
      </Show>
    </header>
  );
}
