/**
 * TaskDetail — the archived per-task detail = the execution registry.
 *
 * Each archived task is the canonical record of what was done: its
 * execution summary (`## Resolution`, Standard v26) and the
 * files/scripts that were modified. This is the source the diary is
 * generated from, so it deliberately drops the in-flight noise (live
 * output, spinners) and keeps the durable facts.
 *
 * The body is fetched once at TaskRow level (RTR2) and threaded in, so
 * the always-visible summary line and this deep-expanded view share a
 * single read.
 */

import { For, Show, createMemo } from 'solid-js';
import type { ServerTask } from '~/state/server';
import { activeAgentByTask, convForTask } from '~/state/server';
import { chatStore } from '~/state/chat';
import type { ChatMsg } from '~/state/chat';
import { CollapsibleText } from '~/components/ui/CollapsibleText';
import { extractResolution, taskCommits, taskFiles } from '~/lib/task-md';
import { fullStamp } from '~/lib/format-time';

export function TaskDetail(props: { task: ServerTask; archived?: boolean; body: string }) {
  const conv = createMemo<string | undefined>(() => convForTask(props.task.id));

  // Fallback summary: the live conv's final message, for tasks resolved
  // before the daemon began persisting `## Resolution` (graceful).
  const convFinal = (): string => {
    const c = conv();
    const msgs = c ? (chatStore.state.convMap[c] ?? []) : [];
    const m = [...msgs].reverse().find((x: ChatMsg) => x.kind === 'assistant' && !x.streaming && !x.cancelled);
    return (m?.text ?? '').trim();
  };

  const resolution = (): string => extractResolution(props.body) || convFinal();
  const files = (): string[] => taskFiles(props.task as unknown as Record<string, unknown>);
  const commits = (): string[] => taskCommits(props.task as unknown as Record<string, unknown>);
  const completedStamp = (): string => fullStamp(String(props.task.completed_at ?? ''));
  const resolvedBy = (): string =>
    String(props.task.resolved_by ?? '') ||
    activeAgentByTask()[props.task.id] ||
    chatStore.state.convs[conv() ?? '']?.agent_id ||
    '—';

  return (
    <div class="rt-arch-detail" onClick={(e) => e.stopPropagation()}>
      {/* who/when — only meaningful for finished (archived) work */}
      <Show when={props.archived && (resolvedBy() !== '—' || completedStamp())}>
        <div class="rt-arch-meta">
          <span class="rt-task-agent">{resolvedBy()}</span>
          <Show when={completedStamp()}>
            <span class="rt-arch-stamp">· {completedStamp()}</span>
          </Show>
        </div>
      </Show>

      {/* RTR2 — description no longer repeated here; it's the default
       *  summary line under the title. Deep expand stays focused on the
       *  execution registry (agent, stamp, resolution, files). */}

      <Show when={props.archived && resolution()}>
        <div class="rt-arch-block">
          <span class="rt-arch-label">summary</span>
          <div class="rt-arch-body"><CollapsibleText text={resolution()} markdown /></div>
        </div>
      </Show>

      <Show when={props.archived && (files().length > 0 || commits().length > 0)}>
        <div class="rt-arch-block">
          <span class="rt-arch-label">{files().length > 0 ? 'files' : 'commits'}</span>
          <div class="rt-arch-files">
            <For each={files().length > 0 ? files() : commits()}>
              {(f) => <code class="rt-arch-file">{f}</code>}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default TaskDetail;
