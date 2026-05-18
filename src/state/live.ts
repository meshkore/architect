/**
 * live.ts — WebSocket reconnect manager.
 *
 * Owns the single /events socket. Auto-reconnects with exponential backoff
 * when the daemon restarts or the network blinks. Forwards every event
 * into the global store.
 */

import type { DaemonClient } from '~/lib/daemon-client';
import { store } from './store';
import { log } from '~/lib/log';

const BACKOFF_MIN = 750;   // ms
const BACKOFF_MAX = 15000;
const BACKOFF_FACTOR = 1.8;

let socket: WebSocket | null = null;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

export function startLive(client: DaemonClient): void {
  stopped = false;
  open(client);
}

export function stopLive(): void {
  stopped = true;
  if (timer) { clearTimeout(timer); timer = null; }
  if (socket && socket.readyState === WebSocket.OPEN) {
    try { socket.close(); } catch { /* noop */ }
  }
  socket = null;
}

function open(client: DaemonClient): void {
  if (stopped) return;
  store.setWsState('connecting');
  log.info('ws connecting', { url: `${client.transport.wsBase}/events`, attempt });

  socket = client.openEvents(
    (ev) => {
      store.appendEvent(ev);
    },
    (s) => {
      if (s === 'open') {
        attempt = 0;
        store.setWsState('open');
        log.info('ws open');
      } else if (s === 'closed') {
        store.setWsState('closed');
        log.warn('ws closed — scheduling reconnect');
        scheduleReconnect(client);
      } else if (s === 'error') {
        store.setWsState('error');
        log.error('ws error');
        scheduleReconnect(client);
      }
    },
  );
}

function scheduleReconnect(client: DaemonClient): void {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  const delay = Math.min(BACKOFF_MIN * Math.pow(BACKOFF_FACTOR, attempt), BACKOFF_MAX);
  attempt += 1;
  log.info('reconnect in', Math.round(delay), 'ms');
  timer = setTimeout(() => open(client), delay);
}
