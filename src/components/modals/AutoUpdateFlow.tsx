/**
 * AutoUpdateFlow — V79 silent self-update flow.
 *
 * 5 steps (asking / downloading / starting / reconnecting / stopping-old)
 * drive POST /self-update then switchProject(newPort). Cancel → resume
 * card (resume / fallback V47 / dismiss). 409 → busy card (cancel-turns
 * / wait-30s / fallback / dismiss). Floating; rail stays clickable.
 */

import { JSX, Show, Switch, Match, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { daemonStore } from '~/state/daemon';
import { activeProject } from '~/state/projects';
import { MIN_DAEMON_VERSION } from '~/lib/version';
import { switchProject } from '~/components/ProjectsRailRow';
import { discoverProjects } from '~/components/ProjectsRail';
import { openDaemonOutdatedModal } from './DaemonOutdatedModal';
import { log } from '~/lib/log';

type Phase =
  | { kind: 'step'; idx: number; sub?: string }
  | { kind: 'busy'; convs: string[] }
  | { kind: 'resume' }
  | { kind: 'done'; newPort: number };

const STEPS = [
  'Asking the daemon to update itself',
  'Downloading + validating the new daemon',
  'Starting the replacement on a fresh port',
  'Reconnecting the cockpit',
  'Stopping the old daemon',
];

const PRI = 'px-3 py-2 rounded bg-emerald-500 text-gray-950 text-sm font-semibold hover:bg-emerald-400 transition';
const SEC = 'px-3 py-2 rounded bg-gray-900 text-gray-300 border border-gray-800 text-sm hover:text-gray-100 transition';
const MUT = 'px-3 py-2 rounded bg-gray-900 text-gray-400 border border-gray-800 text-sm hover:text-gray-200 transition';
const GHO = 'px-3 py-2 rounded text-gray-500 text-sm hover:text-gray-300 transition';

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
const cluster = (): string => { const p = activeProject(); return p?.cluster_name ?? p?.base ?? 'this project'; };
const running = (): string => daemonStore.state.version?.raw ?? daemonStore.state.health?.version ?? 'unknown';

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

const ICON_PATHS: Record<string, JSX.Element> = {
  spin: <path d="M21 12a9 9 0 11-6.219-8.56" />,
  warn: <><path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
};

function Head(props: { tone: 'green' | 'amber'; icon: 'spin' | 'warn' | 'clock' | 'check'; title: JSX.Element; sub: JSX.Element }): JSX.Element {
  const ring = props.tone === 'green' ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-amber-500/15 border-amber-500/30';
  const c = props.tone === 'green' ? '#34d399' : '#fbbf24';
  const sw = props.icon === 'check' ? '2.4' : '2';
  return (
    <div class="flex items-center gap-2 mb-3">
      <div class={`w-8 h-8 rounded-lg ${ring} border flex items-center justify-center shrink-0`}>
        <svg viewBox="0 0 24 24" fill="none" stroke={c} stroke-width={sw} width="14" height="14" class={props.icon === 'spin' ? 'animate-spin' : ''}>{ICON_PATHS[props.icon]}</svg>
      </div>
      <div class="min-w-0">
        <h3 class="text-base font-semibold leading-tight text-gray-100">{props.title}</h3>
        <p class="text-[11px] text-gray-500 font-mono truncate">{props.sub}</p>
      </div>
    </div>
  );
}

function StepView(props: { idx: number; sub?: string }): JSX.Element {
  return (
    <>
      <Head tone="green" icon="spin"
        title={<>Updating <span class="text-emerald-300">{cluster()}</span></>}
        sub={<>running <span class="text-amber-300">{running()}</span> → needs <span class="text-emerald-300">{MIN_DAEMON_VERSION}</span></>} />
      <ol class="mb-3 space-y-1.5">
        {STEPS.map((label, i) => {
          const done = i < props.idx, active = i === props.idx;
          const dot = done ? '✓' : active ? '◇' : '·';
          const color = done ? '#34d399' : active ? '#fbbf24' : '#6b7280';
          return (
            <li class="flex items-center gap-2 text-[12.5px]">
              <span class="font-mono w-3.5" style={{ color }}>{dot}</span>
              <span class={active ? 'text-gray-100 font-semibold' : 'text-gray-400'}>{label}</span>
            </li>
          );
        })}
      </ol>
      <Show when={props.sub}><p class="text-[11px] text-gray-500 font-mono mb-3 pl-[22px]">{props.sub}</p></Show>
      <button type="button" class={MUT} onClick={() => { cancelled = true; setPhase({ kind: 'resume' }); }}>Cancel — I'll do it manually</button>
      <p class="text-[10px] text-gray-600 mt-3">Auto-update runs per <code class="font-mono">cluster.yaml.daemon.auto_update</code>. Set false to require explicit confirmation in the future.</p>
    </>
  );
}

function ResumeView(): JSX.Element {
  return (
    <>
      <Head tone="amber" icon="warn"
        title={<>Auto-update cancelled</>}
        sub={<>{cluster()} stays on {running()} (read-only)</>} />
      <p class="text-[12px] text-gray-300 mb-3 leading-relaxed">You can resume it any time, or fall back to the manual / agent paths.</p>
      <div class="flex flex-col gap-2">
        <button type="button" class={PRI} onClick={() => { setPhase({ kind: 'step', idx: 0 }); void runFlow(); }}>Resume auto-update</button>
        <button type="button" class={SEC} onClick={fallback}>Use manual / agent options instead</button>
        <button type="button" class={GHO} onClick={dismiss}>Dismiss — leave it locked</button>
      </div>
    </>
  );
}

function BusyView(props: { convs: string[] }): JSX.Element {
  const [waitSecs, setWaitSecs] = createSignal<number | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  onCleanup(() => { if (timer) clearInterval(timer); });
  const startWait = (): void => {
    let s = 30;
    setWaitSecs(s);
    timer = setInterval(() => {
      s -= 1;
      if (s > 0) { setWaitSecs(s); return; }
      if (timer) clearInterval(timer);
      timer = null;
      setWaitSecs(null);
      void runFlow();
    }, 1000);
  };
  const line = props.convs.length ? 'Active conv(s): ' + props.convs.join(', ') : 'A chat turn is in progress.';
  return (
    <>
      <Head tone="amber" icon="clock" title={<>Daemon is busy</>} sub={<>{line}</>} />
      <p class="text-[12px] text-gray-300 mb-4 leading-relaxed">
        The auto-update refuses to swap a daemon mid-conversation — it would orphan the running <code class="font-mono">claude -p</code> process. Pick how you want to handle it:
      </p>
      <div class="flex flex-col gap-2">
        <button type="button" class={PRI} onClick={() => void cancelTurnsAndRetry()}>Cancel the running turn(s) + retry update</button>
        <button type="button" disabled={waitSecs() !== null} class={`${SEC} disabled:opacity-60`} onClick={startWait}>
          {waitSecs() !== null ? `Retrying in ${waitSecs()}s…` : 'Wait — retry in 30s'}
        </button>
        <button type="button" class={MUT} onClick={fallback}>Update manually instead</button>
        <button type="button" class={GHO} onClick={dismiss}>Dismiss — leave it locked</button>
      </div>
      <p class="text-[10px] text-gray-600 mt-3">Cancelling the turn aborts the agent's current reply; you can re-ask later.</p>
    </>
  );
}

function DoneView(props: { newPort: number }): JSX.Element {
  return (
    <>
      <Head tone="green" icon="check"
        title={<>{cluster()} is up to date</>}
        sub={<>now running on port <span class="text-emerald-300">{props.newPort}</span></>} />
      <p class="text-[12px] text-gray-300 leading-relaxed">Switching the cockpit over… you'll be back to work in a second.</p>
    </>
  );
}

export function AutoUpdateFlowHost(): JSX.Element {
  return (
    <Show when={isOpen()}>
      <Portal mount={document.body}>
        <div class="fixed inset-0 z-[55] flex items-center justify-center p-4 pointer-events-none">
          <div class="max-w-xl w-full rounded-xl shadow-2xl p-5 bg-[#0b1220] border border-gray-700/40 pointer-events-auto">
            <Switch>
              <Match when={phase().kind === 'step' && (phase() as Extract<Phase, { kind: 'step' }>)}>{(p) => <StepView idx={p().idx} sub={p().sub} />}</Match>
              <Match when={phase().kind === 'busy' && (phase() as Extract<Phase, { kind: 'busy' }>)}>{(p) => <BusyView convs={p().convs} />}</Match>
              <Match when={phase().kind === 'resume'}><ResumeView /></Match>
              <Match when={phase().kind === 'done' && (phase() as Extract<Phase, { kind: 'done' }>)}>{(p) => <DoneView newPort={p().newPort} />}</Match>
            </Switch>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
