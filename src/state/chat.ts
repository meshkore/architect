/**
 * state/chat.ts — reactive store for the chat layer.
 *
 * Holds: per-conversation message map, active conversation, agent
 * status (idle / thinking / working), archived conversations,
 * conversation metadata (agent type, model, title, location),
 * conversation title overrides, and the synthetic onboarding conv.
 *
 * Persistence:
 *   - `convMeta` (M2.4 V79r) — `mc-conv-meta-v1::<cluster_id>` JSON
 *     map. Restored when the active cluster changes; saved on every
 *     ensureConvMeta call. This is what survives reloads — the type
 *     of every service agent the operator created. The daemon
 *     pairs this with its own `conv_meta.json` sidecar (py-1.7.0)
 *     so chained turns keep their agent_type even if the cockpit
 *     forgets to re-send it.
 *
 * REMEMBER-line stripping:
 *   - The daemon strips REMEMBER lines server-side before broadcasting
 *     `chat.assistant.final`, but we belt-and-braces strip again on
 *     ingest so a stray line from a `delta` (before the final lands)
 *     never reaches the UI.
 */

import { createStore } from 'solid-js/store';
import { createSignal } from 'solid-js';
import type { DaemonEvent } from '~/lib/daemon-client';
import { log } from '~/lib/log';

export type AgentType = 'custom' | 'deploy' | 'db' | 'testing' | 'audit' | 'docs' | 'review';

export interface ConvMeta {
  agentId: string;
  model: string;
  type: AgentType;
  title: string;
  location: { type: 'local' | 'remote'; host?: string; provider?: string };
}

export type AgentStatusKind = 'idle' | 'thinking' | 'working';

export interface AgentStatus {
  state: AgentStatusKind;
  conv?: string;
  runId?: string;
  lastText?: string;
}

export interface ChatMsg {
  kind: 'user' | 'assistant';
  text: string;
  author?: string;
  ts?: string;
  streaming?: boolean;
  stream_id?: string;
  cancelled?: boolean;
}

export interface ChatStoreState {
  convMap: Record<string, ChatMsg[]>;
  activeConv: string | null;
  agentStatus: Record<string, AgentStatus>;
  archivedConvs: Record<string, true>;
  convMeta: Record<string, ConvMeta>;
  convTitleOverrides: Record<string, string>;
}

const initial: ChatStoreState = {
  convMap: {},
  activeConv: null,
  agentStatus: {},
  archivedConvs: {},
  convMeta: {},
  convTitleOverrides: {},
};

const [state, setState] = createStore<ChatStoreState>(initial);
const [activeClusterId, setActiveClusterId] = createSignal<string | null>(null);

// ── convMeta persistence (V79r) ─────────────────────────────────────

const CONV_META_KEY_PREFIX = 'mc-conv-meta-v1::';
function metaKey(): string {
  return CONV_META_KEY_PREFIX + (activeClusterId() ?? 'unknown');
}

function loadConvMeta(): void {
  try {
    const raw = localStorage.getItem(metaKey());
    if (!raw) {
      setState('convMeta', {});
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, ConvMeta> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (isConvMeta(v)) out[k] = v;
      }
      setState('convMeta', out);
    }
  } catch (e) {
    log.warn('convMeta load failed', e instanceof Error ? e.message : String(e));
  }
}

function isConvMeta(v: unknown): v is ConvMeta {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.agentId === 'string' && typeof r.type === 'string';
}

function saveConvMeta(): void {
  try {
    localStorage.setItem(metaKey(), JSON.stringify(state.convMeta));
  } catch {
    /* quota / private mode */
  }
}

// ── Public actions ──────────────────────────────────────────────────

function bindCluster(clusterId: string | null): void {
  setActiveClusterId(clusterId);
  loadConvMeta();
}

function nextAgentId(): string {
  const used = new Set(Object.values(state.convMeta).map((m) => m.agentId));
  for (let i = 1; i < 1000; i += 1) {
    const id = 'A' + String(i).padStart(3, '0');
    if (!used.has(id)) return id;
  }
  return 'A???';
}

function ensureConvMeta(convId: string, init: Partial<ConvMeta> = {}): ConvMeta {
  const existing = state.convMeta[convId];
  if (existing) return existing;
  const meta: ConvMeta = {
    agentId: init.agentId ?? nextAgentId(),
    model: init.model ?? 'auto',
    type: (init.type ?? 'custom') as AgentType,
    title: init.title ?? '',
    location: init.location ?? { type: 'local', host: 'this machine' },
  };
  setState('convMeta', convId, meta);
  saveConvMeta();
  return meta;
}

function setActiveConv(conv: string | null): void {
  setState('activeConv', conv);
}

function archiveConv(conv: string): void {
  setState('archivedConvs', conv, true);
}

function unarchiveConv(conv: string): void {
  setState('archivedConvs', (xs) => {
    const { [conv]: _drop, ...rest } = xs;
    return rest;
  });
}

function setAgentStatus(agentId: string, status: AgentStatus): void {
  setState('agentStatus', agentId, status);
}

function clearAgentStatus(agentId: string): void {
  setState('agentStatus', (xs) => {
    const { [agentId]: _drop, ...rest } = xs;
    return rest;
  });
}

function stripRememberLines(text: string): string {
  if (!text) return text;
  return text
    .split('\n')
    .filter((ln) => !/^\s*(?:[-*]\s+)?REMEMBER:\s/i.test(ln))
    .join('\n')
    .trimEnd();
}

/**
 * Ingest one daemon event into the chat store. Idempotent — same
 * stream_id replaces in place rather than appending duplicates.
 */
function ingestEvent(ev: DaemonEvent): void {
  const conv = typeof ev.conv === 'string' ? ev.conv : null;
  if (!conv) return;
  const arr = state.convMap[conv] ?? [];
  if (ev.type === 'chat.user') {
    const text = typeof ev.text === 'string' ? ev.text : '';
    setState('convMap', conv, [
      ...arr,
      {
        kind: 'user',
        text,
        author: typeof ev.author === 'string' ? ev.author : undefined,
        ts: typeof ev.ts === 'string' ? ev.ts : undefined,
      },
    ]);
    return;
  }
  if (ev.type === 'chat.assistant.delta') {
    const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : undefined;
    const text = typeof ev.text === 'string' ? ev.text : '';
    if (!streamId) return;
    // Find existing live bubble for this stream.
    const idx = arr.findIndex((m) => m.kind === 'assistant' && m.stream_id === streamId);
    const cleaned = stripRememberLines(text);
    if (idx >= 0) {
      setState('convMap', conv, idx, { text: cleaned, streaming: true });
    } else {
      setState('convMap', conv, [
        ...arr,
        {
          kind: 'assistant',
          text: cleaned,
          author: typeof ev.author === 'string' ? ev.author : undefined,
          ts: typeof ev.ts === 'string' ? ev.ts : undefined,
          streaming: true,
          stream_id: streamId,
        },
      ]);
    }
    return;
  }
  if (ev.type === 'chat.assistant.final') {
    const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : undefined;
    const text = typeof ev.text === 'string' ? ev.text : '';
    const cleaned = stripRememberLines(text);
    const idx = arr.findIndex(
      (m) => m.kind === 'assistant' && streamId !== undefined && m.stream_id === streamId,
    );
    if (idx >= 0) {
      setState('convMap', conv, idx, {
        text: cleaned,
        streaming: false,
      });
    } else {
      setState('convMap', conv, [
        ...arr,
        {
          kind: 'assistant',
          text: cleaned,
          author: typeof ev.author === 'string' ? ev.author : undefined,
          ts: typeof ev.ts === 'string' ? ev.ts : undefined,
          streaming: false,
          stream_id: streamId,
        },
      ]);
    }
    return;
  }
  if (ev.type === 'chat.cancelled') {
    const last = arr[arr.length - 1];
    if (last && last.kind === 'assistant' && last.streaming) {
      setState('convMap', conv, arr.length - 1, { streaming: false, cancelled: true });
    }
  }
}

export const chatStore = {
  state,
  bindCluster,
  ensureConvMeta,
  setActiveConv,
  archiveConv,
  unarchiveConv,
  setAgentStatus,
  clearAgentStatus,
  ingestEvent,
};

log.debug('state/chat loaded');
