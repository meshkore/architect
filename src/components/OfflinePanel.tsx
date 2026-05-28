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
import { liveClusters } from '~/components/projects-rail/discovery';
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
  // V86m — diagnose state. `tls-missing` is set when the HTTPS probe
  // fails but a fallback HTTP probe to localhost succeeds — meaning
  // the daemon IS running, it just lacks the tls/ bundle so the
  // HTTPS-only cockpit can't speak to it. Requires the daemon to
  // serve `Access-Control-Allow-Private-Network: true` (py-1.9.1+)
  // so Chrome's LNA preflight doesn't block the fallback probe.
  // Older daemons stay in 'unknown' — the panel falls back to its
  // generic "covers both cases" prompt.
  const [diagnose, setDiagnose] = createSignal<'unknown' | 'tls-missing'>('unknown');

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
      // V86m — HTTPS probe failed. Try plain HTTP localhost as a
      // diagnostic. If it succeeds, the daemon IS running and the
      // problem is missing TLS. Requires the daemon to opt into
      // Chrome's LNA via the Access-Control-Allow-Private-Network
      // header (py-1.9.1+). Older daemons → fetch throws, no flip.
      if (diagnose() === 'unknown' && !cancelled) {
        try {
          const r2 = await fetch(`http://localhost:${port}/health`, {
            signal: AbortSignal.timeout(WATCH_TIMEOUT_MS),
          });
          if (r2.ok) {
            log.warn('[OfflinePanel] daemon answers HTTP but not HTTPS — TLS bundle missing', { port });
            setDiagnose('tls-missing');
          }
        } catch { /* both fail — daemon really is dead */ }
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

  // V86l — reactive reconciliation. If a manual Rescan (or any other
  // discovery sweep) finds the offline-selected cluster_id alive at
  // a DIFFERENT port than the one we're watching, switch to that
  // port automatically. Covers the "daemon migrated to a new port"
  // case without making the operator click anything.
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

  const startCommand = () => `python3 .meshkore/scripts/daemon.py --port ${props.sel.port}`;
  const shutdownCommand = () => {
    // V86m — Operator runs this when the port is already bound but the
    // cockpit can't speak to the daemon over TLS (typical: pre-py-1.8
    // daemon serving plain HTTP). The shutdown is unauthenticated only
    // when invoked from the same machine via curl localhost; from the
    // cockpit we'd need a token. So we hand the operator a curl line.
    return `curl -s -X POST http://localhost:${props.sel.port}/shutdown ` +
           `-H "Authorization: Bearer $(cat .meshkore/credentials/portal-token)"`;
  };
  const upgradeCommand = () => {
    // Sync this project's daemon.py + tls/ bundle from a known-good
    // peer (meshkore-main checkout). The operator's local code agent
    // can adjust the source path. Without the bundle, the cockpit's
    // HTTPS transport can't speak to the daemon.
    return [
      'cp ~/Documents/Prj/asimovia/meshkore/.meshkore/scripts/daemon.py .meshkore/scripts/daemon.py',
      'cp -R ~/Documents/Prj/asimovia/meshkore/.meshkore/scripts/tls .meshkore/scripts/tls',
    ].join(' && \\\n');
  };

  const agentPrompt = () => {
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
    - shutdown the running daemon (curl localhost is fine):
      \`curl -s -X POST http://localhost:${port}/shutdown -H "Authorization: Bearer $(cat .meshkore/credentials/portal-token)"\`
    - copy a recent daemon.py + tls/ bundle from a peer project (e.g.
      \`~/Documents/Prj/asimovia/meshkore/.meshkore/scripts/{daemon.py,tls/}\`)
      into THIS project's \`.meshkore/scripts/\`.
    - restart: \`python3 .meshkore/scripts/daemon.py --port ${port}\`

The cockpit will auto-reconnect the moment /health responds over HTTPS at
https://daemon.meshkore.com:${port}/health.`
    );
  };

  const headerText = () => {
    if (diagnose() === 'tls-missing') {
      return (
        `Daemon detected on :${props.sel.port} but it's serving plain HTTP — ` +
        `the cockpit only speaks HTTPS via daemon.meshkore.com. ` +
        `Fix by syncing the TLS bundle and restarting (steps 1 & 3 below). ` +
        `Once /health responds over HTTPS the cockpit reconnects automatically.`
      );
    }
    return (
      `Can't reach the daemon at https://daemon.meshkore.com:${props.sel.port}. ` +
      `Either it's not running, OR it's running but missing the TLS bundle ` +
      `(plain HTTP daemons can't talk to the HTTPS cockpit). The browser ` +
      `can't tell the two apart, so the prompt below covers both paths — the ` +
      `code agent in step 4 picks the right one after a quick check.`
    );
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
          <p class="offline-panel__subtitle">{headerText()}</p>
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
            title="If the daemon isn't running yet — start it"
            hint="One-liner. Assumes .meshkore/scripts/daemon.py + tls/ bundle are in place."
            code={startCommand()}
          />
          <Step
            n={3}
            title="If the port is already bound — the daemon is missing TLS"
            hint="Shut it down, sync daemon.py + tls/ from a healthy peer, restart. The cockpit only speaks HTTPS so plain-HTTP daemons stay invisible."
            code={[shutdownCommand(), upgradeCommand(), startCommand()].join('\n\n# then\n')}
            multiline
          />
          <Step
            n={4}
            title="Or hand the whole job to your local code agent"
            hint="Paste this into Claude Code / Cursor / Cline in the project root — it covers both paths above."
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
