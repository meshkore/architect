/**
 * state/chat/dispatch.ts — send a turn.
 *
 * Optimistically pushes a user bubble, POSTs `/chat/dispatch`, and
 * reconciles: the WS echo replaces the placeholder in the ingest
 * reducer, a failure removes it so the operator can edit and resend,
 * and every non-transport failure also lands as a `system` bubble IN
 * THE THREAD (2026-06-10 operator request — errors belong where the
 * operator is looking, not in the console).
 */

import type { DaemonClient, DispatchBody } from '~/lib/daemon-client';
import { log } from '~/lib/log';
import { state, setState, activeClusterId, clearPendingReply } from './store';
import { agentTypeFromSlug, type ChatMsg, type DispatchOpts, type DispatchOutcome } from './types';

/** What was actually on the wire, for the console breadcrumb and the
 *  in-thread error bubble. Image payloads are never echoed. */
interface DispatchShape {
  conv: string;
  text_len: number;
  text_preview: string;
  images: number;
  context_docs: number;
  agent_type: string | null;
  initiative_id: string | null;
  task_id: string | null;
}

function buildBody(opts: Required<Pick<DispatchOpts, 'conv' | 'text'>> & DispatchOpts): DispatchBody {
  const { conv, text, author, images = [], contextDocs = [], scope = {} } = opts;
  const meta = state.convMeta[conv];
  const body: DispatchBody = { conv, text };
  if (author) body.author = author;
  // V107.8 — the slug-implied agent_type wins. `roadmap-architect-XXXXX`
  // is unforgeable; convMeta from a pre-AgentType-union build, or a race
  // against ensureConvMeta, must not be able to downgrade it.
  const finalType = agentTypeFromSlug(conv) ?? meta?.type;
  if (finalType) body.agent_type = finalType;
  if (meta?.agentId) body.agent_id = meta.agentId;
  // agent-team (ATM10) — bind the turn to the conv's roster member so the
  // daemon loads that member's init prompt + refs. model/effort below
  // still override the member's defaults.
  if (meta?.member) body.member = meta.member;
  // MP2/MP3 — 'auto' / 'default' are omitted so older daemons that don't
  // understand the fields aren't confused, and the CLI keeps its default.
  if (meta?.model && meta.model !== 'auto') body.model = meta.model;
  if (meta?.effort && meta.effort !== 'default') body.effort = meta.effort;
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
  return body;
}

/**
 * Turn an HTTP failure into a sentence the operator can act on.
 *
 * `status === 0` is deliberately NOT handled here: a transport failure
 * is the central OfflinePanel's job, and surfacing it twice reads as two
 * separate problems.
 */
function humanizeError(status: number, rawBody: string, shape: DispatchShape): string {
  let humanMsg = '';
  try {
    const parsed = JSON.parse(rawBody) as { error?: string };
    if (parsed && typeof parsed.error === 'string') humanMsg = parsed.error;
  } catch {
    humanMsg = rawBody;
  }
  const verb = status === 401
    ? 'Unauthorized — token rejected. Re-unlock and retry.'
    : status === 413
    ? 'Payload too large — attachment exceeds the daemon limit.'
    : status >= 500
    ? 'Daemon error — the request reached the daemon but it failed mid-handling.'
    : 'Dispatch refused';
  const detail = humanMsg && humanMsg !== verb ? ` (${humanMsg})` : '';
  // The wire shape is appended so the operator can compare it against
  // what they thought they sent — for "empty dispatch" it exposes the
  // bug directly (text_len=0 + images=0 + docs=0).
  const shapeDetail = ` · sent text:${shape.text_len}ch images:${shape.images} docs:${shape.context_docs}`;
  return `${verb}${detail}${shapeDetail}`;
}

/** Push a system bubble unless the identical one landed <2 s ago — the
 *  cockpit's retry/route-on-401 logic can fire the same 400 twice. */
function pushSystemError(conv: string, text: string): void {
  const list = state.convMap[conv] ?? [];
  const last = list[list.length - 1];
  const lastTs = last?.ts ? Date.parse(last.ts) : 0;
  const isDuplicate =
    last?.kind === 'system' &&
    last?.system_kind === 'error' &&
    last?.text === text &&
    Date.now() - lastTs < 2000;
  if (isDuplicate) return;
  const bubble: ChatMsg = {
    kind: 'system',
    system_kind: 'error',
    text,
    ts: new Date().toISOString(),
  };
  setState('convMap', conv, [...list, bubble]);
}

export async function dispatchMessage(
  client: DaemonClient,
  opts: DispatchOpts,
): Promise<DispatchOutcome> {
  const { conv, text, author } = opts;
  const localTs = new Date().toISOString();
  setState('convMap', conv, [
    ...(state.convMap[conv] ?? []),
    { kind: 'user', text, author, ts: localTs, _placeholder_user: true },
  ]);

  const body = buildBody(opts);
  const shape: DispatchShape = {
    conv,
    text_len: (body.text ?? '').length,
    text_preview: (body.text ?? '').slice(0, 60),
    images: (body.images ?? []).length,
    context_docs: (body.context_docs ?? []).length,
    agent_type: body.agent_type ?? null,
    initiative_id: body.initiative_id ?? null,
    task_id: body.task_id ?? null,
  };
  log.info('chat dispatch →', shape);
  // V89.1 — mark pending BEFORE the round-trip. The daemon sometimes
  // emits the first delta (or the whole final, for fast prompts) before
  // this fetch resolves; setting the flag afterwards left the bubble
  // stuck on "preparing…" for a turn that had already finished.
  setState('pendingReplyConvs', conv, Date.now());
  // A-CHAT-GUARD-01 (V110) — capture which project this send belongs to.
  const atCluster = activeClusterId();

  const res = await client.chatDispatch(body);
  if (!res.ok) {
    // The rollback and the in-thread error must NOT land in a different
    // project's slice: conv ids are shared across clusters.
    if (activeClusterId() !== atCluster) {
      log.debug('[swap-guard] dropping stale dispatch rollback', { conv, from: atCluster });
      return { ok: false, status: res.status, error: 'cluster switched mid-dispatch' };
    }
    const list = state.convMap[conv] ?? [];
    const idx = list.findIndex((m) => m._placeholder_user && m.ts === localTs);
    if (idx >= 0) setState('convMap', conv, list.filter((_, i) => i !== idx));
    clearPendingReply(conv);
    log.warn('chat dispatch failed', res.status, res.body, 'sent:', shape);
    if (res.status !== 0) {
      pushSystemError(conv, humanizeError(res.status, (res.body || '').toString(), shape));
    }
    return { ok: false, status: res.status, error: res.body };
  }

  if (!state.activeConv) setState('activeConv', res.data.conv ?? conv);
  // If the daemon picked a different conv id (rare — happens when the
  // body carried conv=null), migrate the pending flag.
  const finalConv = res.data.conv ?? conv;
  if (finalConv !== conv) {
    clearPendingReply(conv);
    setState('pendingReplyConvs', finalConv, Date.now());
  }
  return { ok: true, conv: finalConv };
}
