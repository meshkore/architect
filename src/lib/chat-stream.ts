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
  let queued: StreamItem[] = [];

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

  // 2026-06-10 case 1 — collapse multiple QUEUED user bubbles into a
  // single growing bubble whose text is the concatenation (`\n\n` separator).
  // Mirrors the daemon-side merge-on-arrival in `ChatSessions.queue`
  // (py-1.12.20): the agent sees one continuous message, the operator
  // sees one growing bubble. Operator: "Si mandamos otro mientras hay
  // uno en espera, añadimos el texto, con una linea en medio, para que
  // se vea que es otro párrafo."
  if (queued.length > 1 && queued.every((x) => x.kind === 'msg' && x.msg.kind === 'user')) {
    const first = queued[0]!;
    if (first.kind === 'msg') {
      const mergedText = queued
        .map((x) => (x.kind === 'msg' ? (x.msg.text ?? '') : ''))
        .filter((t) => t.length > 0)
        .join('\n\n');
      queued = [{
        kind: 'msg',
        ts: first.ts,
        prepend: true,
        msg: { ...first.msg, text: mergedText },
      }];
    }
  }

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
