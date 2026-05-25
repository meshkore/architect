/**
 * CronList — left rail of the Crons zone. One row per job.
 *
 * Renders the typed `CronJob[]` from `/cron/list` and lights up the
 * currently-selected row. Per-row TriggerNowButton wires the confirm
 * → POST /cron/<id>/trigger flow through the modal harness (M6.1).
 */

import { For, Show } from 'solid-js';
import type { CronJob } from '~/lib/daemon-client';
import TriggerNowButton from './TriggerNowButton';

function relativeNextRun(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const deltaMs = t - Date.now();
  const abs = Math.abs(deltaMs);
  const sign = deltaMs >= 0 ? 'in' : 'ago';
  const sec = Math.round(abs / 1000);
  if (sec < 60) return `${sign === 'in' ? 'in' : ''} ${sec}s ${sign === 'ago' ? 'ago' : ''}`.trim();
  const min = Math.round(sec / 60);
  if (min < 60) return `${sign === 'in' ? 'in' : ''} ${min}m ${sign === 'ago' ? 'ago' : ''}`.trim();
  const hr = Math.round(min / 60);
  if (hr < 48) return `${sign === 'in' ? 'in' : ''} ${hr}h ${sign === 'ago' ? 'ago' : ''}`.trim();
  const days = Math.round(hr / 24);
  return `${sign === 'in' ? 'in' : ''} ${days}d ${sign === 'ago' ? 'ago' : ''}`.trim();
}

export default function CronList(props: {
  jobs: CronJob[];
  selectedId: string | null;
  coordinator: boolean;
  onSelect: (id: string) => void;
  onTrigger: (id: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
}) {
  return (
    <div class="rounded-lg border border-gray-800/60 bg-gray-900/30 overflow-hidden">
      <div class="px-3 py-2 border-b border-gray-800/60 flex items-center justify-between text-[11px] font-mono">
        <span class="text-gray-400">{props.jobs.length} job(s)</span>
        <span class={props.coordinator ? 'text-emerald-400' : 'text-amber-400'}>
          {props.coordinator ? 'coordinator' : 'observer'}
        </span>
      </div>
      <Show
        when={props.jobs.length > 0}
        fallback={
          <div class="px-4 py-6 text-center text-xs text-gray-500">
            No <span class="font-mono text-gray-400">crons:</span> entries in
            <span class="font-mono text-gray-400"> cluster.yaml</span>.
          </div>
        }
      >
        <ul class="divide-y divide-gray-800/40">
          <For each={props.jobs}>
            {(job) => {
              const selected = () => props.selectedId === job.id;
              return (
                <li class={`${selected() ? 'bg-emerald-500/5' : ''}`}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(job.id)}
                    class="w-full text-left px-3 py-2.5 hover:bg-gray-800/30 transition-colors"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <span
                        class={`inline-block w-2 h-2 rounded-full shrink-0 ${
                          job.running ? 'bg-amber-400 animate-pulse-soft'
                          : !job.enabled ? 'bg-gray-600'
                          : 'bg-emerald-400'
                        }`}
                        title={job.running ? 'running' : job.enabled ? 'idle' : 'disabled'}
                      />
                      <span class="text-sm text-gray-100 font-medium truncate">{job.name}</span>
                      <span class="text-[10px] text-gray-500 font-mono shrink-0">{job.id}</span>
                    </div>
                    <div class="mt-1 flex items-center gap-3 text-[11px] font-mono text-gray-500">
                      <span class="truncate">{job.schedule}</span>
                      <span class="shrink-0 text-gray-600">·</span>
                      <span class="truncate">next {relativeNextRun(job.next_run)}</span>
                    </div>
                  </button>
                  <div class="px-3 pb-2 -mt-1 flex items-center gap-2">
                    <TriggerNowButton
                      jobId={job.id}
                      jobName={job.name}
                      destructive={job.destructive}
                      disabled={!props.coordinator || !job.enabled || job.running}
                      disabledReason={
                        !props.coordinator ? 'This daemon is not the cron coordinator.'
                        : !job.enabled ? 'Job is disabled in cluster.yaml.'
                        : job.running ? 'Already running.'
                        : undefined
                      }
                      onTrigger={() => props.onTrigger(job.id)}
                    />
                    <Show when={job.running}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void props.onCancel(job.id); }}
                        class="px-2 py-1 rounded-md text-[10px] font-medium bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 transition-colors"
                      >
                        Cancel run
                      </button>
                    </Show>
                  </div>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </div>
  );
}
