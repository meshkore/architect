import { store } from '~/state/store';
import type { ChatMsg } from '~/state/chat';
import type { DaemonEvent } from '~/lib/daemon-client';

export type StreamItem =
  | { kind: 'msg'; ts: string; msg: ChatMsg; prepend?: boolean }
  | { kind: 'tool'; ts: string; ev: DaemonEvent }
  | { kind: 'task'; ts: string; ev: DaemonEvent };

export function buildStream(conv: string, msgs: ChatMsg[]): {
  pre: StreamItem[]; queued: StreamItem[]; live: ChatMsg | null;
} {
  const liveIdx = msgs.findIndex((m) => m.kind === 'assistant' && m.streaming);
  const live: ChatMsg | null = liveIdx >= 0 ? msgs[liveIdx]! : null;
  const liveTs = live?.ts ?? null;

  const events: DaemonEvent[] = (store.events() as DaemonEvent[])
    .filter((e) => String(e['conv'] ?? '') === conv);

  const pre: StreamItem[] = [];
  const queued: StreamItem[] = [];

  msgs.forEach((m, i) => {
    if (i === liveIdx) return;
    const ts = m.ts ?? '';
    const item: StreamItem = { kind: 'msg', ts, msg: m };
    // While a coordinator turn is live, late chat.user events render above
    // the live bubble — they will be folded into the next chained turn.
    if (live && m.kind === 'user' && liveTs && ts > liveTs) {
      queued.push({ ...item, prepend: true });
    } else {
      pre.push(item);
    }
  });

  for (const e of events) {
    const t = String(e.type);
    const ts = String(e['ts'] ?? '');
    if (t === 'tool.use' || t === 'tool.result') {
      pre.push({ kind: 'tool', ts, ev: e });
    } else if (t.startsWith('task.')) {
      pre.push({ kind: 'task', ts, ev: e });
    }
  }
  pre.sort((a, b) => a.ts.localeCompare(b.ts));
  return { pre, queued, live };
}
