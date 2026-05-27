/**
 * AutoUpdateFlow — V79 silent self-update flow. Sub-views live in
 * `./auto-update/views.tsx`.
 */

import { JSX, Show, Switch, Match, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import { daemonStore } from '~/state/daemon';
import { discoverProjects } from '~/components/ProjectsRail';
import { openDaemonOutdatedModal } from './DaemonOutdatedModal';
import { StepView, ResumeView, BusyView, DoneView, ErrorView } from './auto-update/views';
import { daemonHttpBase } from '~/lib/transport';
import { log } from '~/lib/log';

type Phase =
  | { kind: 'step'; idx: number; sub?: string }
  | { kind: 'busy'; convs: string[] }
  | { kind: 'resume' }
  | { kind: 'done'; newPort: number }
  | { kind: 'error'; reason: string; newPort?: number };

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

/** Poll /health on the new daemon until it answers or we give up.
 *  Each retry is ~600 ms; total budget ~12 s. Tolerates the brief
 *  window between spawn() and the new daemon binding its port +
 *  loading TLS. Returns the parsed health body on success. */
async function awaitNewDaemon(port: number, runId: number): Promise<unknown | null> {
  const url = `${daemonHttpBase(port)}/health`;
  for (let i = 0; i < 20; i += 1) {
    if (runId !== runToken || cancelled) return null;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (r.ok) {
        const data = await r.json().catch(() => null);
        if (data) return data;
      }
    } catch { /* not up yet — keep polling */ }
    await sleep(600);
  }
  return null;
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
    if (!r.ok) {
      log.warn('[auto-update] /self-update failed', r.status, r.body);
      setPhase({ kind: 'error', reason: `Daemon refused the update: ${r.status} ${r.body.slice(0, 200)}` });
      return;
    }
    const { new_port, new_pid } = r.data;
    setPhase({ kind: 'step', idx: 1, sub: 'spawn pid ' + new_pid });
    await sleep(400); if (myRun !== runToken || cancelled) return;
    setPhase({ kind: 'step', idx: 2, sub: 'new port :' + new_port });
    // V86 — wait until the new daemon actually answers /health on
    // the new port. The previous fixed 3.5 s sleep was a guess;
    // production has shown the new process can take longer to bind +
    // load TLS, and the cockpit ended up alert()-ing "No daemon on
    // port N" right after declaring "all done".
    const newHealth = await awaitNewDaemon(new_port, myRun);
    if (myRun !== runToken || cancelled) return;
    if (!newHealth) {
      setPhase({
        kind: 'error',
        newPort: new_port,
        reason:
          `The new daemon spawned (pid ${new_pid}) on port ${new_port} but didn't answer ` +
          `/health after ~12 s. It may still be loading; retry, or open a terminal in the ` +
          `repo and run \`python3 .meshkore/scripts/daemon.py --port ${new_port}\` manually.`,
      });
      return;
    }
    setPhase({ kind: 'step', idx: 3 });
    try { await discoverProjects({ fullScan: true }); } catch { /* swallow */ }
    if (myRun !== runToken || cancelled) return;
    setPhase({ kind: 'step', idx: 4 });
    await sleep(500); if (myRun !== runToken || cancelled) return;
    setPhase({ kind: 'done', newPort: new_port });
    await sleep(400); if (myRun !== runToken || cancelled) return;
    // Switch the cockpit to the new daemon. Await the result so we
    // surface failures INSIDE the modal instead of an alert().
    const ok = await daemonStore.switchToPort(new_port);
    if (myRun !== runToken || cancelled) return;
    if (!ok) {
      setPhase({
        kind: 'error',
        newPort: new_port,
        reason:
          `The new daemon answered /health but the cockpit couldn't attach to it. ` +
          `This is usually a TLS handshake failure — make sure the new daemon picked ` +
          `up the tls/ bundle. Click Retry to try again, or use the manual options.`,
      });
      return;
    }
    // Attach succeeded — close the modal. daemonStore.outdated will
    // flip back to false on its own; Cockpit re-mounts the columns.
    setIsOpen(false);
  } catch (err) {
    if (myRun !== runToken) return;
    log.warn('[auto-update] flow threw', err);
    setPhase({
      kind: 'error',
      reason: err instanceof Error ? err.message : String(err),
    });
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
              <Match when={phase().kind === 'error' && (phase() as Extract<Phase, { kind: 'error' }>)}>
                {(p) => <ErrorView reason={p().reason} newPort={p().newPort} onRetry={() => void runFlow()} onFallback={fallback} onDismiss={dismiss} />}
              </Match>
            </Switch>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
