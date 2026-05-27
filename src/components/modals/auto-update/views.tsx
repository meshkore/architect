import { JSX, Show, createSignal, onCleanup } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { activeProject } from '~/state/projects';
import { MIN_DAEMON_VERSION } from '~/lib/version';

export const STEPS = [
  'Asking the daemon to update itself',
  'Downloading + validating the new daemon',
  'Starting the replacement on a fresh port',
  'Reconnecting the cockpit',
  'Stopping the old daemon',
];

export const PRI = 'px-3 py-2 rounded bg-emerald-500 text-gray-950 text-sm font-semibold hover:bg-emerald-400 transition';
export const SEC = 'px-3 py-2 rounded bg-gray-900 text-gray-300 border border-gray-800 text-sm hover:text-gray-100 transition';
export const MUT = 'px-3 py-2 rounded bg-gray-900 text-gray-400 border border-gray-800 text-sm hover:text-gray-200 transition';
export const GHO = 'px-3 py-2 rounded text-gray-500 text-sm hover:text-gray-300 transition';

export const cluster = (): string => { const p = activeProject(); return p?.cluster_name ?? p?.base ?? 'this project'; };
export const running = (): string => daemonStore.state.version?.raw ?? daemonStore.state.health?.version ?? 'unknown';

const ICON_PATHS: Record<string, JSX.Element> = {
  spin: <path d="M21 12a9 9 0 11-6.219-8.56" />,
  warn: <><path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
};

export function Head(props: { tone: 'green' | 'amber'; icon: 'spin' | 'warn' | 'clock' | 'check'; title: JSX.Element; sub: JSX.Element }): JSX.Element {
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

export function StepView(props: { idx: number; sub?: string; onCancel: () => void }): JSX.Element {
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
              {/* dynamic: tri-state colour reflects per-step done/active/pending */}
              <span class="font-mono w-3.5" style={{ color }}>{dot}</span>
              <span class={active ? 'text-gray-100 font-semibold' : 'text-gray-400'}>{label}</span>
            </li>
          );
        })}
      </ol>
      <Show when={props.sub}><p class="text-[11px] text-gray-500 font-mono mb-3 pl-[22px]">{props.sub}</p></Show>
      <button type="button" class={MUT} onClick={props.onCancel}>Cancel — I'll do it manually</button>
      <p class="text-[10px] text-gray-600 mt-3">Auto-update runs per <code class="font-mono">cluster.yaml.daemon.auto_update</code>. Set false to require explicit confirmation in the future.</p>
    </>
  );
}

export function ResumeView(props: { onResume: () => void; onFallback: () => void; onDismiss: () => void }): JSX.Element {
  return (
    <>
      <Head tone="amber" icon="warn"
        title={<>Auto-update cancelled</>}
        sub={<>{cluster()} stays on {running()} (read-only)</>} />
      <p class="text-[12px] text-gray-300 mb-3 leading-relaxed">You can resume it any time, or fall back to the manual / agent paths.</p>
      <div class="flex flex-col gap-2">
        <button type="button" class={PRI} onClick={props.onResume}>Resume auto-update</button>
        <button type="button" class={SEC} onClick={props.onFallback}>Use manual / agent options instead</button>
        <button type="button" class={GHO} onClick={props.onDismiss}>Dismiss — leave it locked</button>
      </div>
    </>
  );
}

export function BusyView(props: { convs: string[]; onCancelTurns: () => void; onFallback: () => void; onDismiss: () => void; onRetry: () => void }): JSX.Element {
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
      props.onRetry();
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
        <button type="button" class={PRI} onClick={props.onCancelTurns}>Cancel the running turn(s) + retry update</button>
        <button type="button" disabled={waitSecs() !== null} class={`${SEC} disabled:opacity-60`} onClick={startWait}>
          {waitSecs() !== null ? `Retrying in ${waitSecs()}s…` : 'Wait — retry in 30s'}
        </button>
        <button type="button" class={MUT} onClick={props.onFallback}>Update manually instead</button>
        <button type="button" class={GHO} onClick={props.onDismiss}>Dismiss — leave it locked</button>
      </div>
      <p class="text-[10px] text-gray-600 mt-3">Cancelling the turn aborts the agent's current reply; you can re-ask later.</p>
    </>
  );
}

export function DoneView(props: { newPort: number }): JSX.Element {
  return (
    <>
      <Head tone="green" icon="check"
        title={<>{cluster()} is up to date</>}
        sub={<>now running on port <span class="text-emerald-300">{props.newPort}</span></>} />
      <p class="text-[12px] text-gray-300 leading-relaxed">Switching the cockpit over… you'll be back to work in a second.</p>
    </>
  );
}

/**
 * V86 — Shown inside the auto-update modal when the flow can't
 * complete (daemon refused, new daemon didn't bind in time, cockpit
 * couldn't attach to the new port, etc.). Stays inside the same
 * modal so the operator never sees a native browser alert.
 *
 * Offers three exits: Retry the whole flow, fall back to the manual
 * / agent paths from the chooser modal, or dismiss to leave the
 * project read-only.
 */
export function ErrorView(props: {
  reason: string;
  newPort?: number;
  onRetry: () => void;
  onFallback: () => void;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <>
      <Head tone="amber" icon="warn"
        title={<>Auto-update couldn't finish</>}
        sub={<>{cluster()} stays on {running()} until the next attempt</>} />
      <p class="text-[12.5px] text-gray-300 mb-3 leading-relaxed">{props.reason}</p>
      <Show when={props.newPort}>
        <pre class="text-[11px] font-mono text-emerald-300/90 bg-gray-950 border border-gray-800 rounded p-2 mb-3 whitespace-pre-wrap break-all">cd &lt;repo&gt; && python3 .meshkore/scripts/daemon.py --port {props.newPort}</pre>
      </Show>
      <div class="flex flex-col gap-2">
        <button type="button" class={PRI} onClick={props.onRetry}>Retry the auto-update</button>
        <button type="button" class={SEC} onClick={props.onFallback}>Use manual / agent options instead</button>
        <button type="button" class={GHO} onClick={props.onDismiss}>Dismiss — leave it locked</button>
      </div>
      <p class="text-[10px] text-gray-600 mt-3">Retrying re-runs <code class="font-mono">/self-update</code> from scratch; safe to repeat.</p>
    </>
  );
}
