/**
 * CronLogViewer — live tail of cron lifecycle events for one job.
 *
 * The daemon doesn't stream stdout — it broadcasts lifecycle events
 * (`cron.fired`, `cron.finished`, `cron.timeout`, `cron.error`,
 * `cron.skipped`, `cron.would_have_fired`) and writes per-run stdout
 * to a file under `.meshkore/.runtime/logs/cron/<id>/<ts>.log` which
 * the cockpit never reads directly. So "log tail" here = a scrolling
 * chronological feed of those events, colour-coded by status.
 */

import { createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import type { DaemonEvent } from '~/lib/ws';

export interface CronEventLine {
  ts: string;
  type: string;
  text: string;
  level: 'info' | 'ok' | 'warn' | 'error';
}

const CRON_EVENT_TYPES = [
  'cron.fired',
  'cron.finished',
  'cron.skipped',
  'cron.error',
  'cron.timeout',
  'cron.would_have_fired',
] as const;

function lineFromEvent(ev: DaemonEvent): CronEventLine | null {
  const ts = typeof ev.ts === 'string' ? ev.ts : new Date().toISOString();
  switch (ev.type) {
    case 'cron.fired':
      return {
        ts, type: ev.type, level: 'info',
        text: `fired (reason=${String(ev.reason ?? 'scheduled')}, pid=${String(ev.pid ?? '?')})`,
      };
    case 'cron.finished': {
      const status = String(ev.status ?? 'unknown');
      const level: CronEventLine['level'] = status === 'ok' ? 'ok' : 'error';
      return {
        ts, type: ev.type, level,
        text: `finished status=${status} exit=${String(ev.exit ?? '?')} dur=${String(ev.duration_sec ?? '?')}s`,
      };
    }
    case 'cron.skipped':
      return { ts, type: ev.type, level: 'warn', text: `skipped — ${String(ev.reason ?? 'unknown')}` };
    case 'cron.error':
      return { ts, type: ev.type, level: 'error', text: `error: ${String(ev.error ?? 'unknown')}` };
    case 'cron.timeout':
      return { ts, type: ev.type, level: 'error', text: 'timeout — daemon will SIGTERM/SIGKILL' };
    case 'cron.would_have_fired':
      return { ts, type: ev.type, level: 'warn', text: 'would have fired (not coordinator)' };
    default:
      return null;
  }
}

const RING_CAP = 200;

export default function CronLogViewer(props: { jobId: string }) {
  const [lines, setLines] = createSignal<CronEventLine[]>([]);
  let scrollEl: HTMLDivElement | undefined;

  createEffect(() => {
    const jobId = props.jobId;
    setLines([]);
    const ws = daemonStore.state.ws;
    if (!ws) return;
    const unsubs = CRON_EVENT_TYPES.map((t) =>
      ws.on(t, (ev) => {
        if (ev.id !== jobId) return;
        const line = lineFromEvent(ev);
        if (!line) return;
        setLines((prev) => {
          const next = prev.length >= RING_CAP ? prev.slice(prev.length - RING_CAP + 1) : prev.slice();
          next.push(line);
          return next;
        });
        queueMicrotask(() => { if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight; });
      }),
    );
    onCleanup(() => { for (const u of unsubs) u(); });
  });

  const colourFor = (l: CronEventLine['level']) =>
    l === 'ok' ? 'text-emerald-300'
    : l === 'warn' ? 'text-amber-300'
    : l === 'error' ? 'text-red-300'
    : 'text-gray-300';

  return (
    <div class="flex-1 min-h-0 flex flex-col bg-gray-950/60 border border-gray-800/60 rounded-lg overflow-hidden">
      <div class="px-3 py-2 border-b border-gray-800/60 flex items-center justify-between">
        <span class="text-[11px] font-mono text-gray-500">cron.* events — live tail</span>
        <span class="text-[10px] text-gray-600">{lines().length} / {RING_CAP}</span>
      </div>
      <div ref={scrollEl} class="flex-1 min-h-0 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        <Show
          when={lines().length > 0}
          fallback={
            <p class="text-gray-600 italic">Waiting for events… Trigger a run, or wait for the next scheduled fire.</p>
          }
        >
          <For each={lines()}>
            {(line) => (
              <div class="flex gap-2">
                <span class="text-gray-600 shrink-0">{line.ts.slice(11, 19)}</span>
                <span class="text-gray-500 shrink-0">{line.type.replace('cron.', '')}</span>
                <span class={`${colourFor(line.level)} break-all`}>{line.text}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
