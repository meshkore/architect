/**
 * ChatPanel — conversation rail + active conversation with live streaming.
 *
 * Event model (mirrors the monolith's `indexEvents()`):
 *   chat.user                → one bubble per event
 *   chat.assistant.final     → one bubble per (conv, stream_id); replaces
 *                              the live delta bubble for that stream
 *   chat.assistant.delta     → live bubble, only shown if no .final yet
 *                              exists for the same stream_id
 *   chat.assistant (legacy)  → one bubble per event
 *
 * Conversations are derived from the event log; sending a new message
 * implicitly creates a conversation (server-side derives a conv slug
 * from the first 6 words of the prompt).
 */

import { For, Show, createMemo, createSignal, createEffect } from 'solid-js';
import { store } from '~/state/store';
import type { DaemonClient, DaemonEvent } from '~/lib/daemon-client';
import { log } from '~/lib/log';

interface ChatMsg {
  type: 'user' | 'assistant';
  text: string;
  author?: string;
  ts?: string;
  streaming?: boolean;
}

function eventsByConv(): Map<string, DaemonEvent[]> {
  const out = new Map<string, DaemonEvent[]>();
  const fromSnapshot = (store.snapshot.timeline?.recent ?? []) as DaemonEvent[];
  const live = store.events();
  // Dedup by (type, ts, stream_id) when both sources overlap. The snapshot
  // is the source of truth on first load; the live stream takes over for
  // anything new.
  const seen = new Set<string>();
  const all: DaemonEvent[] = [];
  for (const ev of [...fromSnapshot, ...live]) {
    const key = `${ev.type}|${ev['ts'] ?? ''}|${ev['stream_id'] ?? ''}|${ev['author'] ?? ''}|${(ev['text'] ?? '').toString().slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(ev);
  }
  for (const ev of all) {
    if (!String(ev.type).startsWith('chat.')) continue;
    const conv = String(ev['conv'] ?? '');
    if (!conv) continue;
    if (!out.has(conv)) out.set(conv, []);
    out.get(conv)!.push(ev);
  }
  return out;
}

function buildMessages(events: DaemonEvent[]): ChatMsg[] {
  const finals = new Set<string>();
  for (const e of events) {
    if (e.type === 'chat.assistant.final' && e['stream_id']) finals.add(String(e['stream_id']));
  }
  const liveByStream = new Map<string, DaemonEvent>();
  for (const e of events) {
    if (e.type === 'chat.assistant.delta' && e['stream_id'] && !finals.has(String(e['stream_id']))) {
      // Keep latest delta per stream_id (it carries the cumulative text).
      liveByStream.set(String(e['stream_id']), e);
    }
  }
  const out: ChatMsg[] = [];
  for (const e of events) {
    if (e.type === 'chat.user') {
      out.push({ type: 'user', text: String(e['text'] ?? ''), author: String(e['author'] ?? ''), ts: String(e['ts'] ?? '') });
    } else if (e.type === 'chat.assistant.final') {
      out.push({ type: 'assistant', text: String(e['text'] ?? ''), author: String(e['author'] ?? 'assistant'), ts: String(e['ts'] ?? '') });
    } else if (e.type === 'chat.assistant') {
      out.push({ type: 'assistant', text: String(e['text'] ?? ''), author: String(e['author'] ?? 'assistant'), ts: String(e['ts'] ?? '') });
    }
  }
  for (const e of liveByStream.values()) {
    out.push({
      type: 'assistant',
      text: String(e['text'] ?? ''),
      author: String(e['author'] ?? 'assistant'),
      ts: String(e['ts'] ?? ''),
      streaming: true,
    });
  }
  return out.sort((a, b) => (a.ts ?? '').localeCompare(b.ts ?? ''));
}

export default function ChatPanel(props: { client: DaemonClient }) {
  const convs = createMemo(() => eventsByConv());
  const [activeConv, setActiveConv] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal('');
  const [sending, setSending] = createSignal(false);

  // Auto-pick the most recent conversation as active on first load.
  createEffect(() => {
    if (activeConv() !== null) return;
    const c = convs();
    if (c.size === 0) return;
    const sorted = [...c.entries()].sort((a, b) => {
      const at = (a[1][a[1].length - 1]?.['ts'] ?? '') as string;
      const bt = (b[1][b[1].length - 1]?.['ts'] ?? '') as string;
      return bt.localeCompare(at);
    });
    setActiveConv(sorted[0]?.[0] ?? null);
  });

  const activeMessages = createMemo(() => {
    const conv = activeConv();
    if (!conv) return [];
    const evs = convs().get(conv) ?? [];
    return buildMessages(evs);
  });

  const send = async () => {
    const text = draft().trim();
    if (!text || sending()) return;
    setSending(true);
    try {
      const body: { text: string; conv?: string } = { text };
      if (activeConv()) body.conv = activeConv()!;
      log.info('chat send', body);
      await props.client.chatDispatch(body);
      setDraft('');
    } catch (err) {
      log.error('chat send failed', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div class="flex flex-col h-full min-h-0">
      <div class="flex items-center justify-between mb-3 px-2">
        <h2 class="text-xs font-mono uppercase tracking-wider text-gray-500">Chat</h2>
        <button
          type="button"
          onClick={() => { setActiveConv(null); setDraft(''); }}
          class="text-xs text-gray-500 hover:text-emerald-400"
          title="Start a new conversation"
        >
          + new
        </button>
      </div>

      {/* Conversation list */}
      <ul class="space-y-1 mb-3 max-h-32 overflow-y-auto pr-1">
        <For each={[...convs().entries()]}>
          {([id]) => (
            <li>
              <button
                type="button"
                onClick={() => setActiveConv(id)}
                class={`w-full text-left px-2 py-1 rounded text-xs font-mono truncate transition-colors ${
                  activeConv() === id
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : 'text-gray-500 hover:bg-gray-800/60 hover:text-gray-300'
                }`}
              >
                {id}
              </button>
            </li>
          )}
        </For>
        <Show when={convs().size === 0}>
          <li class="text-xs text-gray-600 px-2">No conversations yet.</li>
        </Show>
      </ul>

      {/* Messages */}
      <div class="flex-1 min-h-0 overflow-y-auto bg-gray-950/40 border border-gray-800/60 rounded-lg p-3 mb-3 space-y-3">
        <Show when={activeConv() !== null} fallback={<EmptyChat />}>
          <For each={activeMessages()}>
            {(m) => <Bubble msg={m} />}
          </For>
        </Show>
      </div>

      {/* Composer */}
      <div class="flex gap-2">
        <input
          type="text"
          value={draft()}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder={activeConv() ? 'Reply…' : 'Start a conversation…'}
          disabled={sending()}
          class="flex-1 bg-gray-950 border border-gray-800 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending() || draft().trim().length === 0}
          class="px-3 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {sending() ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

function Bubble(props: { msg: ChatMsg }) {
  const isUser = () => props.msg.type === 'user';
  return (
    <div class={`flex flex-col gap-1 ${isUser() ? 'items-end' : 'items-start'}`}>
      <span class="text-[10px] font-mono text-gray-600">
        {props.msg.author}
        <Show when={props.msg.streaming}>
          <span class="text-emerald-400"> · streaming</span>
        </Show>
      </span>
      <div class={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
        isUser()
          ? 'bg-emerald-500/15 text-emerald-100 border border-emerald-500/30'
          : 'bg-gray-900/70 text-gray-200 border border-gray-800'
      }`}>
        {props.msg.text}
        <Show when={props.msg.streaming}>
          <span class="inline-block w-2 h-3.5 bg-emerald-400 ml-1 align-middle animate-pulse-soft" />
        </Show>
      </div>
    </div>
  );
}

function EmptyChat() {
  return (
    <p class="text-center text-xs text-gray-600 py-8">Pick a conversation or send a message to start one.</p>
  );
}
