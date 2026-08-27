/**
 * AssistantBubble — one agent turn.
 *
 * V86u: borderless. A bold byline (agent chip + name) plus a timestamp,
 * then rendered markdown — no surrounding card. Three special renders
 * layer on top of a finished (non-streaming, non-cancelled) message:
 *
 *   VALIDATION RED    → the interactive ValidationBlock replaces the body
 *   VALIDATION GREEN  → a badge, and the marker line is stripped
 *   halt violation    → a red banner with a one-click Reset, on architect
 *                       convs only, so the operator knows it is a bug
 *
 * `headerless` (AutonomousRun) drops the byline and shows only a small
 * timestamp gutter — the run renders ONE header for all its rows.
 */

import { Show } from 'solid-js';
import { chatStore, type ChatMsg } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { isArchitectConv } from '~/lib/conv-state';
import { CollapsibleText } from '~/components/ui/CollapsibleText';
import ValidationBlock, { isValidationRed, isValidationGreen, isHaltViolation } from '~/components/architect/ValidationBlock';
import ValidationGreenBadge, { stripGreenMarker } from '~/components/architect/ValidationGreenBadge';
import ArchitectViolationBanner from '~/components/architect/ArchitectViolationBanner';
import BubbleHeader from './BubbleHeader';
import { convAgentId, convAgentName } from './agent-identity';
import { formatBubbleTs } from './format';
import { StreamingIdleHint, StreamingTail, ThinkingPlaceholder } from './streaming';

/** V89.2 — cancel the turn running in `conv`. */
export function stopConv(conv: string): void {
  const client = daemonStore.state.client;
  if (!conv || !client) return;
  void client.chatCancel(conv);
}

export function AssistantBubble(props: { conv: string; msg: ChatMsg; headerless?: boolean }) {
  const settled = (): boolean => !props.msg.streaming && !props.msg.cancelled;
  const showsValidationRed = (): boolean => settled() && isValidationRed(props.msg.text);
  const showsValidationGreen = (): boolean => settled() && isValidationGreen(props.msg.text);
  const showsHaltViolation = (): boolean =>
    settled()
    && isArchitectConv(props.conv, chatStore.state.convMeta[props.conv]?.type)
    && isHaltViolation(props.msg.text);

  // Strip the GREEN marker so the markdown below doesn't show the
  // literal `═══ … ═══` rule.
  const bodyText = (): string =>
    showsValidationGreen() ? stripGreenMarker(props.msg.text) : props.msg.text;

  return (
    <div class="flex flex-col gap-1.5 items-start w-full">
      <Show
        when={!props.headerless}
        fallback={
          <Show when={props.msg.ts}>
            <span class="font-mono text-[10px] text-gray-600 pl-2 flex-shrink-0">
              <time dateTime={props.msg.ts}>{formatBubbleTs(props.msg.ts!)}</time>
              <Show when={props.msg.cancelled}>
                <span class="ml-2 text-red-400/80 uppercase tracking-wider">· cancelled</span>
              </Show>
            </span>
          </Show>
        }
      >
        <BubbleHeader
          primary={convAgentName(props.conv, props.msg)}
          id={convAgentId(props.conv) ?? undefined}
          ts={props.msg.ts}
          align="left"
          tone={props.msg.cancelled ? 'cancelled' : 'agent'}
          suffix={props.msg.cancelled ? 'cancelled' : undefined}
          onStop={props.msg.streaming && !props.msg.cancelled ? () => stopConv(props.conv) : undefined}
        />
      </Show>
      <Show when={showsValidationRed()} fallback={
        <>
          <Show when={showsHaltViolation()}>
            <ArchitectViolationBanner conv={props.conv} />
          </Show>
          <Show when={showsValidationGreen()}>
            <ValidationGreenBadge />
          </Show>
          <div class={`text-sm leading-relaxed max-w-[90%] pl-2 ${
            props.msg.cancelled ? 'text-red-300/95' : 'text-gray-200'
          }`}>
            <Show
              when={props.msg.streaming}
              fallback={
                <CollapsibleText text={bodyText()} markdown>
                  <Show when={props.msg.cancelled}>
                    <span class="text-red-400/80 text-[11px]"> · cancelled</span>
                  </Show>
                </CollapsibleText>
              }
            >
              {/* V86s — empty streaming → placeholder; populated →
                  the tail clamp showing the latest lines. */}
              <Show when={props.msg.text.trim().length > 0} fallback={<ThinkingPlaceholder />}>
                <StreamingTail text={props.msg.text} />
              </Show>
              <Show when={props.msg.streaming && props.msg.text.trim().length > 0}>
                <StreamingIdleHint conv={props.conv} />
              </Show>
            </Show>
          </div>
        </>
      }>
        <ValidationBlock conv={props.conv} text={props.msg.text} />
      </Show>
    </div>
  );
}

export default AssistantBubble;
