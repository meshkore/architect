/**
 * PreparingBubble — the gap between "dispatch accepted" and the first
 * assistant chunk.
 *
 * Renders exactly like a streaming AssistantBubble with empty text: same
 * byline, same shell, ThinkingPlaceholder in the body, so the hand-off to
 * the real bubble is seamless — the bubble keeps its position and just
 * swaps placeholder for tail.
 */

import { chatStore, ONBOARDING_CONV_ID } from '~/state/chat';
import BubbleHeader from './BubbleHeader';
import { stopConv } from './AssistantBubble';
import { ThinkingPlaceholder } from './streaming';

export function PreparingBubble(props: { conv: string; dispatchedAt: number }) {
  const meta = () => chatStore.state.convMeta[props.conv];
  // V89.1 — same fallback rules as AssistantBubble: 'Architect Agent'
  // ONLY for the onboarding conv. An untitled custom conv falls back to
  // its agentId chip, never to another agent's name.
  const primary = (): string => {
    const title = meta()?.title?.trim();
    if (title) return title;
    if (props.conv === ONBOARDING_CONV_ID) return 'Architect Agent';
    return meta()?.agentId || 'agent';
  };
  return (
    <div class="flex flex-col gap-1.5 items-start w-full">
      <BubbleHeader
        primary={primary()}
        id={meta()?.agentId ?? undefined}
        ts={undefined}
        align="left"
        tone="agent"
        onStop={() => stopConv(props.conv)}
      />
      <div class="max-w-[90%] text-sm leading-relaxed pl-2">
        <ThinkingPlaceholder />
      </div>
    </div>
  );
}

export default PreparingBubble;
