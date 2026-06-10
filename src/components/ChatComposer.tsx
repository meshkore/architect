/**
 * ChatComposer — V80 input row (M5.3).
 *
 * Textarea + attach + send. Auto-grows on input, Cmd/Ctrl+Enter or
 * Enter (no-shift) sends. Drag-drop and paste-image targets. Fires
 * `chatStore.dispatchMessage` which handles optimistic push + POST.
 *
 * On 401: draft is preserved and `onTokenRejected` fires so the host
 * page can pop the M6.2 unlock modal. On `daemonStore.outdated`: send
 * is refused and `onDaemonOutdated` fires so V47 can take over.
 *
 * Behaviour is parity with the V80 monolith; everything outside the
 * input row (Stop button, scope strip) is the parent's concern.
 */

import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { chatStore, ONBOARDING_CONV_ID } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { isProjectEmpty } from '~/state/server';
import { onboardingBootstrapBrief } from '~/lib/onboarding-brief';
import { isValidationRed } from '~/components/architect/ValidationBlock';
import { debugEmit } from '~/lib/debug-transport';
import { log } from '~/lib/log';
import type { ChatQueueItem } from '~/lib/daemon-client';

const ACCEPT = 'image/*,.md,.txt,.pdf,.json,.yaml,.yml,.csv,.log';
const MAX_IMAGES = 6;

type PendingImg = { dataURL: string; mediaType: string };
type PendingDoc = { filename: string; content: string };

// V107.31 — Per-conv composer drafts. The ChatComposer is mounted once
// inside ChatPanel and re-used across conv switches (Solid doesn't
// remount on prop-only changes), so a single in-place draft signal
// would leak between chats. This module-level map snapshots draft +
// attachments by conv slug; the createEffect below saves the outgoing
// conv's state on switch and restores (or empty-inits) the incoming
// one. Session-only on purpose — text drafts of "next message" are
// short-lived; persisting across page reload would risk stale prompts
// landing in unrelated conversations.
interface ComposerSnap { draft: string; imgs: PendingImg[]; docs: PendingDoc[] }
const composerByConv = new Map<string, ComposerSnap>();
function readSnap(conv: string): ComposerSnap {
  return composerByConv.get(conv) ?? { draft: '', imgs: [], docs: [] };
}

// V83 — drop the `client` prop. Read the current DaemonClient reactively
// from daemonStore so dispatching follows project hot-swaps without the
// parent having to feed a fresh client down.
// V107.41 — Standard v16 chat-turn queue. Hydrate-once-per-conv cache so
// the composer only round-trips when it first focuses a conv. Subsequent
// WS `queue.*` events keep the store fresh.
const queueHydrated = new Set<string>();

export default function ChatComposer(props: {
  conv: string;
  placeholder?: string;
  onTokenRejected?: (draft: string) => void;
  onDaemonOutdated?: () => void;
}) {
  // V107.31 — Seed from this conv's snapshot on first mount so a
  // returning operator sees their draft immediately, not a flash of
  // empty before the effect below restores it.
  const initial = readSnap(props.conv);
  const [draft, setDraft] = createSignal(initial.draft);
  const [sending, setSending] = createSignal(false);
  const [imgs, setImgs] = createSignal<PendingImg[]>(initial.imgs);
  const [docs, setDocs] = createSignal<PendingDoc[]>(initial.docs);
  let fileEl: HTMLInputElement | undefined;
  let taEl: HTMLTextAreaElement | undefined;
  // Track which conv the signals currently represent so the createEffect
  // can stash the OUTGOING conv's state under the OLD key before
  // loading the new one (props.conv has already advanced when the
  // effect fires).
  let currentConv = props.conv;

  const grow = () => {
    if (!taEl) return;
    taEl.style.height = 'auto';
    taEl.style.height = Math.min(taEl.scrollHeight, 180) + 'px';
  };

  // V107.31 — On conv switch: snapshot outgoing → restore incoming.
  // `currentConv` is the slug whose draft is in the signals right now;
  // props.conv is the new slug we're moving to.
  createEffect(() => {
    const next = props.conv;
    if (next === currentConv) return;
    // Stash outgoing — only persist if non-empty so the map stays small.
    const out: ComposerSnap = { draft: draft(), imgs: imgs(), docs: docs() };
    if (out.draft || out.imgs.length || out.docs.length) {
      composerByConv.set(currentConv, out);
    } else {
      composerByConv.delete(currentConv);
    }
    // Load incoming — empty defaults if no snapshot.
    const snap = readSnap(next);
    setDraft(snap.draft);
    setImgs(snap.imgs);
    setDocs(snap.docs);
    currentConv = next;
    // Resize textarea after the value swap lands.
    queueMicrotask(grow);
  });

  // Save in-flight draft when the panel unmounts (e.g. cluster swap).
  onCleanup(() => {
    const out: ComposerSnap = { draft: draft(), imgs: imgs(), docs: docs() };
    if (out.draft || out.imgs.length || out.docs.length) {
      composerByConv.set(currentConv, out);
    }
  });

  // V107.41 — Hydrate queue on first focus per conv (lazy fetch).
  createEffect(() => {
    const conv = props.conv;
    if (queueHydrated.has(conv)) return;
    const c = daemonStore.state.client;
    if (!c) return;
    queueHydrated.add(conv);
    void chatStore.hydrateQueue(c, conv);
  });

  // Derived queue + working flags for the active conv.
  const queueItems = createMemo<ChatQueueItem[]>(
    () => chatStore.state.queues[props.conv] ?? [],
  );
  const isConvWorking = createMemo<boolean>(() => {
    const s = chatStore.state.convs[props.conv];
    return !!(s && (s.live || s.coordinating));
  });
  // The queue-button appears only when the conv is busy — otherwise
  // the operator can just send normally with play (per the operator's
  // brief: "el reloj sólo aparece cuando ya tenemos el chat en marcha").
  // Plus: while queued items already exist, keep the button visible
  // even after the conv goes idle briefly between turns, so the operator
  // can append to a still-flushing queue.
  const showQueueBtn = createMemo<boolean>(
    () => isConvWorking() || queueItems().length > 0,
  );

  // Enqueue: appends the operator's text to a SINGLE queued item per
  // conv. If a queued head already exists, the text is concatenated
  // into it (with a `\n\n` separator) — operator field report
  // 2026-06-10: "Only enqueue there 1 message, so i can be writting
  // as much as I want while waiting." If no queued item exists yet,
  // we create one.
  const enqueue = async (): Promise<void> => {
    const text = draft().trim();
    if (sending() || !text) return;
    const cli = daemonStore.state.client;
    if (!cli) return;
    setSending(true);
    setDraft(''); setImgs([]); setDocs([]); grow();
    const head = queueItems()[0];
    let res;
    if (head) {
      const merged = `${head.text}\n\n${text}`;
      res = await cli.queueEdit(props.conv, head.id, merged);
    } else {
      res = await cli.queueEnqueue(props.conv, text);
    }
    setSending(false);
    if (!res.ok) {
      // Restore the draft on failure so the operator doesn't lose it.
      setDraft(text); grow();
      log.warn('queue enqueue failed', { status: res.status });
      if (res.status === 401) props.onTokenRejected?.(text);
    } else {
      taEl?.focus();
      // The daemon broadcasts queue.item.added/updated; ingest lands
      // the change in the store. No optimistic insert needed.
    }
  };
  const editQueued = async (id: string, text: string): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c || !text.trim()) return;
    const res = await c.queueEdit(props.conv, id, text);
    if (!res.ok) log.warn('queue edit failed', { id, status: res.status });
  };
  const deleteQueued = async (id: string): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c) return;
    const res = await c.queueDelete(props.conv, id);
    if (!res.ok) log.warn('queue delete failed', { id, status: res.status });
  };
  const moveQueued = async (id: string, position: number): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c) return;
    const res = await c.queueMove(props.conv, id, position);
    if (!res.ok) log.warn('queue move failed', { id, status: res.status });
  };

  const addFile = (file: File) => {
    if ((file.type || '').startsWith('image/')) {
      if (imgs().length >= MAX_IMAGES) return;
      const r = new FileReader();
      r.onload = (e) => setImgs((xs) => [...xs, { dataURL: String(e.target?.result ?? ''), mediaType: file.type }]);
      r.readAsDataURL(file);
    } else {
      const r = new FileReader();
      r.onload = (e) => setDocs((xs) => [...xs, { filename: file.name, content: String(e.target?.result ?? '') }]);
      r.readAsText(file);
    }
  };

  const send = async () => {
    const text = draft().trim();
    if (sending() || (!text && imgs().length === 0 && docs().length === 0)) return;
    if (daemonStore.state.outdated) { props.onDaemonOutdated?.(); return; }
    const cli = daemonStore.state.client;
    if (!cli) return;
    // Operator field report 2026-06-10: when the conv is busy, Enter
    // should ROUTE to enqueue() (which merges into the head item) so
    // the operator gets a single accumulating queue entry instead of
    // N separate "QUEUED" bubbles. Image / doc attachments still go
    // through dispatch (queue is text-only per Standard v16); if the
    // operator attached files while busy, we fall through to the
    // normal dispatch path which the daemon auto-queues.
    if (isConvWorking() && imgs().length === 0 && docs().length === 0) {
      await enqueue();
      return;
    }
    setSending(true);
    const sentImgs = imgs();
    const sentDocs = docs();
    const contextDocs = [...sentDocs];
    if (
      props.conv === ONBOARDING_CONV_ID &&
      isProjectEmpty() &&
      !chatStore.onboardingHasUserMessages()
    ) {
      contextDocs.unshift({ filename: 'meshkore_coordinator_bootstrap.md', content: onboardingBootstrapBrief() });
    }
    // V50 — debug-stream marker. If the last assistant message is a
    // VALIDATION RED block, classify what the operator just submitted
    // (proceed / rework / free-form) so /debug/tail shows how the
    // validation gate was answered.
    const msgsForConv = chatStore.state.convMap[props.conv] ?? [];
    for (let i = msgsForConv.length - 1; i >= 0; i--) {
      const m = msgsForConv[i];
      if (!m || m.kind !== 'assistant') continue;
      if (isValidationRed(m.text ?? '')) {
        const lower = text.toLowerCase();
        const action = lower === 'proceed' ? 'proceed' : lower === 'rework' ? 'rework' : 'free-form';
        debugEmit('ux.validation', `Validation RED answered: ${action}`, {
          conv: props.conv,
          data: { action, chars: text.length },
        });
      }
      break;
    }
    setDraft(''); setImgs([]); setDocs([]); grow();
    const res = await chatStore.dispatchMessage(cli, {
      conv: props.conv, text, author: 'architect', images: sentImgs, contextDocs,
    });
    setSending(false);
    if (!res.ok) {
      setDraft(text); setImgs(sentImgs); setDocs(sentDocs); grow();
      if (res.status === 401) props.onTokenRejected?.(text);
    } else {
      taEl?.focus();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault(); void send();
  };

  const onPaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items; if (!items) return;
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i]!;
      if (it.kind === 'file') { const f = it.getAsFile(); if (f) { e.preventDefault(); addFile(f); } }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const fs = e.dataTransfer?.files; if (!fs) return;
    for (let i = 0; i < fs.length; i += 1) addFile(fs[i]!);
  };

  return (
    <div class="flex flex-col gap-1.5 p-3 border-t border-gray-800/60"
      onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <Show when={imgs().length || docs().length}>
        <div class="flex flex-wrap gap-1.5">
          <For each={imgs()}>{(img, i) => (
            <div class="relative w-12 h-12 rounded border border-gray-800 overflow-hidden">
              <img src={img.dataURL} class="w-full h-full object-cover" />
              <button type="button" class="absolute top-0 right-0 w-4 h-4 bg-gray-950/80 text-gray-300 text-[10px] leading-none"
                onClick={() => setImgs((xs) => xs.filter((_, j) => j !== i()))}>✕</button>
            </div>
          )}</For>
          <For each={docs()}>{(d, i) => (
            <div class="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-900 border border-gray-800 text-[11px] text-gray-300">
              <span class="font-mono truncate max-w-[160px]">📄 {d.filename}</span>
              <button type="button" class="text-gray-500 hover:text-red-300"
                onClick={() => setDocs((xs) => xs.filter((_, j) => j !== i()))}>✕</button>
            </div>
          )}</For>
        </div>
      </Show>
      {/* V107.41 — Queued turns (Standard v16). Renders above the input
          when there are items waiting. Max 30vh, scrolls overflow.
          Each row: drag handle (left) + editable text + ✕ delete. */}
      <Show when={queueItems().length > 0}>
        <QueuePanel
          items={queueItems()}
          onEdit={(id, text) => void editQueued(id, text)}
          onDelete={(id) => void deleteQueued(id)}
          onMove={(id, position) => void moveQueued(id, position)}
        />
      </Show>
      {/* V86n — Recovered the textarea width: send + attach are now
          chrome-less icon buttons stacked vertically to the right.
          Send is a filled triangle on top (primary action, draws the
          eye), attach is the paperclip below. Both inherit the
          textarea's vertical bounds so they sit flush with its
          rounded corners. Textarea border lifted from gray-800 → 600
          so the operator can actually see where the box ends. */}
      <div class="flex gap-2 items-stretch">
        <textarea
          ref={taEl} value={draft()} rows="2" disabled={sending()}
          placeholder={props.placeholder ?? 'Reply…'}
          onInput={(e) => { setDraft(e.currentTarget.value); grow(); }}
          onKeyDown={onKey} onPaste={onPaste}
          class="flex-1 bg-gray-950 border border-gray-600/70 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500/70 disabled:opacity-60 resize-none"
        />
        <input ref={fileEl} type="file" multiple accept={ACCEPT} class="hidden"
          onChange={(e) => { const fs = e.currentTarget.files; if (fs) for (let i = 0; i < fs.length; i += 1) addFile(fs[i]!); e.currentTarget.value = ''; }} />
        {/* V107.41 — Three-button stack: send (top), queue (middle,
            only when the conv is busy), attach (bottom). Tightened
            vertical spacing so the trio fits inside the textarea
            bounds without overflowing — `gap-1` distributes the
            three icons evenly. */}
        <div class="flex flex-col flex-shrink-0 py-0.5 gap-1">
          <button type="button" title="Send (Cmd/Ctrl+Enter)" onClick={() => void send()}
            disabled={sending() || (!draft().trim() && imgs().length === 0 && docs().length === 0)}
            class="inline-flex items-center justify-center w-8 h-8 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent">
            <Show
              when={!sending()}
              fallback={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="animate-spin">
                  <path d="M21 12a9 9 0 11-6.219-8.56" stroke-linecap="round" />
                </svg>
              }
            >
              {/* Filled right-pointing triangle — send. */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 4l16 8-16 8V4z" />
              </svg>
            </Show>
          </button>
          {/* V107.41 — Queue button. Only shown when the conv is
              actively working (live or coordinating) OR there are
              already queued items waiting. Same content-validation
              as send, but POSTs to the queue endpoint instead of
              dispatch. Standard v16. */}
          <Show when={showQueueBtn()}>
            <button type="button" title="Queue for after current turn" onClick={() => void enqueue()}
              disabled={sending() || !draft().trim()}
              class="inline-flex items-center justify-center w-8 h-8 rounded text-sky-300 hover:text-sky-200 hover:bg-sky-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent">
              {/* Clock icon. */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </button>
          </Show>
          <button type="button" title="Attach images or docs" onClick={() => fileEl?.click()}
            class="inline-flex items-center justify-center w-8 h-8 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800/60 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * V107.41 — Queue panel rendered above the composer when there are
 * items waiting. Each row: drag handle (≡), text (click to edit), ✕.
 * max-h: 30vh, scroll on overflow. Native HTML5 drag/drop for reorder.
 *
 * The daemon is the source of truth — every action POSTs and we let
 * the WS event update the store, so the panel "follows" the server.
 * Optimistic UI would require a rollback layer we don't need yet.
 */
function QueuePanel(props: {
  items: ChatQueueItem[];
  onEdit: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, position: number) => void;
}) {
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal('');
  const [dragId, setDragId] = createSignal<string | null>(null);

  const beginEdit = (it: ChatQueueItem): void => {
    setEditingId(it.id);
    setEditValue(it.text);
  };
  const commitEdit = (): void => {
    const id = editingId();
    if (!id) return;
    const next = editValue().trim();
    setEditingId(null);
    if (next && next !== props.items.find((it) => it.id === id)?.text) {
      props.onEdit(id, next);
    }
  };
  const cancelEdit = (): void => { setEditingId(null); };

  const onDragStart = (e: DragEvent, id: string): void => {
    setDragId(id);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  };
  const onDragOver = (e: DragEvent): void => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (targetIdx: number): void => {
    const src = dragId();
    setDragId(null);
    if (!src) return;
    const srcIdx = props.items.findIndex((it) => it.id === src);
    if (srcIdx < 0 || srcIdx === targetIdx) return;
    // Daemon move endpoint expects the FINAL position index.
    props.onMove(src, targetIdx);
  };

  return (
    <div
      class="border border-gray-800/70 bg-gray-950/40 rounded-md overflow-y-auto"
      style={{ 'max-height': '30vh' }}
    >
      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/60 text-[10px] font-mono uppercase tracking-wider text-sky-300/80">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" stroke-linecap="round" />
        </svg>
        Queue · {props.items.length} waiting
        <span class="text-gray-500 normal-case tracking-normal font-sans">— runs after the current turn</span>
      </div>
      <ul class="divide-y divide-gray-800/40">
        <For each={props.items}>
          {(it, i) => (
            <li
              class={`group flex items-start gap-2 px-2 py-1.5 text-[12.5px] ${dragId() === it.id ? 'opacity-50' : ''}`}
              draggable={editingId() !== it.id}
              onDragStart={(e) => onDragStart(e, it.id)}
              onDragOver={onDragOver}
              onDrop={() => onDrop(i())}
            >
              {/* Drag handle — the operator's grab affordance. */}
              <span
                class="select-none flex-shrink-0 mt-0.5 cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-300 font-mono leading-none text-[12px] px-1"
                title="Drag to reorder"
                aria-label="reorder"
              >⋮⋮</span>
              <span class="font-mono text-[9px] text-gray-600 mt-1 w-4 text-right flex-shrink-0">{i() + 1}</span>
              <Show
                when={editingId() === it.id}
                fallback={
                  <button
                    type="button"
                    onClick={() => beginEdit(it)}
                    class="flex-1 text-left text-gray-300 hover:text-gray-100 leading-snug break-words min-w-0"
                    title="Click to edit"
                  >
                    {it.text}
                  </button>
                }
              >
                <textarea
                  autofocus
                  value={editValue()}
                  rows="2"
                  onInput={(e) => setEditValue(e.currentTarget.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
                  }}
                  class="flex-1 bg-gray-950 border border-sky-500/40 rounded px-2 py-1 text-[12.5px] text-gray-100 resize-none focus:outline-none"
                />
              </Show>
              <Show when={it.status === 'sending'}>
                <span class="text-[10px] font-mono text-amber-300 flex-shrink-0 mt-1">sending…</span>
              </Show>
              <Show when={it.status === 'failed'}>
                <span class="text-[10px] font-mono text-red-300 flex-shrink-0 mt-1" title={it.failed_reason ?? 'dispatch failed'}>failed</span>
              </Show>
              <button
                type="button"
                onClick={() => props.onDelete(it.id)}
                class="flex-shrink-0 text-gray-600 hover:text-red-300 px-1 py-0.5 leading-none text-[12px] opacity-60 group-hover:opacity-100 transition-opacity"
                title="Remove from queue"
                aria-label="delete"
              >✕</button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
