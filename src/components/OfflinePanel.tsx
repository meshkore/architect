/**
 * OfflinePanel — V86b.
 *
 * Renders inside the cockpit body when the operator selected a row
 * whose daemon isn't reachable. Tells them exactly how to bring the
 * daemon up: either a one-line shell command to run inside the
 * project folder, or a prompt to hand to their local code agent.
 *
 * Selection lives in `daemonStore.state.offlineSelection`. The rail
 * row stays highlighted green so the operator can still hit the
 * trash icon to forget the project.
 */

import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { daemonStore, type OfflineSelection } from '~/state/daemon';
import { switchProject } from '~/components/ProjectsRailRow';
import { daemonHttpBase } from '~/lib/transport';
import { log } from '~/lib/log';
import * as kp from '~/lib/known-projects';

const WATCH_INTERVAL_MS = 2000;
const WATCH_TIMEOUT_MS = 800;

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
  // V86g — auto-watcher. Once the offline panel opens, poll the
  // target port's /health every 2s. The instant the daemon answers
  // we call switchProject(); attachClient clears `offlineSelection`,
  // the cockpit's Show flips back to the 3-col body. No manual
  // refresh needed — the operator runs `daemon.py` in their terminal
  // and the cockpit picks it up.
  const [watching, setWatching] = createSignal(true);
  const [elapsedSec, setElapsedSec] = createSignal(0);

  // Re-run whenever `watching` toggles or the target port changes.
  // Each fresh run resets the elapsed counter, schedules the next
  // probe via setTimeout (no setInterval pile-up if a probe is slow),
  // and registers its own cleanup so the previous run's timers stop.
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
          // switchProject probes again + attaches. attachClient clears
          // `offlineSelection`, so the OfflinePanel unmounts and the
          // 3-col cockpit renders. This createEffect's cleanup fires
          // automatically when sel becomes null.
          void switchProject(port, props.sel.key, {
            display: props.sel.display,
            cluster_id: props.sel.cluster_id,
            cluster_name: props.sel.cluster_name,
          });
          return;
        }
      } catch { /* not up yet — keep ticking */ }
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

  const command = () => {
    const port = props.sel.port;
    return `python3 .meshkore/scripts/daemon.py --port ${port}`;
  };

  const agentPrompt = () => {
    const port = props.sel.port;
    const cid = props.sel.cluster_id ? ` (cluster_id=${props.sel.cluster_id})` : '';
    return (
      `Please start the MeshKore daemon for this project${cid} on port ${port}. ` +
      `Run: \`python3 .meshkore/scripts/daemon.py --port ${port}\` in this folder. ` +
      `The architect cockpit at https://architect.meshkore.com will reconnect ` +
      `automatically once /health responds.`
    );
  };

  const reasonText = () => {
    switch (props.sel.reason) {
      case 'no-daemon':
        return 'No daemon answered on this port. Either it never started, ' +
               'crashed, or the port changed.';
      case 'tls':
        return 'A daemon is listening, but the TLS handshake failed. Most ' +
               'likely an older daemon serving plain HTTP — upgrade it to ' +
               'py-1.8.x and drop the tls/ bundle next to daemon.py.';
      default:
        return 'The daemon couldn\'t be reached.';
    }
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
          </div>
          <p class="offline-panel__subtitle">{reasonText()}</p>
        </header>

        <div class="offline-panel__steps">
          <Step
            n={1}
            title="Open a terminal in the project folder"
            hint={props.repoPath ? `cd ${props.repoPath}` : 'cd into your project directory'}
            code={props.repoPath ? `cd "${props.repoPath}"` : null}
          />
          <Step
            n={2}
            title="Start the daemon"
            hint="One-liner — assumes .meshkore/scripts/daemon.py exists."
            code={command()}
          />
          <Step
            n={3}
            title="Or ask your local code agent"
            hint="Paste this prompt into Claude Code / Cursor / Cline in the project root."
            code={agentPrompt()}
            multiline
          />
        </div>

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
              Watching <code>/health</code> on port {props.sel.port} — {elapsedSec()}s elapsed.
              The cockpit will reconnect the moment the daemon answers.
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
            If you've decided this project is gone for good, use the
            trash icon on the rail row to remove it.
          </p>
        </footer>
      </div>
    </section>
  );
}

function Step(props: { n: number; title: string; hint: string; code: string | null; multiline?: boolean }) {
  const [copied, setCopied] = createSignal(false);
  const onCopy = async () => {
    if (!props.code) return;
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard denied */ }
  };
  return (
    <div class="offline-step">
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
    </div>
  );
}
