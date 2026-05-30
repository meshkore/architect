/**
 * debug-transport.ts — cockpit→daemon transport for the debug stream
 * (initiative `debug-stream`, daemon py-1.10.17, feature flag
 * `debug.stream.v1`).
 *
 * Wires `log.info/warn/error/...` to `POST /debug/log` via a bounded
 * buffer that flushes every FLUSH_MS. Goals:
 *
 *  1. Best-effort. The cockpit must keep working when the daemon is
 *     unreachable. Buffer caps at MAX_BUFFER and drops oldest on
 *     overflow.
 *  2. Feature-gated. Older daemons don't expose `/debug/log` —
 *     `health.features.includes('debug.stream.v1')` is the gate.
 *     Without it we drop entries silently.
 *  3. No-op in DEV unless the operator opts in. Browsers already show
 *     console output; doubling that into a server round-trip per
 *     keystroke would be noisy. Opt-in via
 *     `localStorage['mc-debug-stream'] = 'on'`.
 *  4. Zero imports of state.client at module-eval time — we read it
 *     lazily on each flush so the boot order stays loose.
 */
import { setLogSink, type LogSinkEntry } from '~/lib/log';
import { daemonClient, daemonHealth } from '~/state/daemon';

interface CockpitEvent {
  ts: string;
  tag: string;
  lvl: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  conv?: string;
  agent_id?: string;
  data?: Record<string, unknown>;
}

const FLUSH_MS = 1_000;
const MAX_BUFFER = 200;
const MAX_PER_FLUSH = 50;
const FEATURE_FLAG = 'debug.stream.v1';

const buffer: CockpitEvent[] = [];
let flushTimer: number | null = null;
let installed = false;

function shouldStream(): boolean {
  // DEV: explicit opt-in only.
  if (import.meta.env.DEV) {
    try {
      return localStorage.getItem('mc-debug-stream') === 'on';
    } catch {
      return false;
    }
  }
  // Production: on by default.
  return true;
}

function daemonSupports(): boolean {
  const h = daemonHealth();
  const features = (h?.features as string[] | undefined) ?? [];
  return features.includes(FEATURE_FLAG);
}

async function flushOnce(): Promise<void> {
  if (buffer.length === 0) return;
  const client = daemonClient();
  if (!client) return;
  if (!daemonSupports()) {
    // Daemon too old. Drain so we don't accumulate forever.
    buffer.length = 0;
    return;
  }
  const batch = buffer.splice(0, MAX_PER_FLUSH);
  try {
    const r = await fetch(`${client.transport.httpBase}/debug/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(client.transport.token ? { Authorization: `Bearer ${client.transport.token}` } : {}),
      },
      body: JSON.stringify({ events: batch }),
    });
    if (!r.ok) {
      // 4xx/5xx: drop the batch to keep the buffer bounded. Logging
      // the failure here would recurse through the same sink.
      return;
    }
  } catch {
    // Network down. Drop the batch (we don't re-buffer to avoid
    // infinite growth during long outages — this stream is best-effort).
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushOnce().finally(() => {
      if (buffer.length > 0) scheduleFlush();
    });
  }, FLUSH_MS);
}

/** Build a CockpitEvent from a raw LogSinkEntry. Two conventions
 *  recognised:
 *   1. `log.info('[stop-architect] start', {conv})` — bracketed
 *      prefix on the first string arg becomes the `tag`, kebab-case.
 *   2. `log.info('did X', {context})` — second arg's plain object
 *      becomes `data`; well-known fields (`conv`, `agent_id`, `tag`)
 *      get promoted to the top level for daemon-side indexing. */
function entryToEvent(e: LogSinkEntry, defaultTag = 'log'): CockpitEvent {
  const ev: CockpitEvent = { ts: e.ts, lvl: e.lvl, msg: e.msg, tag: defaultTag };
  const first = e.args[0];
  if (typeof first === 'string') {
    const m = first.match(/^\[([a-z0-9][a-z0-9._-]{0,62})\]/i);
    if (m && m[1]) ev.tag = m[1];
  }
  const second = e.args[1];
  if (second && typeof second === 'object' && !Array.isArray(second)) {
    const obj = second as Record<string, unknown>;
    if (typeof obj.conv === 'string') ev.conv = obj.conv;
    if (typeof obj.agent_id === 'string') ev.agent_id = obj.agent_id;
    if (typeof obj.tag === 'string' && obj.tag.length <= 64) ev.tag = obj.tag;
    ev.data = obj;
  }
  return ev;
}

/** Install the sink. Idempotent — calling twice is a no-op so dev
 *  hot-reload doesn't double-wire. */
export function installDebugTransport(): void {
  if (installed) return;
  installed = true;
  setLogSink((entry) => {
    if (!shouldStream()) return;
    if (buffer.length >= MAX_BUFFER) buffer.shift(); // drop oldest
    buffer.push(entryToEvent(entry));
    scheduleFlush();
  });
}

/** Emit a typed UX event directly (lifecycle hooks: Run All, Stop,
 *  validation submit). Bypasses the log sink so we can pass structured
 *  data cleanly. */
export function debugEmit(tag: string, msg: string, extra?: Omit<CockpitEvent, 'ts' | 'tag' | 'msg' | 'lvl'> & { lvl?: CockpitEvent['lvl'] }): void {
  if (!shouldStream()) return;
  const ev: CockpitEvent = {
    ts: new Date().toISOString(),
    lvl: extra?.lvl ?? 'info',
    tag,
    msg,
    ...(extra?.conv ? { conv: extra.conv } : {}),
    ...(extra?.agent_id ? { agent_id: extra.agent_id } : {}),
    ...(extra?.data ? { data: extra.data } : {}),
  };
  if (buffer.length >= MAX_BUFFER) buffer.shift();
  buffer.push(ev);
  scheduleFlush();
}
