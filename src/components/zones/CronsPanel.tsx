import { createSignal, onMount, onCleanup, Show, createEffect } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { mcAlert } from '~/lib/modal';
import { log } from '~/lib/log';
import type { CronJob, CronListResponse } from '~/lib/daemon-client';
import CronList from './crons/CronList';
import CronLogViewer from './crons/CronLogViewer';
import CronJobHeader from './crons/CronJobHeader';
import CronsHeader from './crons/CronsHeader';

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
      <CronsHeader data={data()} />

      <Show when={error()}>
        <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 font-mono">{error()}</div>
      </Show>

      <Show when={!loading()} fallback={
        <div class="flex-1 flex items-center justify-center text-xs text-gray-500">
          Loading <span class="font-mono ml-1">/cron/list</span>…
        </div>
      }>
        <Show when={data()} fallback={null}>
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
                <Show when={selectedJob()} fallback={
                  <div class="flex-1 flex items-center justify-center text-xs text-gray-500 border border-dashed border-gray-800/60 rounded-lg">
                    Select a job to see its event tail.
                  </div>
                }>
                  {(j) => (
                    <>
                      <CronJobHeader job={j()} />
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
