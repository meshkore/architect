/**
 * AutonomousRun (2026-06-20) — the continuous-timeline renderer for a
 * self-driving agent (the roadmap-architect "Run all" executor).
 *
 * A `run` is a sequence of consecutive agent finals with NO operator turn
 * between them. One byline header covers the whole run; each final is an
 * event row on a thin timeline rule. Only a real operator message breaks
 * the run (handled upstream in ChatThread), starting a fresh header. The
 * trailing live final tails the run and carries the Stop control on the
 * run header.
 */

import { For } from 'solid-js';
import type { ChatMsg } from '~/state/chat';
import BubbleHeader from './BubbleHeader';
import AssistantBubble, { stopConv } from './AssistantBubble';
import { convAgentId, convAgentName } from './agent-identity';

export function AutonomousRun(props: { conv: string; msgs: ChatMsg[] }) {
  const first = (): ChatMsg => props.msgs[0]!;
  const anyStreaming = (): boolean => props.msgs.some((m) => m.streaming && !m.cancelled);
  return (
    <div class="flex flex-col gap-2 w-full">
      <BubbleHeader
        primary={convAgentName(props.conv, first())}
        id={convAgentId(props.conv) ?? undefined}
        ts={first().ts}
        align="left"
        tone="agent"
        onStop={anyStreaming() ? () => stopConv(props.conv) : undefined}
      />
      <div class="flex flex-col gap-3 border-l border-emerald-500/15 ml-1.5 pl-2">
        <For each={props.msgs}>
          {(m) =>
            m.streaming
              ? <div data-live-bubble="1"><AssistantBubble conv={props.conv} msg={m} headerless /></div>
              : <AssistantBubble conv={props.conv} msg={m} headerless />
          }
        </For>
      </div>
    </div>
  );
}

export default AutonomousRun;
