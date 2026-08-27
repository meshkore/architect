/**
 * chat/bubbles — leaf renderers for the chat thread.
 *
 * AX13 (cockpit-excellence) split these out of a 1000-line
 * `ChatBubbles.tsx`. Every bubble now takes `conv` explicitly instead of
 * reading `chatStore.state.activeConv`, so a thread other than the one
 * on screen (history views, a second pane) can be rendered.
 *
 *   MessageBubble        dispatches on msg.kind
 *   UserBubble           operator turns (and mirrored daemon-authored ones)
 *   AssistantBubble      agent turns, incl. the validation renders
 *   SystemBubble         client-only in-band notices
 *   AutonomousRun        continuous timeline for self-driving agents
 *   PreparingBubble      dispatch accepted, first chunk pending
 *   ToolUse/TaskLifecycle structured daemon events
 */

import type { ChatMsg } from '~/state/chat';
import UserBubble from './UserBubble';
import SystemBubble from './SystemBubble';
import AssistantBubble from './AssistantBubble';

export function MessageBubble(props: { conv: string; msg: ChatMsg; prepend?: boolean }) {
  if (props.msg.kind === 'user') return <UserBubble msg={props.msg} prepend={props.prepend} />;
  if (props.msg.kind === 'system') return <SystemBubble msg={props.msg} />;
  return <AssistantBubble conv={props.conv} msg={props.msg} />;
}

export { UserBubble, SystemBubble, AssistantBubble };
export { default as BubbleHeader } from './BubbleHeader';
export { default as AttachmentGrid } from './AttachmentGrid';
export { default as AutonomousRun } from './AutonomousRun';
export { default as PreparingBubble } from './PreparingBubble';
export { ToolUseBubble, TaskLifecycleBubble } from './EventBubbles';
export { StreamingIdleHint, StreamingTail, ThinkingPlaceholder } from './streaming';
export { formatBubbleTs } from './format';
export { convAgentId, convAgentName, isSystemAuthored } from './agent-identity';
