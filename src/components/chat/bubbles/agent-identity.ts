/**
 * Who is speaking in a bubble.
 *
 * The daemon emits assistant events authored by `self.identity` (the
 * host machine), which is the wrong thing to show: the assistant IS the
 * agent. Preference order is convMeta.title → the agentId chip → the
 * daemon's author → a neutral 'agent'. ('coordinator' as a fallback is
 * gone outside onboarding — it leaked into every untitled custom conv.)
 *
 * AX13 (cockpit-excellence): these take `conv` explicitly. They used to
 * read `chatStore.state.activeConv`, so a bubble could only ever render
 * the conversation currently on screen.
 */

import { chatStore, ONBOARDING_CONV_ID, type ChatMsg, type ConvMeta } from '~/state/chat';

function convMetaOf(conv: string | null | undefined): ConvMeta | null {
  return conv ? chatStore.state.convMeta[conv] ?? null : null;
}

export function convAgentId(conv: string | null | undefined): string | null {
  return convMetaOf(conv)?.agentId ?? null;
}

/** The byline for an agent bubble in `conv`. `msg` only contributes its
 *  author as a late fallback. */
export function convAgentName(conv: string | null | undefined, msg?: ChatMsg): string {
  const title = convMetaOf(conv)?.title?.trim();
  if (title) return title;
  if (conv === ONBOARDING_CONV_ID) return 'Architect Agent';
  const aid = convAgentId(conv);
  if (aid) return aid;
  const author = msg?.author?.trim();
  if (author && author !== 'architect' && author !== 'operator' && author !== 'user') return author;
  return 'agent';
}

/**
 * py-1.11.0-cockpit — authors the DAEMON uses when it synthesises a
 * `chat.user` event (today: `architect-wake`, which posts a subagent's
 * result preview into the parent architect's conv). This is agent↔agent
 * traffic surfaced for information; rendering it on the operator's side
 * read as "the operator said this", a lie. Such messages are mirrored to
 * the agent side while keeping the verbatim author label.
 */
const SYSTEM_USER_AUTHORS = new Set<string>(['architect-wake']);

export function isSystemAuthored(msg: ChatMsg): boolean {
  const a = msg.author?.trim();
  return !!a && SYSTEM_USER_AUTHORS.has(a);
}
