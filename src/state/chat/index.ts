/**
 * state/chat — the chat layer's reactive store.
 *
 * Holds: per-conversation message map, active conversation, archived
 * conversations, conversation metadata (agent type, model, member,
 * title, location), the daemon-authoritative conv summaries, per-conv
 * queues and pagination cursors, and the synthetic onboarding conv.
 *
 * The package (AX12, cockpit-excellence) replaced a 1900-line module.
 * Module map:
 *
 *   types.ts          shapes + constants, imports nothing of ours
 *   store.ts          the private reactive core (state/setState)
 *   persistence.ts    the two localStorage keys + their migrations
 *   reducer.ts        the ONE decision table for chat.* events (pure)
 *   ingest.ts         active + cached sinks over the reducer, history replay
 *   cluster-slices.ts per-project state kept across a switch (AX3)
 *   conv-actions.ts   create / rename / retune / archive / select
 *   dispatch.ts       send a turn, roll back, humanize failures
 *   snapshot.ts       GET /chat/snapshot hydration
 *   conv-events.ts    WS conv.* + chat.usage
 *   queue.ts          WS queue.item.* + queue hydration
 *   paging.ts         the windowed history loader
 *
 * Pure text helpers (REMEMBER/anchor stripping, attachment parsing) live
 * in `~/lib/chat-sanitize`; the "is this conv working / which conv is the
 * architect" predicates in `~/lib/conv-state`.
 *
 * This file is a FACADE: the shape of `chatStore` is what ~40 importers
 * depend on. Add to it deliberately.
 */

import { log } from '~/lib/log';
import { state } from './store';
import { bindCluster, clearClusterChat, hasCachedChat } from './cluster-slices';
import { ingestEvent, ingestEventForCluster, loadConvMessagesPage } from './ingest';
import { loadEarlierMessages } from './paging';
import { dispatchMessage } from './dispatch';
import { hydrateFromSnapshot } from './snapshot';
import { ingestConvEvent } from './conv-events';
import { ingestQueueEvent, hydrateQueue } from './queue';
import {
  archiveConv,
  createConv,
  createStoryConv,
  ensureConvMeta,
  findActiveArchitectConv,
  onboardingHasUserMessages,
  seedOnboardingConv,
  setActiveConv,
  setConvEffort,
  setConvMember,
  setConvModel,
  setConvTitle,
  unarchiveConv,
} from './conv-actions';
import { AUTONOMOUS_AGENT_TYPES, type ChatMsg } from './types';

export { loadLastActiveConv } from './persistence';
export {
  ONBOARDING_CONV_ID,
  INITIAL_PAGE,
  PAGE,
  UI_MESSAGE_CAP,
  isFixedAgentConv,
  agentTypeFromSlug,
} from './types';
export type {
  AgentStatusKind,
  AgentType,
  ChatAttachment,
  ChatMsg,
  ChatPaging,
  ChatStoreState,
  ClusterActivity,
  ClusterChatSlice,
  ConvMeta,
  DispatchOpts,
  DispatchOutcome,
} from './types';

export const chatStore = {
  state,
  bindCluster,
  clearClusterChat,
  /** AX3 — does this project have paintable chat state in memory?
   *  The boot gate skips BootingPanel when it does. */
  hasCachedChat,
  ensureConvMeta,
  createConv,
  createStoryConv,
  setActiveConv,
  seedOnboardingConv,
  onboardingHasUserMessages,
  setConvTitle,
  setConvModel,
  setConvEffort,
  setConvMember,
  archiveConv,
  unarchiveConv,
  findActiveArchitectConv,
  ingestEvent,
  ingestEventForCluster,
  dispatchMessage,
  // py-1.11.0 — chat-state-rearchitecture (daemon-authoritative path).
  hydrateFromSnapshot,
  ingestConvEvent,
  loadConvMessagesPage,
  loadEarlierMessages,
  // V107.41 — chat-turn queue (Standard v16).
  ingestQueueEvent,
  hydrateQueue,
};

/**
 * Autonomous-agent chat mode (2026-06-20). Some agent types run as a
 * self-driving loop with NO operator turns between their outputs (today:
 * the roadmap-architect "Run all" executor). Their chat renders as ONE
 * continuous timeline under a single header — consecutive agent finals
 * stack as event rows, and only a real operator message breaks the run.
 * (ChatThread + chat-stream.groupAutonomous.)
 */
export function isAutonomousConv(conv: string | null | undefined): boolean {
  if (!conv) return false;
  if (conv.startsWith('roadmap-architect-')) return true;
  const t = state.convMeta[conv]?.type;
  return !!t && AUTONOMOUS_AGENT_TYPES.has(t);
}

/** Daemon-synthesised `chat.user` events that are agent↔agent plumbing,
 *  not operator speech. Hidden in an autonomous conv — the agent
 *  summarises the outcome itself in its own terse event line. */
export function isWakeAuthored(msg: ChatMsg): boolean {
  return msg.author?.trim() === 'architect-wake';
}

log.debug('state/chat loaded');
