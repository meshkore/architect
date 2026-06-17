/**
 * ReviveList — second wizard step when the operator picks a previously-
 * known stopped project. Each row shows the cluster name, port and last-
 * seen timestamp. Clicking a row shows a paste-ready start command for
 * that project; the rail picks it up live as soon as the daemon boots.
 */
import { For, Show, createSignal } from 'solid-js';
import type { KnownProject } from '~/lib/known-projects';
import { reviveCommand } from '~/lib/start-command';
import WizardStep from './WizardStep';

export default function ReviveList(props: { stopped: KnownProject[] }) {
  const [picked, setPicked] = createSignal<KnownProject | null>(null);

  const cmd = (p: KnownProject): string => reviveCommand(p);

  return (
    <WizardStep title="Pick the project to revive" subtitle="Click one to see the exact start command.">
      <For each={props.stopped}>
        {(s) => {
          const name = s.cluster_name || s.cluster_id || `:${s.port}`;
          const lastSeen = s.last_seen ? new Date(s.last_seen).toLocaleString() : '—';
          return (
            <button
              type="button"
              onClick={() => setPicked(s)}
              class="flex items-center gap-2.5 w-full bg-[rgba(11,18,32,0.6)] border border-gray-700/35 rounded-lg px-3.5 py-3 text-left transition hover:bg-[rgba(11,18,32,0.95)] hover:border-blue-400/45"
            >
              <div class="flex-1 min-w-0">
                <div class="text-[13.5px] font-semibold text-gray-200">{name}</div>
                <div class="text-[11px] text-gray-500 mt-0.5">
                  last seen {lastSeen} · <span class="font-mono text-blue-300">:{s.port}</span>
                  {s.repo_path ? <> · <span class="font-mono">{s.repo_path}</span></> : null}
                </div>
              </div>
              <span class="text-gray-500 text-lg flex-shrink-0">→</span>
            </button>
          );
        }}
      </For>
      <Show when={picked()}>
        <pre class="bg-[#020617] border border-emerald-500/35 rounded-lg p-3 font-mono text-[11.5px] text-emerald-200 whitespace-pre-wrap break-words">{cmd(picked()!)}</pre>
        <p class="text-[11.5px] text-gray-500 leading-relaxed">
          Paste that in a terminal at the project root. The rail picks it up automatically.
        </p>
      </Show>
    </WizardStep>
  );
}
