import { For, Show } from 'solid-js';
import { serverStore, allModules } from '~/state/server';
import { Block, BtnRow, Btn } from './atoms';
import { CLUSTER_YAML, editYaml } from './yaml-shortcut';

export function ModulesBlock() {
  return (
    <Block title="Modules" subtitle="Declared in cluster.yaml.modules[].">
      <Show when={!serverStore.state.snapshot}><p class="text-[12px] text-gray-600">Loading…</p></Show>
      <Show when={serverStore.state.snapshot && allModules().length === 0}><p class="text-[12px] text-gray-600">No modules declared.</p></Show>
      <Show when={allModules().length > 0}>
        <ul class="space-y-1">
          <For each={allModules()}>{(m) => (
            <li class="flex items-center gap-3 py-1">
              <span class="font-mono text-[12px] text-gray-200 min-w-[10rem]">{m.id}</span>
              <span class="text-[12px] text-gray-400 flex-1 truncate">{m.name ?? m.id}</span>
              <span class="font-mono text-[11px] text-emerald-400/80">{m.kind ?? 'area'}</span>
            </li>
          )}</For>
        </ul>
      </Show>
      <BtnRow><Btn onClick={editYaml('Modules — edit cluster.yaml', `Rename or re-classify modules by editing ${CLUSTER_YAML}'s \`modules:\` list. Each entry has \`id\`, \`name\`, and \`kind\` (area / feature / service). The daemon picks up edits via its file-watcher.`)}>edit modules in cluster.yaml</Btn></BtnRow>
    </Block>
  );
}
