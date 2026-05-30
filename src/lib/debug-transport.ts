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
 *     overflow. Drops are surfaced via `debugDropCount()` so the chat
 *     header can render a badge.
 *  2. Feature-gated. Older daemons don't expose `/debug/log` —
 *     `health.features.includes('debug.stream.v1')` is the gate.
 *     Without it we drop entries silently.
 *  3. No-op in DEV unless the operator opts in. Browsers already show
 *     console output; doubling that into a server round-trip per
 *     keystroke would be noisy. Opt-in via
 *     `localStorage['mc-debug-stream'] = 'on'`.
 *  4. Zero imports of state.client at module-eval time — we read it
 *     lazily on each flush so the boot order stays loose.
 *  5. V50 — distinguish 4xx (drop the batch, daemon rejected) from
 *     5xx / network error (re-buffer for next flush, transient). The
 *     re-buffered entries still respect MAX_BUFFER (drop oldest).
 */
import { createSignal } from 'solid-js';
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
const MAX_BUFFER = 500;       // V50 — bumped from 200 → 500.
const MAX_PER_FLUSH = 50;
const FEATURE_FLAG = 'debug.stream.v1';

const buffer: CockpitEvent[] = [];
let flushTimer: number | null = null;
let installed = false;

// V50 — drop counter. Increments every time we drop the oldest entry to
// make room. ChatScopeStrip reads this to render a small badge so the
// operator knows the debug stream is overflowing. Cleared whenever the
// buffer fully drains (debug stream caught up).
const [dropCount, setDropCount] = createSignal(0);
export const debugDropCount = dropCount;

function pushBounded(ev: CockpitEvent): void {
  if (buffer.length >= MAX_BUFFER) {
    buffer.shift();
    setDropCount((n) => n + 1);
  }
  buffer.push(ev);
}

function unshiftBoundedMany(events: CockpitEvent[]): void {
  // Re-buffer a failed batch at the front (oldest-first order
  // preserved). If that puts us over MAX_BUFFER, drop from the front
  // (still oldest) — same drop-oldest policy as pushBounded.
  buffer.unshift(...events);
  while (buffer.length > MAX_BUFFER) {
    buffer.shift();
    setDropCount((n) => n + 1);
  }
}

function maybeClearDrops(): void {
  if (buffer.length === 0 && dropCount() > 0) setDropCount(0);
}

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
  if (buffer.length === 0) { maybeClearDrops(); return; }
  const client = daemonClient();
  if (!client) return;
  if (!daemonSupports()) {
    // Daemon too old. Drain so we don't accumulate forever.
    buffer.length = 0;
    maybeClearDrops();
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
    if (r.ok) {
      maybeClearDrops();
      return;
    }
    if (r.status >= 400 && r.status < 500) {
      // Daemon rejected (auth, bad shape, feature off). Don't retry —
      // logging the failure here would recurse through the same sink.
      return;
    }
    // 5xx — daemon up but unhappy. Re-buffer for next flush.
    unshiftBoundedMany(batch);
  } catch {
    // Network down / TLS reset / aborted. Re-buffer for next flush.
    unshiftBoundedMany(batch);
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
    pushBounded(entryToEvent(entry));
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
  pushBounded(ev);
  scheduleFlush();
}
