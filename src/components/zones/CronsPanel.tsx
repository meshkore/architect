/**
 * CronsPanel — the Crons zone.
 *
 * Layout: header strip (coordinator + identity + tick) on top, then a
 * two-column body — CronList on the left (selectable rows + per-row
 * Trigger Now), CronLogViewer on the right (WS tail of `cron.*` events
 * for the selected job).
 *
 * Reads the job list via DaemonClient.cronList (M1.1). Refreshes on
 * any `cron.fired` / `cron.finished` so the running indicator and
 * `next_run` stay accurate; the WS event stream itself drives the log
 * viewer in real time.
 */

import { createSignal, onMount, onCleanup, Show, createEffect } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { uiStore } from '~/state/ui';
import { mcAlert } from '~/lib/modal';
import { log } from '~/lib/log';
import type { CronJob, CronListResponse } from '~/lib/daemon-client';
import CronList from './crons/CronList';
import CronLogViewer from './crons/CronLogViewer';

export default function CronsPanel() {
  const [data, setData] = createSignal<CronListResponse | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [selected, setSelected] = createSignal<string | null>(null);

  const client = () => daemonStore.state.client;

  async function refresh() {
    const c = client();
    if (!c) return;
    const r = await c.cronList();
    if (!r.ok) {
      setError(`/cron/list → ${r.status} ${r.body.slice(0, 120)}`);
      setLoading(false);
      return;
    }
    setError(null);
    setData(r.data);
    setLoading(false);
    if (!selected() && r.data.jobs.length > 0) setSelected(r.data.jobs[0]?.id ?? null);
  }

  onMount(() => { void refresh(); });

  // Refresh the list on any cron lifecycle event so `running`,
  // `next_run`, and the row dots stay live. The log viewer subscribes
  // separately for its own per-line tail.
  createEffect(() => {
    const ws = daemonStore.state.ws;
    if (!ws) return;
    const types = ['cron.fired', 'cron.finished', 'cron.skipped', 'cron.error', 'cron.timeout'];
    const unsubs = types.map((t) => ws.on(t, () => { void refresh(); }));
    onCleanup(() => { for (const u of unsubs) u(); });
  });

  async function trigger(id: string) {
    const c = client();
    if (!c) return;
    const r = await c.cronTrigger(id);
    if (!r.ok) {
      log.warn('cron trigger failed', id, r.status, r.body);
      await mcAlert(
        r.status === 404
          ? 'Trigger refused — the daemon reports the job is unknown or already running.'
          : `Trigger failed (${r.status}). ${r.body.slice(0, 200)}`,
        { title: 'Could not trigger', okLabel: 'OK' },
      );
      return;
    }
    void refresh();
  }

  async function cancel(id: string) {
    const c = client();
    if (!c) return;
    const r = await c.cronCancel(id);
    if (!r.ok) {
      log.warn('cron cancel failed', id, r.status, r.body);
      await mcAlert(`Cancel failed (${r.status}).`, { title: 'Could not cancel', okLabel: 'OK' });
      return;
    }
    void refresh();
  }

  const selectedJob = (): CronJob | null => {
    const jobs = data()?.jobs ?? [];
    const id = selected();
    return jobs.find((j) => j.id === id) ?? null;
  };

  return (
    <div class="flex-1 flex flex-col min-h-0 max-w-[1600px] mx-auto w-full px-5 py-6 gap-4">
      <header class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-lg font-bold text-gray-100">Crons</h1>
          <p class="text-xs text-gray-500 mt-0.5">
            Jobs declared in <span class="font-mono text-gray-400">cluster.yaml.crons</span>.
            One daemon (the <span class="font-mono">crons_owner</span>) actually fires them;
            others observe.
          </p>
        </div>
        <Show when={data()}>
          {(d) => (
            <div class="flex items-center gap-2 text-[11px] font-mono">
              <span class="px-2 py-1 rounded-md bg-gray-900/60 border border-gray-800 text-gray-400">
                tick {d().tick_sec}s
              </span>
              <span class="px-2 py-1 rounded-md bg-gray-900/60 border border-gray-800 text-gray-400 truncate max-w-[200px]" title={d().identity}>
                {d().identity}
              </span>
              <button
                type="button"
                onClick={() => uiStore.setActiveZone('architect')}
                class="px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
              >
                ← Architect
              </button>
            </div>
          )}
        </Show>
      </header>

      <Show when={error()}>
        <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 font-mono">{error()}</div>
      </Show>

      <Show
        when={!loading()}
        fallback={
          <div class="flex-1 flex items-center justify-center text-xs text-gray-500">
            Loading <span class="font-mono ml-1">/cron/list</span>…
          </div>
        }
      >
        <Show
          when={data()}
          fallback={null}
        >
          {(d) => (
            <div class="flex-1 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 min-h-0">
              <div class="min-h-0 overflow-y-auto">
                <CronList
                  jobs={d().jobs}
                  selectedId={selected()}
                  coordinator={d().coordinator}
                  onSelect={setSelected}
                  onTrigger={trigger}
                  onCancel={cancel}
                />
              </div>
              <div class="min-h-0 flex flex-col gap-3">
                <Show
                  when={selectedJob()}
                  fallback={
                    <div class="flex-1 flex items-center justify-center text-xs text-gray-500 border border-dashed border-gray-800/60 rounded-lg">
                      Select a job to see its event tail.
                    </div>
                  }
                >
                  {(j) => (
                    <>
                      <div class="rounded-lg border border-gray-800/60 bg-gray-900/30 px-3 py-2">
                        <div class="flex items-center gap-2">
                          <h2 class="text-sm font-semibold text-gray-100">{j().name}</h2>
                          <span class="text-[10px] font-mono text-gray-500">{j().id}</span>
                          <Show when={j().destructive}>
                            <span class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-red-300 font-mono">destructive</span>
                          </Show>
                        </div>
                        <p class="text-[11px] font-mono text-gray-500 mt-1">{j().schedule} · max {j().max_runtime_sec}s · {j().restart_policy}</p>
                        <pre class="text-[11px] font-mono text-gray-400 mt-2 bg-gray-950/60 border border-gray-800/60 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all">{j().cmd}</pre>
                      </div>
                      <CronLogViewer jobId={j().id} />
                    </>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
