/**
 * RoleMemoryViewer — read-only viewer for the per-type agent memory
 * the daemon writes at `.meshkore/agents/_types/<type>/memory.md`
 * (py-1.7.0 REMEMBER-harvest path).
 *
 * The cockpit never edits this file — the daemon owns writes via
 * `REMEMBER:` line parsing in `chat.assistant.final`. Operators who
 * want to edit by hand are pointed at the path; the "copy path"
 * button puts the absolute path in the clipboard so they can open
 * it in their editor.
 *
 * Daemon read endpoint:
 *   GET /agents/types/<type>/memory  → 200 { content: "<markdown>" }
 *                                    → 404 if no file yet
 *                                    → 405 if daemon predates py-1.7.x
 *
 * If the daemon doesn't yet expose the endpoint (older deploys we
 * haven't upgraded), the viewer shows a graceful empty state and
 * still exposes "copy path" so the operator's workflow isn't blocked.
 */

import { createResource, Show, For } from 'solid-js';
import { Modal } from './Modal';
import { daemonStore } from '~/state/daemon';
import type { AgentType } from '~/state/chat';
import { agentTypeInfo } from '~/lib/agent-types';
import { log } from '~/lib/log';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  type: AgentType;
  rootPath: string | null;
}

interface MemoryEntry {
  date: string;
  fact: string;
}

function parseMemory(md: string): MemoryEntry[] {
  // Lines look like: "- YYYY-MM-DD · <fact>"
  const out: MemoryEntry[] = [];
  for (const raw of md.split('\n')) {
    const m = /^[-*]\s+(\d{4}-\d{2}-\d{2})\s+·\s+(.+?)\s*$/.exec(raw);
    if (m && m[1] && m[2]) out.push({ date: m[1], fact: m[2] });
  }
  return out;
}

export default function RoleMemoryViewer(props: Props) {
  const info = () => agentTypeInfo(props.type);
  const absPath = () =>
    props.rootPath
      ? `${props.rootPath}/.meshkore/agents/_types/${props.type}/memory.md`
      : `.meshkore/agents/_types/${props.type}/memory.md`;

  const [data] = createResource(
    () => (props.isOpen ? props.type : null),
    async (t) => {
      if (!t) return { available: false, content: '', entries: [] as MemoryEntry[] };
      const client = daemonStore.state.client;
      if (!client) return { available: false, content: '', entries: [] };
      const url = `${client.transport.httpBase}/agents/types/${encodeURIComponent(t)}/memory`;
      try {
        const r = await fetch(url, {
          headers: client.transport.token ? { authorization: `Bearer ${client.transport.token}` } : {},
        });
        if (r.status === 404) return { available: true, content: '', entries: [] };
        if (!r.ok) {
          log.debug('role memory endpoint missing', r.status);
          return { available: false, content: '', entries: [] };
        }
        const body = (await r.json()) as { content?: string };
        const content = body.content ?? '';
        return { available: true, content, entries: parseMemory(content) };
      } catch (e) {
        log.debug('role memory fetch failed', e);
        return { available: false, content: '', entries: [] };
      }
    },
  );

  const copyPath = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(absPath());
    } catch (e) {
      log.warn('clipboard write failed', e);
    }
  };

  return (
    <Modal isOpen={props.isOpen} onClose={() => props.onClose()} title={`Role memory · ${info().label}`}>
      <div class="space-y-3">
        <p class="text-[12px] text-gray-400 leading-relaxed">
          Facts past instances of this role have flagged with{' '}
          <code class="font-mono text-emerald-300 text-[11px]">REMEMBER: …</code>.
          The daemon writes this file; the cockpit reads it only.
        </p>

        <Show
          when={data()?.available && data()!.entries.length > 0}
          fallback={
            <Show
              when={data()?.available}
              fallback={
                <p class="text-[12px] text-amber-300/80 leading-relaxed">
                  This daemon doesn't expose <code class="font-mono">/agents/types/&lt;type&gt;/memory</code> yet.
                  Open the file in your editor with the path below.
                </p>
              }
            >
              <p class="text-[12px] text-gray-500 italic">
                No memory yet. Tell your agents what's worth remembering — end a reply with{' '}
                <code class="font-mono text-emerald-300 text-[11px]">REMEMBER: &lt;fact&gt;</code> and
                the daemon harvests it here.
              </p>
            </Show>
          }
        >
          <ul class="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            <For each={data()!.entries}>
              {(e) => (
                <li class="text-[12px] leading-snug flex gap-2 border-l-2 border-emerald-500/30 pl-2">
                  <span class="font-mono text-[10px] text-emerald-400/70 flex-shrink-0 mt-0.5">
                    {e.date}
                  </span>
                  <span class="text-gray-200">{e.fact}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <div class="flex items-center gap-2 pt-2 border-t border-gray-800/60">
          <code class="font-mono text-[10px] text-gray-500 truncate flex-1" title={absPath()}>
            {absPath()}
          </code>
          <button
            type="button"
            onClick={() => void copyPath()}
            class="px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] font-mono transition-colors"
          >
            copy path
          </button>
        </div>
      </div>
    </Modal>
  );
}
