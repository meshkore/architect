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

import { For, Show, createSignal } from 'solid-js';
import type { DaemonClient } from '~/lib/daemon-client';
import { chatStore, ONBOARDING_CONV_ID } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { isProjectEmpty } from '~/state/server';
import { onboardingBootstrapBrief } from '~/lib/onboarding-brief';

const ACCEPT = 'image/*,.md,.txt,.pdf,.json,.yaml,.yml,.csv,.log';
const MAX_IMAGES = 6;

type PendingImg = { dataURL: string; mediaType: string };
type PendingDoc = { filename: string; content: string };

export default function ChatComposer(props: {
  client: DaemonClient;
  conv: string;
  placeholder?: string;
  onTokenRejected?: (draft: string) => void;
  onDaemonOutdated?: () => void;
}) {
  const [draft, setDraft] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [imgs, setImgs] = createSignal<PendingImg[]>([]);
  const [docs, setDocs] = createSignal<PendingDoc[]>([]);
  let fileEl: HTMLInputElement | undefined;
  let taEl: HTMLTextAreaElement | undefined;

  const grow = () => {
    if (!taEl) return;
    taEl.style.height = 'auto';
    taEl.style.height = Math.min(taEl.scrollHeight, 180) + 'px';
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
    setDraft(''); setImgs([]); setDocs([]); grow();
    const res = await chatStore.dispatchMessage(props.client, {
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
      <div class="flex gap-2 items-end">
        <textarea
          ref={taEl} value={draft()} rows="2" disabled={sending()}
          placeholder={props.placeholder ?? 'Reply…'}
          onInput={(e) => { setDraft(e.currentTarget.value); grow(); }}
          onKeyDown={onKey} onPaste={onPaste}
          class="flex-1 bg-gray-950 border border-gray-800 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 disabled:opacity-60 resize-none"
        />
        <input ref={fileEl} type="file" multiple accept={ACCEPT} class="hidden"
          onChange={(e) => { const fs = e.currentTarget.files; if (fs) for (let i = 0; i < fs.length; i += 1) addFile(fs[i]!); e.currentTarget.value = ''; }} />
        <div class="flex flex-col gap-1.5">
          <button type="button" title="Attach images or docs" onClick={() => fileEl?.click()}
            class="px-2 py-2 rounded-md border border-gray-800 hover:border-gray-600 text-gray-400 hover:text-gray-200 text-xs">📎</button>
          <button type="button" title="Send (Cmd/Ctrl+Enter)" onClick={() => void send()}
            disabled={sending() || (!draft().trim() && imgs().length === 0 && docs().length === 0)}
            class="px-3 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed">{sending() ? '…' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}
