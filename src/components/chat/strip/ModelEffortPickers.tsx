/**
 * ModelEffortPickers — ATM7. Model and effort stay editable for the
 * whole life of a conv: every turn is a fresh `claude -p`, so a change
 * applies from the NEXT message. Both are persisted to convMeta and sent
 * on the next dispatch.
 *
 * Precedence is daemon-authoritative-then-local: the value from
 * `chat.snapshot` wins on first paint; once the operator picks, convMeta
 * carries it forward.
 *
 * DM-CLI-08 (multi-cli-clients) — the catalogs follow the CLI this conv
 * actually runs on, not always claude-code's. The client itself is set
 * on the roster member, not per-turn, so it is read-only here.
 */

import { For, Show } from 'solid-js';
import { chatStore } from '~/state/chat';
import { clientsStore } from '~/state/clients';
import { MODEL_CATALOG, EFFORT_CATALOG } from '~/lib/models';

const SELECT_MODEL =
  'bg-purple-500/10 border border-purple-500/30 rounded px-1.5 py-0.5 text-[10px] font-mono '
  + 'text-purple-200 focus:outline-none focus:border-purple-400/60 max-w-[110px]';
const SELECT_EFFORT =
  'bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 text-[10px] font-mono '
  + 'text-amber-200/90 focus:outline-none focus:border-amber-400/60';

export default function ModelEffortPickers(props: {
  conv: string;
  model: string;
  effort: string;
  client: string;
}) {
  const isClaudeCode = (): boolean => props.client === 'claude-code';
  const catalog = () => clientsStore.catalogFor(props.client);
  return (
    <div class="flex items-center gap-1 flex-shrink-0">
      <Show
        when={isClaudeCode()}
        fallback={
          <select
            value={props.model}
            onChange={(e) => chatStore.setConvModel(props.conv, e.currentTarget.value)}
            title={`Model — applies from the next turn (${props.client})`}
            class={SELECT_MODEL}
          >
            <For each={catalog().models}>{(m) => <option value={m.id}>{m.label}</option>}</For>
          </select>
        }
      >
        <select
          value={props.model}
          onChange={(e) => chatStore.setConvModel(props.conv, e.currentTarget.value)}
          title="Model — applies from the next turn (daemon launches claude-code --model)"
          class={SELECT_MODEL}
        >
          <For each={['Latest (alias)', 'Pinned version', 'Auto'] as const}>{(grp) => (
            <optgroup label={grp}>
              <For each={MODEL_CATALOG.filter((m) => m.group === grp)}>
                {(m) => <option value={m.id}>{m.label}</option>}
              </For>
            </optgroup>
          )}</For>
        </select>
      </Show>
      <select
        value={props.effort}
        onChange={(e) => chatStore.setConvEffort(props.conv, e.currentTarget.value)}
        title="Effort (reasoning depth) — applies from the next turn"
        class={SELECT_EFFORT}
      >
        <For each={isClaudeCode() ? EFFORT_CATALOG : catalog().efforts}>
          {(e) => <option value={e.id}>{e.label}</option>}
        </For>
      </select>
    </div>
  );
}
