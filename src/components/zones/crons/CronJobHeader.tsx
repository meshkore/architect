import { Show } from 'solid-js';
import type { CronJob } from '~/lib/daemon-client';

export default function CronJobHeader(props: { job: CronJob }) {
  return (
    <div class="rounded-lg border border-gray-800/60 bg-gray-900/30 px-3 py-2">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-gray-100">{props.job.name}</h2>
        <span class="text-[10px] font-mono text-gray-500">{props.job.id}</span>
        <Show when={props.job.destructive}>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-red-300 font-mono">destructive</span>
        </Show>
      </div>
      <p class="text-[11px] font-mono text-gray-500 mt-1">{props.job.schedule} · max {props.job.max_runtime_sec}s · {props.job.restart_policy}</p>
      <pre class="text-[11px] font-mono text-gray-400 mt-2 bg-gray-950/60 border border-gray-800/60 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all">{props.job.cmd}</pre>
    </div>
  );
}
