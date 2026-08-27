/**
 * MemberPicker — ATM7. Which roster member's init prompt this instance
 * receives. Editable only while the conv is a DRAFT (no messages yet);
 * after the first dispatch the strip renders a read-only badge instead.
 *
 * Singletons that already have a live instance are not pickable, but the
 * currently-bound member is always listed so the select never shows a
 * value that isn't among its options.
 */

import { For, createMemo } from 'solid-js';
import { teamStore } from '~/state/team';
import type { TeamMember } from '~/lib/daemon-client';

export default function MemberPicker(props: { current: string; onPick: (id: string) => void }) {
  const options = createMemo<TeamMember[]>(() => {
    const list = teamStore.pickable();
    const cur = teamStore.get(props.current);
    if (cur && !list.some((m) => m.id === cur.id)) return [cur, ...list];
    return list;
  });
  return (
    <select
      value={props.current}
      onChange={(e) => props.onPick(e.currentTarget.value)}
      title="Member — the init prompt this instance receives (editable until the first message)"
      class="bg-gray-800/60 border border-gray-700/60 rounded px-1.5 py-0.5 text-[11px] text-gray-100 focus:outline-none focus:border-emerald-500/55 flex-shrink-0 max-w-[150px]"
    >
      <For each={options()}>
        {(m) => <option value={m.id}>{m.emoji} {m.name}</option>}
      </For>
    </select>
  );
}
