/**
 * ChatPanel — conversation rail + active conversation with live streaming.
 *
 * Event model (mirrors the daemon's spawnCoordinatorChat invariants):
 *   chat.user                → one bubble per event
 *   chat.assistant.final     → one bubble per (conv, stream_id); replaces
 *                              the live delta bubble for that stream
 *   chat.assistant.delta     → live bubble, only shown if no .final yet
 *                              exists for the same stream_id
 *   chat.assistant (legacy)  → one bubble per event
 *   chat.cancelled           → live bubble becomes "cancelled" annotation
 *
 * Visual ordering rule (operator request 2026-05-18):
 *   While a coordinator turn is live (an assistant.delta has no matching
 *   .final yet), any chat.user events the operator sends *during* that
 *   turn render ABOVE the live bubble — not below in chronological
 *   order. This makes the bottom-most bubble always be the live work,
 *   and matches the daemon's behaviour: those queued prompts are
 *   absorbed into the next chained turn, so the operator's mental
 *   model is "I'm prepending more instructions to a single ongoing
 *   piece of work".
 *
 * Stop button:
 *   Shown while the conversation is running. Calls POST /chat/cancel
 *   with the conv id. The daemon SIGTERMs the live claude child and
 *   drops the pending buffer.
 */

import { For, Show, createMemo, createSignal, createEffect } from 'solid-js';
import { store } from '~/state/store';
import type { DaemonClient, DaemonEvent } from '~/lib/daemon-client';
import { log } from '~/lib/log';

interface ChatMsg {
  kind: 'user' | 'assistant';
  text: string;
  author?: string;
  ts?: string;
  streaming?: boolean;
  stream_id?: string;
  cancelled?: boolean;
}

interface ConvView {
  preBubble: ChatMsg[];     // messages before the live bubble started
  inFlightUsers: ChatMsg[]; // user msgs sent while the live bubble is open
  liveBubble: ChatMsg | null;
  liveStreamId: string | null;
  cancelled: boolean;
}

function eventsByConv(): Map<string, DaemonEvent[]> {
  const out = new Map<string, DaemonEvent[]>();
  const fromSnapshot = (store.snapshot.timeline?.recent ?? []) as DaemonEvent[];
  const live = store.events();
  const seen = new Set<string>();
  const all: DaemonEvent[] = [];
  for (const ev of [...fromSnapshot, ...live]) {
    const key = `${ev.type}|${ev['ts'] ?? ''}|${ev['stream_id'] ?? ''}|${ev['author'] ?? ''}|${(ev['text'] ?? '').toString().slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(ev);
  }
  for (const ev of all) {
    const t = String(ev.type);
    if (!t.startsWith('chat.')) continue;
    const conv = String(ev['conv'] ?? '');
    if (!conv) continue;
    if (!out.has(conv)) out.set(conv, []);
    out.get(conv)!.push(ev);
  }
  return out;
}

/**
 * Build the view for a single conversation. Sorts events chronologically
 * and then splits user messages by whether they arrived before or during
 * the (single, latest) live assistant bubble.
 */
function buildConvView(events: DaemonEvent[]): ConvView {
  const sorted = [...events].sort((a, b) => String(a['ts'] ?? '').localeCompare(String(b['ts'] ?? '')));

  // Identify the active stream: latest delta whose stream_id has no
  // matching .final and hasn't been cancelled. Cancellation events
  // close the stream visually but keep the bubble.
  const finals = new Set<string>();
  const cancelledStreams = new Set<string>();
  for (const e of sorted) {
    if (e.type === 'chat.assistant.final' && e['stream_id']) finals.add(String(e['stream_id']));
  }
  // cancellation isn't carried by a stream_id on the cancel event; the
  // conv-level cancelled flag below catches that case.
  void cancelledStreams;

  let liveStreamId: string | null = null;
  let liveStartTs: string | null = null;
  let liveBubble: ChatMsg | null = null;

  for (const e of sorted) {
    if (e.type === 'chat.assistant.delta' && e['stream_id'] && !finals.has(String(e['stream_id']))) {
      const sid = String(e['stream_id']);
      // Capture the earliest start ts per stream + latest text per stream.
      if (!liveStartTs || String(e['ts'] ?? '') < liveStartTs) liveStartTs = String(e['ts'] ?? '');
      liveStreamId = sid;
      liveBubble = {
        kind: 'assistant',
        text: String(e['text'] ?? ''),
        author: String(e['author'] ?? 'coordinator'),
        ts: String(e['ts'] ?? ''),
        streaming: true,
        stream_id: sid,
      };
    }
  }

  // Was the conversation cancelled? Last chat.cancelled wins for the
  // currently-open turn (if any).
  let cancelled = false;
  for (const e of sorted) {
    if (e.type === 'chat.cancelled') cancelled = true;
    if (e.type === 'chat.user' || e.type === 'chat.assistant.final') cancelled = false; // a new turn after the cancel resets the flag
  }

  const preBubble: ChatMsg[] = [];
  const inFlightUsers: ChatMsg[] = [];

  for (const e of sorted) {
    const ts = String(e['ts'] ?? '');
    if (e.type === 'chat.user') {
      const msg: ChatMsg = {
        kind: 'user', text: String(e['text'] ?? ''),
        author: String(e['author'] ?? ''), ts,
      };
      if (liveStartTs && ts > liveStartTs) inFlightUsers.push(msg);
      else preBubble.push(msg);
    } else if (e.type === 'chat.assistant.final') {
      preBubble.push({
        kind: 'assistant', text: String(e['text'] ?? ''),
        author: String(e['author'] ?? 'coordinator'), ts,
        stream_id: String(e['stream_id'] ?? ''),
      });
    } else if (e.type === 'chat.assistant') {
      preBubble.push({
        kind: 'assistant', text: String(e['text'] ?? ''),
        author: String(e['author'] ?? 'coordinator'), ts,
      });
    }
  }

  if (liveBubble && cancelled) {
    liveBubble.streaming = false;
    liveBubble.cancelled = true;
  }

  return { preBubble, inFlightUsers, liveBubble, liveStreamId, cancelled };
}

export default function ChatPanel(props: { client: DaemonClient }) {
  const convs = createMemo(() => eventsByConv());
  const [activeConv, setActiveConv] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal('');
  const [sending, setSending] = createSignal(false);
  const [cancelling, setCancelling] = createSignal(false);

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

  const view = createMemo<ConvView>(() => {
    const conv = activeConv();
    if (!conv) return { preBubble: [], inFlightUsers: [], liveBubble: null, liveStreamId: null, cancelled: false };
    const evs = convs().get(conv) ?? [];
    return buildConvView(evs);
  });

  const isRunning = () => view().liveBubble !== null && view().liveBubble!.streaming === true;

  const send = async () => {
    const text = draft().trim();
    if (!text || sending()) return;
    setSending(true);
    try {
      const body: { text: string; conv?: string } = { text };
      if (activeConv()) body.conv = activeConv()!;
      log.info('chat send', body);
      const res = await props.client.chatDispatch(body) as { queued?: boolean; conv?: string };
      // If the server tells us this was queued (turn already running), we
      // don't need to update local state — the chat.user event arrives via
      // WS and the view re-renders with the message above the live bubble.
      if (res?.conv && !activeConv()) setActiveConv(res.conv);
      setDraft('');
    } catch (err) {
      log.error('chat send failed', err);
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    const conv = activeConv();
    if (!conv || cancelling()) return;
    setCancelling(true);
    try {
      log.info('chat cancel', { conv });
      await fetch(`${props.client.transport.httpBase}/chat/cancel`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(props.client.transport.token ? { authorization: `Bearer ${props.client.transport.token}` } : {}),
        },
        body: JSON.stringify({ conv }),
      });
    } catch (err) {
      log.error('chat cancel failed', err);
    } finally {
      setCancelling(false);
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

      {/* Messages — preBubble → inFlightUsers → liveBubble (at the bottom) */}
      <div class="flex-1 min-h-0 overflow-y-auto bg-gray-950/40 border border-gray-800/60 rounded-lg p-3 mb-3 space-y-3">
        <Show when={activeConv() !== null} fallback={<EmptyChat />}>
          <For each={view().preBubble}>
            {(m) => <Bubble msg={m} />}
          </For>
          <For each={view().inFlightUsers}>
            {(m) => <Bubble msg={m} prepend />}
          </For>
          <Show when={view().liveBubble}>
            <Bubble msg={view().liveBubble!} />
          </Show>
        </Show>
      </div>

      {/* Composer */}
      <div class="flex gap-2 items-end">
        <textarea
          value={draft()}
          onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          placeholder={isRunning()
            ? 'Add more instructions — they go above the live work and get merged into the next turn…'
            : activeConv() ? 'Reply…' : 'Start a conversation…'}
          rows="2"
          disabled={sending()}
          class="flex-1 bg-gray-950 border border-gray-800 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500/50 disabled:opacity-60 resize-none"
        />
        <div class="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending() || draft().trim().length === 0}
            class="px-3 py-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {sending() ? '…' : 'Send'}
          </button>
          <Show when={isRunning()}>
            <button
              type="button"
              onClick={() => void stop()}
              disabled={cancelling()}
              class="px-3 py-2 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-300 font-semibold text-xs transition-colors disabled:opacity-60"
              title="Stop the coordinator. The pending buffer is dropped."
            >
              {cancelling() ? '…' : 'Stop'}
            </button>
          </Show>
        </div>
      </div>

      <Show when={isRunning()}>
        <p class="text-[11px] text-emerald-400/70 mt-2 px-1 leading-snug">
          A turn is in progress. Any message you send right now is queued and merged into the next turn instead of starting a new one.
        </p>
      </Show>
      <Show when={view().cancelled}>
        <p class="text-[11px] text-red-400/80 mt-2 px-1 leading-snug">
          Turn cancelled. Send a new message to start a fresh turn.
        </p>
      </Show>
    </div>
  );
}

function Bubble(props: { msg: ChatMsg; prepend?: boolean }) {
  const isUser = () => props.msg.kind === 'user';
  return (
    <div class={`flex flex-col gap-1 ${isUser() ? 'items-end' : 'items-start'}`}>
      <span class="text-[10px] font-mono text-gray-600 flex items-center gap-1.5">
        {props.msg.author}
        <Show when={props.msg.streaming}>
          <span class="text-emerald-400">· streaming</span>
        </Show>
        <Show when={props.msg.cancelled}>
          <span class="text-red-400">· cancelled</span>
        </Show>
        <Show when={props.prepend}>
          <span class="text-amber-400/80">· queued (merges into next turn)</span>
        </Show>
      </span>
      <div class={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
        isUser()
          ? props.prepend
            ? 'bg-amber-500/10 text-amber-100 border border-amber-500/30'
            : 'bg-emerald-500/15 text-emerald-100 border border-emerald-500/30'
          : props.msg.cancelled
            ? 'bg-red-500/10 text-red-200 border border-red-500/30'
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
