/**
 * ws.ts — WebSocket client for the daemon's /events stream.
 *
 * Single class `DaemonWS` owning the live event feed. Responsibilities:
 *   - dial the /events endpoint with the cluster's bearer token,
 *   - auto-reconnect with capped exponential backoff
 *     (500 ms → 1 s → 2 s → 5 s, then steady at 5 s),
 *   - JSON-parse each `message` event into a typed `DaemonEvent`,
 *   - fan out via per-type listeners (`on(type, cb)`) plus a
 *     catch-all (`onAny(cb)`),
 *   - emit a `state` callback so the connection pill in the cockpit
 *     can show open / closed / reconnecting / fatal,
 *   - clean teardown (`close()`) that cancels any pending reconnect
 *     timer.
 *
 * onCleanup pattern (audit §2.3): every Solid component that creates
 * a `DaemonWS` MUST register its `close()` with `onCleanup` so a
 * route change / HMR / store re-init doesn't leave a dangling socket.
 *
 * Heartbeat: the daemon ignores client-side pings (it sends its own
 * `hello` on connect and relies on TCP keepalive); we don't send any
 * keepalive frames. Reconnect after `close` covers all dead-socket
 * cases.
 *
 * Live in `src/lib/ws.ts` rather than `transport.ts` so the existing
 * `transport.ts` (config-only) keeps its narrow shape. The two
 * modules are paired: transport builds the URL, ws speaks it.
 */

import type { TransportConfig } from './transport';
import { log } from './log';

export interface DaemonEvent {
  type: string;
  ts?: string;
  conv?: string;
  author?: string;
  [k: string]: unknown;
}

export type DaemonWSState = 'idle' | 'connecting' | 'open' | 'closed' | 'reconnecting' | 'fatal';

export type EventListener = (ev: DaemonEvent) => void;
export type StateListener = (s: DaemonWSState) => void;

const BACKOFF_MS = [500, 1000, 2000, 5000]; // capped at 5000 after step 3
// V84 — cap reconnect attempts so a daemon that's dead / a mixed-
// content scenario (https page reaching ws://localhost) doesn't fire
// a forever loop that piles up Chrome LNA Issues. After this many
// consecutive failures, transition to 'fatal' and stop dialing.
const MAX_RETRY_ATTEMPTS = 6;

export class DaemonWS {
  private socket: WebSocket | null = null;
  private state: DaemonWSState = 'idle';
  private wantClose = false;
  private retryStep = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly typeListeners = new Map<string, Set<EventListener>>();
  private readonly anyListeners = new Set<EventListener>();
  private readonly stateListeners = new Set<StateListener>();

  constructor(private readonly transport: TransportConfig) {}

  /** Open the socket. Idempotent: ignored if already connecting / open. */
  connect(): void {
    if (this.state === 'connecting' || this.state === 'open') return;
    // A-WS-01 (V109) — a connect() after we gave up (`fatal`) or after a
    // clean `closed`/pending `reconnecting` must start a FRESH retry
    // budget. Without this, retryStep was still ≥ MAX_RETRY_ATTEMPTS, so
    // the next failure re-`fatal`ed immediately — a daemon that restarts
    // on the SAME port (now the norm with stable ports) would never
    // reconnect. Reset the counter + drop any pending backoff timer.
    if (this.state === 'fatal' || this.state === 'closed' || this.state === 'reconnecting') {
      this.retryStep = 0;
      if (this.retryTimer !== null) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    }
    this.wantClose = false;
    this.dial();
  }

  /** True when the socket has given up (no auto-reconnect). The health
   *  poll uses this to revive via connect() once the daemon answers. */
  isDead(): boolean {
    return this.state === 'fatal' || this.state === 'closed';
  }

  /** Close the socket and stop reconnecting. */
  close(): void {
    this.wantClose = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.setState('closed');
  }

  /** Register a listener for one event type. Returns the unregister fn. */
  on(type: string, cb: EventListener): () => void {
    let set = this.typeListeners.get(type);
    if (!set) {
      set = new Set();
      this.typeListeners.set(type, set);
    }
    set.add(cb);
    return () => {
      const s = this.typeListeners.get(type);
      if (s) s.delete(cb);
    };
  }

  /** Register a listener for every event regardless of type. */
  onAny(cb: EventListener): () => void {
    this.anyListeners.add(cb);
    return () => this.anyListeners.delete(cb);
  }

  /** Register a listener for the connection state changes. */
  onState(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    cb(this.state);
    return () => this.stateListeners.delete(cb);
  }

  // ── internals ────────────────────────────────────────────────────

  private dial(): void {
    this.setState(this.retryStep === 0 ? 'connecting' : 'reconnecting');
    const url = new URL('/events', this.transport.wsBase);
    if (this.transport.token) url.searchParams.set('token', this.transport.token);

    // V84 — mixed-content guard. If the cockpit is served over HTTPS
    // (hub.meshkore.com) but the daemon is plain `ws://localhost`,
    // every browser blocks the WS handshake AND every attempt fires
    // a Chrome Local Network Access "Issue". Two managers stacking on
    // that was generating ~8 Issues/min → 1.9k in a session. Bail on
    // the first attempt rather than spinning a reconnect loop.
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && url.protocol === 'ws:') {
      console.warn('[WS] refusing ws:// dial from https origin (mixed content)', url.toString());
      log.warn('ws refused — mixed content (https page → ws://)');
      this.setState('fatal');
      return;
    }

    console.log('[WS] dial', { url: url.toString(), attempt: this.retryStep });
    log.debug('ws dial', url.toString());
    let socket: WebSocket;
    try {
      socket = new WebSocket(url.toString());
    } catch (e) {
      log.warn('ws constructor threw', e instanceof Error ? e.message : String(e));
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      log.debug('ws open');
      this.retryStep = 0;
      this.setState('open');
    });

    socket.addEventListener('message', (msg) => {
      const raw = typeof msg.data === 'string' ? msg.data : '';
      if (!raw) return;
      let ev: DaemonEvent;
      try {
        ev = JSON.parse(raw) as DaemonEvent;
      } catch (e) {
        log.warn('ws parse failed', e instanceof Error ? e.message : String(e));
        return;
      }
      this.dispatch(ev);
    });

    socket.addEventListener('close', () => {
      log.debug('ws close');
      this.socket = null;
      if (this.wantClose) {
        this.setState('closed');
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      // We don't surface error directly — the close handler runs right
      // after and decides whether to reconnect. Just log for diagnosis.
      log.warn('ws error event');
    });
  }

  private scheduleReconnect(): void {
    if (this.wantClose) return;
    if (this.retryStep >= MAX_RETRY_ATTEMPTS) {
      console.warn('[WS] max retries reached — stopping', { attempts: this.retryStep });
      log.warn('ws max retries reached — giving up');
      this.setState('fatal');
      return;
    }
    const idx = Math.min(this.retryStep, BACKOFF_MS.length - 1);
    const delay = BACKOFF_MS[idx] ?? 5000;
    this.retryStep += 1;
    this.setState('reconnecting');
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.dial();
    }, delay);
  }

  private dispatch(ev: DaemonEvent): void {
    // Fan out to typed listeners first, then catch-all.
    const set = this.typeListeners.get(ev.type);
    if (set) {
      for (const cb of set) {
        try {
          cb(ev);
        } catch (e) {
          log.warn('event listener threw', ev.type, e instanceof Error ? e.message : String(e));
        }
      }
    }
    for (const cb of this.anyListeners) {
      try {
        cb(ev);
      } catch (e) {
        log.warn('event onAny listener threw', e instanceof Error ? e.message : String(e));
      }
    }
  }

  private setState(s: DaemonWSState): void {
    if (this.state === s) return;
    this.state = s;
    for (const cb of this.stateListeners) {
      try {
        cb(s);
      } catch (e) {
        log.warn('state listener threw', e instanceof Error ? e.message : String(e));
      }
    }
  }
}
