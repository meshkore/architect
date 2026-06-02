/**
 * OfflinePanel — V107.27 (wizard rewrite).
 *
 * Renders inside the cockpit body when the operator selected a row
 * whose daemon isn't reachable. Wizard with three layers:
 *
 *   1. Diagnosis line — one sentence in plain language.
 *   2. Two big buttons — "I'll start it myself" / "Hand it to my
 *      local code agent". Optionally a third tiny link for "show me
 *      the raw curl repair" (TLS-missing case).
 *   3. Whichever path the operator picked expands inline. Step by
 *      step. Each step is a card with a label, a hint, and a single
 *      copy-to-clipboard button. Other paths stay hidden.
 *
 * The auto-watcher (poll /health every 2s, switch the moment it
 * answers) is unchanged from V86b — it lives at the bottom and is
 * always visible regardless of which path is open. Pre-V107.27 the
 * panel dumped all four steps simultaneously (terminal cd + start +
 * shutdown+sync+restart + agent prompt) and operators reported it
 * as a wall of shell commands they couldn't navigate.
 *
 * Selection lives in `daemonStore.state.offlineSelection`. The rail
 * row stays highlighted so the operator can still hit the trash icon
 * to forget the project.
 */

import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { daemonStore, type OfflineSelection } from '~/state/daemon';
import { switchProject } from '~/components/ProjectsRailRow';
import { liveClusters } from '~/components/projects-rail/discovery';
import { daemonHttpBase } from '~/lib/transport';
import { log } from '~/lib/log';
import * as kp from '~/lib/known-projects';

const WATCH_INTERVAL_MS = 2000;
const WATCH_TIMEOUT_MS = 800;

type Flow = 'choose' | 'manual' | 'agent';
type Diagnose = 'unknown' | 'tls-missing';

export default function OfflinePanel() {
  const sel = (): OfflineSelection | null => daemonStore.state.offlineSelection;

  const repoPath = createMemo<string | null>(() => {
    const s = sel();
    if (!s) return null;
    const entry = kp.list().find((p) =>
      (s.cluster_id ? p.cluster_id === s.cluster_id : !p.cluster_id && p.port === s.port),
    );
    return entry?.repo_path ?? null;
  });

  return (
    <Show when={sel()}>
      {(s) => <PanelBody sel={s()} repoPath={repoPath()} />}
    </Show>
  );
}

function PanelBody(props: { sel: OfflineSelection; repoPath: string | null }) {
  const [watching, setWatching] = createSignal(true);
  const [elapsedSec, setElapsedSec] = createSignal(0);
  // diagnose 'tls-missing' = HTTPS fails but HTTP localhost succeeds → daemon
  // alive without TLS bundle. Anything else stays 'unknown' and the panel
  // assumes the simpler "not running" case (which is also the most common).
  const [diagnose, setDiagnose] = createSignal<Diagnose>('unknown');
  // V107.27 wizard navigation. 'choose' is the landing; the two big
  // buttons advance to 'manual' or 'agent'. Back-link returns to 'choose'.
  const [flow, setFlow] = createSignal<Flow>('choose');

  // ── Auto-watcher (unchanged from V86g; TLS diagnose from V86m). ──
  createEffect(() => {
    if (!watching()) return;
    const port = props.sel.port;
    let cancelled = false;
    let probeTimer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    setElapsedSec(0);
    const elapsedTimer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    const probe = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const r = await fetch(`${daemonHttpBase(port)}/health`, {
          signal: AbortSignal.timeout(WATCH_TIMEOUT_MS),
        });
        if (r.ok) {
          log.info('[OfflinePanel] daemon answered — switching', { port });
          void switchProject(port, props.sel.key, {
            display: props.sel.display,
            cluster_id: props.sel.cluster_id,
            cluster_name: props.sel.cluster_name,
          });
          return;
        }
      } catch { /* not up yet — keep ticking */ }
      if (diagnose() === 'unknown' && !cancelled) {
        try {
          const r2 = await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(WATCH_TIMEOUT_MS),
          });
          if (r2.ok) {
            log.warn('[OfflinePanel] daemon answers HTTP but not HTTPS — TLS bundle missing', { port });
            setDiagnose('tls-missing');
          }
        } catch (e) {
          log.warn('[OfflinePanel] HTTP fallback probe threw', {
            port, err: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (!cancelled) {
        probeTimer = setTimeout(() => { void probe(); }, WATCH_INTERVAL_MS);
      }
    };
    void probe();

    onCleanup(() => {
      cancelled = true;
      if (probeTimer !== null) clearTimeout(probeTimer);
      clearInterval(elapsedTimer);
    });
  });

  // Reactive port-migration reconciliation (unchanged from V86l).
  createEffect(() => {
    const cid = props.sel.cluster_id;
    if (!cid) return;
    const live = liveClusters().get(cid);
    if (!live) return;
    if (live.port === props.sel.port) return;
    log.info('[OfflinePanel] live discovery surfaced cluster at new port', {
      cluster_id: cid, stale: props.sel.port, live: live.port,
    });
    void switchProject(live.port, props.sel.key, {
      display: props.sel.display,
      cluster_id: props.sel.cluster_id,
      cluster_name: props.sel.cluster_name,
    });
  });

  // ── Commands ────────────────────────────────────────────────────
  const startCommand = (): string => `python3 .meshkore/scripts/daemon.py --port ${props.sel.port}`;
  const shutdownCommand = (): string =>
    `curl -s -X POST http://localhost:${props.sel.port}/shutdown ` +
    `-H "Authorization: Bearer $(cat .meshkore/credentials/portal-token)"`;
  const syncCommand = (): string => [
    'cp ~/Documents/Prj/asimovia/meshkore/.meshkore/scripts/daemon.py .meshkore/scripts/daemon.py',
    'cp -R ~/Documents/Prj/asimovia/meshkore/.meshkore/scripts/tls .meshkore/scripts/tls',
  ].join(' && \\\n');
  const cdCommand = (): string | null =>
    props.repoPath ? `cd "${props.repoPath}"` : null;

  const agentPrompt = (): string => {
    const port = props.sel.port;
    const cid = props.sel.cluster_id ? ` (cluster_id=${props.sel.cluster_id})` : '';
    return (
`The MeshKore architect cockpit at https://architect.meshkore.com can't reach ` +
`this project's daemon${cid} on port ${port}. Diagnose and fix:

1. Check if a daemon is already listening:
   \`lsof -iTCP:${port} -sTCP:LISTEN\`

2a. If NO process owns the port → start the daemon:
    \`python3 .meshkore/scripts/daemon.py --port ${port}\`

2b. If a process IS bound → the daemon is alive but its TLS bundle is missing,
    so the HTTPS-only cockpit can't speak to it. Repair:
    - shutdown the running daemon:
      \`curl -s -X POST http://localhost:${port}/shutdown -H "Authorization: Bearer $(cat .meshkore/credentials/portal-token)"\`
    - copy a recent daemon.py + tls/ bundle from a peer project (e.g.
      \`~/Documents/Prj/asimovia/meshkore/.meshkore/scripts/{daemon.py,tls/}\`)
      into THIS project's \`.meshkore/scripts/\`.
    - restart: \`python3 .meshkore/scripts/daemon.py --port ${port}\`

The cockpit will auto-reconnect the moment /health responds over HTTPS at
https://daemon.meshkore.com:${port}/health.`
    );
  };

  // ── Diagnosis sentence (single line, plain language) ─────────────
  const diagnoseLine = (): string => {
    if (diagnose() === 'tls-missing') {
      return `Port :${props.sel.port} is bound — but the daemon is serving plain HTTP, so the HTTPS-only cockpit can't reach it. Sync the TLS bundle and restart.`;
    }
    return `Most likely the daemon process simply isn't running. Pick one of the two paths below.`;
  };

  return (
    <section class="offline-panel">
      <div class="offline-panel__inner">
        <header class="offline-panel__head">
          <div class="offline-panel__title">
            <span class="offline-panel__dot" aria-hidden="true" />
            <h2>{props.sel.display}</h2>
            <span class="offline-panel__port">:{props.sel.port}</span>
            <Show when={props.sel.cluster_id}>
              {(cid) => <span class="offline-panel__cluster">· {cid()}</span>}
            </Show>
            <span class="offline-panel__pill" data-state={diagnose()}>
              {diagnose() === 'tls-missing' ? 'TLS missing' : 'offline'}
            </span>
          </div>
          <p class="offline-panel__subtitle">{diagnoseLine()}</p>
        </header>

        {/* ── Wizard body ─────────────────────────────────────────── */}
        <Show when={flow() === 'choose'}>
          <ChoiceCards
            onPickManual={() => setFlow('manual')}
            onPickAgent={() => setFlow('agent')}
          />
        </Show>

        <Show when={flow() === 'manual'}>
          <ManualFlow
            tlsMissing={diagnose() === 'tls-missing'}
            cdCommand={cdCommand()}
            startCommand={startCommand()}
            shutdownCommand={shutdownCommand()}
            syncCommand={syncCommand()}
            onBack={() => setFlow('choose')}
          />
        </Show>

        <Show when={flow() === 'agent'}>
          <AgentFlow
            prompt={agentPrompt()}
            onBack={() => setFlow('choose')}
          />
        </Show>

        {/* ── Heartbeat — always visible ─────────────────────────── */}
        <div class="offline-panel__watch" data-state={watching() ? 'on' : 'off'}>
          <Show
            when={watching()}
            fallback={
              <>
                <span class="offline-panel__watch-label">
                  Watcher stopped — the cockpit won't auto-reconnect until you click below.
                </span>
                <button
                  type="button"
                  class="offline-panel__watch-btn is-primary"
                  onClick={() => { setElapsedSec(0); setWatching(true); }}
                >
                  Resume watching :{props.sel.port}
                </button>
              </>
            }
          >
            <span class="offline-panel__watch-dot" aria-hidden="true" />
            <span class="offline-panel__watch-label">
              Watching <code>/health</code> on :{props.sel.port} — {elapsedSec()}s elapsed. The cockpit reconnects the moment the daemon answers.
            </span>
            <button
              type="button"
              class="offline-panel__watch-btn"
              onClick={() => setWatching(false)}
            >
              Stop watching
            </button>
          </Show>
        </div>

        <footer class="offline-panel__foot">
          <p>
            Project is gone for good? Use the trash icon on the rail row to forget it.
          </p>
        </footer>
      </div>
    </section>
  );
}

// ── Wizard pieces ──────────────────────────────────────────────────

function ChoiceCards(props: { onPickManual: () => void; onPickAgent: () => void }) {
  return (
    <div class="offline-choices">
      <button type="button" class="offline-choice" onClick={props.onPickManual}>
        <span class="offline-choice__icon" aria-hidden="true">⌨</span>
        <span class="offline-choice__title">I'll start it myself</span>
        <span class="offline-choice__desc">
          Open a terminal in the project, run a one-line command.
          You'll see each step with a copy button.
        </span>
      </button>
      <button type="button" class="offline-choice" onClick={props.onPickAgent}>
        <span class="offline-choice__icon" aria-hidden="true">✦</span>
        <span class="offline-choice__title">Hand it to my local Claude Code</span>
        <span class="offline-choice__desc">
          Get a ready-to-paste prompt for Claude Code / Cursor / Cline.
          Covers both the "not running" and "missing TLS" cases.
        </span>
      </button>
    </div>
  );
}

function ManualFlow(props: {
  tlsMissing: boolean;
  cdCommand: string | null;
  startCommand: string;
  shutdownCommand: string;
  syncCommand: string;
  onBack: () => void;
}) {
  // Build the linear step list the operator sees. Short-circuit on the
  // TLS-missing diagnose: that case needs shutdown→sync→start (three
  // commands the daemon-already-bound case requires), so we don't try
  // to be clever — show them all, copy buttons make it painless.
  const steps = (): Array<{ label: string; hint: string; code: string | null }> => {
    const out: Array<{ label: string; hint: string; code: string | null }> = [];
    out.push({
      label: 'Open a terminal in the project folder',
      hint: props.cdCommand
        ? "We know the path from this cockpit's known-projects list — copy & paste."
        : "cd into the project's root directory.",
      code: props.cdCommand,
    });
    if (props.tlsMissing) {
      out.push({
        label: 'Shut down the half-broken daemon',
        hint: 'Plain HTTP via localhost is fine — no auth needed for /shutdown there.',
        code: props.shutdownCommand,
      });
      out.push({
        label: 'Sync daemon.py + the TLS bundle from MeshKore Core',
        hint: 'Source path assumes the meshkore monorepo lives at ~/Documents/Prj/asimovia/meshkore. Adjust if yours is elsewhere.',
        code: props.syncCommand,
      });
    }
    out.push({
      label: props.tlsMissing ? 'Start the daemon again' : 'Start the daemon',
      hint: 'Leave this terminal open — the daemon logs to stdout and exits on Ctrl+C. The cockpit will reconnect on its own.',
      code: props.startCommand,
    });
    return out;
  };

  return (
    <div class="offline-flow">
      <button type="button" class="offline-flow__back" onClick={props.onBack}>
        ← back to options
      </button>
      <ol class="offline-flow__steps">
        <For each={steps()}>
          {(s, i) => <Step n={i() + 1} title={s.label} hint={s.hint} code={s.code} />}
        </For>
      </ol>
    </div>
  );
}

function AgentFlow(props: { prompt: string; onBack: () => void }) {
  return (
    <div class="offline-flow">
      <button type="button" class="offline-flow__back" onClick={props.onBack}>
        ← back to options
      </button>
      <Step
        n={1}
        title="Open Claude Code / Cursor / Cline in this project root"
        hint="Whichever local code agent you use — the prompt below is provider-neutral. The agent will need shell + file access."
        code={null}
      />
      <Step
        n={2}
        title="Paste this prompt and let the agent take it"
        hint="The prompt diagnoses (running? bound? TLS?) and fixes the right path. You don't need to read it — just paste."
        code={props.prompt}
        multiline
      />
    </div>
  );
}

function Step(props: { n: number; title: string; hint: string; code: string | null; multiline?: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const onCopy = async (): Promise<void> => {
    if (!props.code) return;
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard denied */ }
  };
  return (
    <li class="offline-step">
      <div class="offline-step__head">
        <span class="offline-step__n">{props.n}</span>
        <h3>{props.title}</h3>
      </div>
      <p class="offline-step__hint">{props.hint}</p>
      <Show when={props.code}>
        <div class={`offline-step__code${props.multiline ? ' is-multiline' : ''}`}>
          <code>{props.code}</code>
          <button type="button" class="offline-step__copy" onClick={onCopy}>
            {copied() ? 'copied' : 'copy'}
          </button>
        </div>
      </Show>
    </li>
  );
}
