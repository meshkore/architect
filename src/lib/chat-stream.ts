import { store } from '~/state/store';
import { isAutonomousConv, isWakeAuthored, type ChatMsg } from '~/state/chat';
import type { DaemonEvent } from '~/lib/daemon-client';

export type StreamItem =
  | { kind: 'msg'; ts: string; msg: ChatMsg; prepend?: boolean }
  | { kind: 'tool'; ts: string; ev: DaemonEvent }
  | { kind: 'task'; ts: string; ev: DaemonEvent };

/** A render segment for the autonomous (continuous-timeline) layout: a
 *  `run` is consecutive agent finals shown under ONE header; an operator
 *  `msg` (or a tool/task event) breaks the run and renders standalone. */
export type AutoSegment =
  | { kind: 'run'; msgs: ChatMsg[] }
  | { kind: 'msg'; msg: ChatMsg }
  | { kind: 'tool'; ev: DaemonEvent }
  | { kind: 'task'; ev: DaemonEvent };

/** Group an autonomous conv's ordered stream into a continuous timeline:
 *  consecutive assistant finals coalesce into one `run`; the live bubble
 *  tails the final run; an operator message / tool / task flushes the run
 *  and renders on its own (so the next agent output starts a fresh run). */
export function groupAutonomous(pre: StreamItem[], live: ChatMsg | null): AutoSegment[] {
  const out: AutoSegment[] = [];
  let run: ChatMsg[] | null = null;
  const flush = (): void => {
    if (run && run.length) out.push({ kind: 'run', msgs: run });
    run = null;
  };
  for (const it of pre) {
    if (it.kind === 'msg') {
      if (it.msg.kind === 'assistant') {
        (run ??= []).push(it.msg);
      } else {
        flush();
        out.push({ kind: 'msg', msg: it.msg });
      }
    } else if (it.kind === 'tool') {
      flush();
      out.push({ kind: 'tool', ev: it.ev });
    } else {
      flush();
      out.push({ kind: 'task', ev: it.ev });
    }
  }
  if (live) (run ??= []).push(live);
  flush();
  return out;
}

export function buildStream(conv: string, msgs: ChatMsg[]): {
  pre: StreamItem[]; queued: StreamItem[]; live: ChatMsg | null;
} {
  const autonomous = isAutonomousConv(conv);
  const liveIdx = msgs.findIndex((m) => m.kind === 'assistant' && m.streaming);
  const live: ChatMsg | null = liveIdx >= 0 ? msgs[liveIdx]! : null;

  const events: DaemonEvent[] = (store.events() as DaemonEvent[])
    .filter((e) => String(e['conv'] ?? '') === conv);

  const pre: StreamItem[] = [];
  let queued: StreamItem[] = [];

  // A-QUEUE-ORDER-01 (revised 2026-06-17) — a user message is "queued ·
  // merges into next turn" ONLY when there is an ACTUAL live streaming
  // bubble AND the message sits AFTER it in convMap order (a trailing,
  // not-yet-answered message). Using array position (`i > liveIdx`) — not
  // a ts comparison, and NOT the daemon's sticky convs[].live / pendingReply
  // flags. The earlier daemon-authoritative version regressed: those flags
  // linger after a turn finalizes (py-1.17.0 finalizes promptly), so an
  // ALREADY-ANSWERED message kept the "queued" badge and rendered BELOW its
  // own response (operator field 2026-06-17). No live bubble ⇒ nothing is
  // queued; trailing messages just flow in sequence and trigger the next turn.
  msgs.forEach((m, i) => {
    if (i === liveIdx) return;
    // Autonomous convs: hide the daemon→agent wake plumbing entirely
    // (the agent summarises the outcome in its own terse event line).
    if (autonomous && isWakeAuthored(m)) return;
    const ts = m.ts ?? '';
    const item: StreamItem = { kind: 'msg', ts, msg: m };
    // Autonomous convs never HOIST an operator message above the live
    // output ("queued · merges into next turn"). The operator's co-direction
    // message renders INLINE in chronological order — it's the natural break
    // that ends the current run and starts a fresh agent header after it.
    if (!autonomous && live && m.kind === 'user' && i > liveIdx) {
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
