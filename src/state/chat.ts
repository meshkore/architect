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
import type { DaemonClient, DaemonEvent, DispatchBody } from '~/lib/daemon-client';
import { log } from '~/lib/log';

export const ONBOARDING_CONV_ID = '_onboarding_v1';

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
  _placeholder_user?: boolean;
  _placeholder?: boolean;
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

/**
 * Create an empty conversation with metadata and select it. Used by the
 * NewAgentWizard (M6.5). Slug mirrors V79's `newConvSlugFromScope`:
 * scope-encoded for custom agents, type+timestamp for services. Returns
 * the slug so the caller can focus the composer.
 */
function createConv(opts: {
  type: AgentType;
  title: string;
  model: string;
  scope?: { module?: string | null; taskId?: string | null };
}): string {
  const stamp = new Date().toISOString().slice(5, 16).replace(/[:T-]/g, '').toLowerCase();
  let slug: string;
  if (opts.type === 'custom') {
    const tid = opts.scope?.taskId?.trim();
    const mod = opts.scope?.module?.trim();
    if (tid) slug = `${(mod || 'general')}-${tid.toLowerCase()}-${stamp}`;
    else if (mod) slug = `${mod}-${stamp}`;
    else slug = `general-${stamp}`;
  } else {
    slug = `${opts.type}-${Date.now().toString(36).slice(-5)}`;
  }
  if (!state.convMap[slug]) setState('convMap', slug, []);
  ensureConvMeta(slug, { type: opts.type, title: opts.title, model: opts.model });
  setState('activeConv', slug);
  return slug;
}

function setConvTitle(conv: string, title: string): void {
  ensureConvMeta(conv);
  setState('convMeta', conv, 'title', title);
  saveConvMeta();
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
    const author = typeof ev.author === 'string' ? ev.author : undefined;
    // Replace any optimistic placeholder with the canonical echo so the
    // bubble isn't duplicated (timestamps differ between client + daemon).
    const phIdx = arr.findIndex(
      (m) => m.kind === 'user' && m._placeholder_user && m.text === text && (!author || m.author === author),
    );
    if (phIdx >= 0) {
      setState('convMap', conv, phIdx, {
        author,
        ts: typeof ev.ts === 'string' ? ev.ts : undefined,
        _placeholder_user: undefined,
      });
      return;
    }
    setState('convMap', conv, [
      ...arr,
      { kind: 'user', text, author, ts: typeof ev.ts === 'string' ? ev.ts : undefined },
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

export interface DispatchOpts {
  conv: string;
  text: string;
  author?: string;
  images?: Array<{ dataURL: string; mediaType: string }>;
  contextDocs?: Array<{ filename: string; content: string }>;
  scope?: { module?: string; taskId?: string; initiative?: string };
}

export type DispatchOutcome =
  | { ok: true; conv: string }
  | { ok: false; status: number; error?: string };

/**
 * Optimistically push a user bubble, POST /chat/dispatch, and reconcile.
 * The ChatComposer (M5.3) calls this. WS echoes replace the placeholder
 * in `ingestEvent`. On failure the placeholder is dropped so the user
 * can edit + resend.
 */
async function dispatchMessage(client: DaemonClient, opts: DispatchOpts): Promise<DispatchOutcome> {
  const { conv, text, author, images = [], contextDocs = [], scope = {} } = opts;
  const localTs = new Date().toISOString();
  const arr = state.convMap[conv] ?? [];
  setState('convMap', conv, [
    ...arr,
    { kind: 'user', text, author, ts: localTs, _placeholder_user: true },
  ]);
  const meta = state.convMeta[conv];
  const body: DispatchBody = { conv, text };
  if (author) body.author = author;
  if (meta?.type) body.agent_type = meta.type;
  if (meta?.agentId) body.agent_id = meta.agentId;
  if (scope.module) body.module_id = scope.module;
  if (scope.taskId) body.task_id = scope.taskId;
  if (scope.initiative) body.initiative_id = scope.initiative;
  if (images.length) {
    body.images = images.map((i) => ({
      type: 'image',
      media_type: i.mediaType,
      data: i.dataURL.includes(',') ? i.dataURL.split(',')[1] ?? '' : i.dataURL,
    }));
  }
  if (contextDocs.length) body.context_docs = contextDocs;
  const res = await client.chatDispatch(body);
  if (!res.ok) {
    const list = state.convMap[conv] ?? [];
    const idx = list.findIndex((m) => m._placeholder_user && m.ts === localTs);
    if (idx >= 0) {
      setState('convMap', conv, list.filter((_, i) => i !== idx));
    }
    log.warn('chat dispatch failed', res.status, res.body);
    return { ok: false, status: res.status, error: res.body };
  }
  if (!state.activeConv) setState('activeConv', res.data.conv ?? conv);
  return { ok: true, conv: res.data.conv ?? conv };
}

export const chatStore = {
  state,
  bindCluster,
  ensureConvMeta,
  createConv,
  setActiveConv,
  setConvTitle,
  archiveConv,
  unarchiveConv,
  setAgentStatus,
  clearAgentStatus,
  ingestEvent,
  dispatchMessage,
};

log.debug('state/chat loaded');
