/**
 * AutoUpdateFlow — V79 silent self-update flow. Sub-views live in
 * `./auto-update/views.tsx`.
 */

import { JSX, Show, Switch, Match, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import { daemonStore } from '~/state/daemon';
import { activeProject } from '~/state/projects';
import { switchProject } from '~/components/ProjectsRailRow';
import { discoverProjects } from '~/components/ProjectsRail';
import { openDaemonOutdatedModal } from './DaemonOutdatedModal';
import { StepView, ResumeView, BusyView, DoneView } from './auto-update/views';
import { log } from '~/lib/log';

type Phase =
  | { kind: 'step'; idx: number; sub?: string }
  | { kind: 'busy'; convs: string[] }
  | { kind: 'resume' }
  | { kind: 'done'; newPort: number };

const [isOpen, setIsOpen] = createSignal(false);
const [phase, setPhase] = createSignal<Phase>({ kind: 'step', idx: 0 });
let cancelled = false;
let runToken = 0;

export const isAutoUpdating = (): boolean => isOpen();

export function openAutoUpdateFlow(): void {
  if (isOpen()) return;
  cancelled = false;
  setPhase({ kind: 'step', idx: 0 });
  setIsOpen(true);
  void runFlow();
}

const dismiss = (): void => { cancelled = true; setIsOpen(false); };
const fallback = (): void => { setIsOpen(false); openDaemonOutdatedModal(); };

async function sleep(ms: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (cancelled) return;
    await new Promise((r) => setTimeout(r, Math.min(120, ms - (Date.now() - start))));
  }
}

async function runFlow(): Promise<void> {
  const myRun = ++runToken;
  cancelled = false;
  const client = daemonStore.state.client;
  if (!client) { dismiss(); return; }
  setPhase({ kind: 'step', idx: 0 });
  try {
    const r = await client.selfUpdate({});
    if (myRun !== runToken || cancelled) return;
    if (!r.ok && r.status === 409) {
      let convs: string[] = [];
      try {
        const d = JSON.parse(r.body) as { convs?: unknown };
        if (Array.isArray(d.convs)) convs = d.convs.filter((c): c is string => typeof c === 'string');
      } catch { /* not JSON */ }
      setPhase({ kind: 'busy', convs });
      return;
    }
    if (!r.ok) { log.warn('[auto-update] /self-update failed', r.status, r.body); fallback(); return; }
    const { new_port, new_pid } = r.data;
    setPhase({ kind: 'step', idx: 1, sub: 'spawn pid ' + new_pid });
    await sleep(400); if (myRun !== runToken || cancelled) return;
    setPhase({ kind: 'step', idx: 2, sub: 'new port :' + new_port });
    await sleep(3500); if (myRun !== runToken || cancelled) return;
    setPhase({ kind: 'step', idx: 3 });
    try { await discoverProjects({ fullScan: true }); } catch { /* swallow */ }
    if (myRun !== runToken || cancelled) return;
    setPhase({ kind: 'step', idx: 4 });
    await sleep(500); if (myRun !== runToken || cancelled) return;
    setPhase({ kind: 'done', newPort: new_port });
    await sleep(400); if (myRun !== runToken || cancelled) return;
    const p = activeProject();
    try { switchProject(new_port, p?.cluster_id ?? `port:${new_port}`); }
    catch (err) { log.warn('[auto-update] switchProject failed', err); window.location.reload(); }
  } catch (err) {
    if (myRun !== runToken) return;
    log.warn('[auto-update] flow threw', err);
    fallback();
  }
}

async function cancelTurnsAndRetry(): Promise<void> {
  const p = phase();
  if (p.kind !== 'busy') return;
  const client = daemonStore.state.client;
  for (const c of p.convs) {
    try { await client?.chatCancel(c); }
    catch (err) { log.warn('[auto-update] chatCancel failed for conv=' + c, err); }
  }
  await new Promise((r) => setTimeout(r, 600));
  void runFlow();
}

export function AutoUpdateFlowHost(): JSX.Element {
  const cancelToResume = () => { cancelled = true; setPhase({ kind: 'resume' }); };
  const resume = () => { setPhase({ kind: 'step', idx: 0 }); void runFlow(); };

  return (
    <Show when={isOpen()}>
      <Portal mount={document.body}>
        <div class="fixed inset-0 z-[55] flex items-center justify-center p-4 pointer-events-none">
          <div class="max-w-xl w-full rounded-xl shadow-2xl p-5 bg-[#0b1220] border border-gray-700/40 pointer-events-auto">
            <Switch>
              <Match when={phase().kind === 'step' && (phase() as Extract<Phase, { kind: 'step' }>)}>
                {(p) => <StepView idx={p().idx} sub={p().sub} onCancel={cancelToResume} />}
              </Match>
              <Match when={phase().kind === 'busy' && (phase() as Extract<Phase, { kind: 'busy' }>)}>
                {(p) => <BusyView convs={p().convs} onCancelTurns={() => void cancelTurnsAndRetry()} onFallback={fallback} onDismiss={dismiss} onRetry={() => void runFlow()} />}
              </Match>
              <Match when={phase().kind === 'resume'}>
                <ResumeView onResume={resume} onFallback={fallback} onDismiss={dismiss} />
              </Match>
              <Match when={phase().kind === 'done' && (phase() as Extract<Phase, { kind: 'done' }>)}>
                {(p) => <DoneView newPort={p().newPort} />}
              </Match>
            </Switch>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
