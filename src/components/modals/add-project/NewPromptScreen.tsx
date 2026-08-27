/**
 * NewPromptScreen — final wizard step.
 *
 * TWO paths, decided at mount:
 *
 *  1. DIRECT REGISTER (daemon-centralized, the common case). If a live central
 *     daemon is already attached (`daemonStore.state.client`), we don't need
 *     the operator to launch anything — one daemon serves every project. We
 *     `POST /projects` straight to it: the daemon scaffolds `.meshkore/` in the
 *     target folder (same schema as `daemon.py init`) and returns the new
 *     cluster id. We then switch the cockpit to it and close the wizard. No
 *     prompt to paste, no port scan (that scan — a full 5570-5589 sweep every
 *     3.5s — was the connection-pool storm that froze the UI in the field).
 *
 *  2. FALLBACK PROMPT + SCAN (legacy / no daemon running). When there's no live
 *     daemon to register against, we fall back to the original flow: render the
 *     genPrompt() payload for the operator to paste into their coding agent,
 *     then watch `liveClusters` for the daemon they launch and switch to it.
 *
 * Detection (fallback): on mount we flip the rail's `scanning()` signal ON —
 * the always-mounted ProjectsRail then runs a bounded full sweep so a
 * brand-new daemon on ANY port is found automatically, no refresh.
 */
import { createSignal, createMemo, createEffect, onMount, Show } from 'solid-js';
import { basename, genPrompt, slugify, type AddProjectAnswers } from './genPrompt';
import { projectsRailScan } from '~/components/ProjectsRail';
import { discoverProjects, liveClusters, type LiveProbe } from '~/components/projects-rail/discovery';
import { switchProject } from '~/lib/project-switch';
import { closeAddProjectWizard } from '~/components/modals/AddProjectWizard';
import { daemonStore } from '~/state/daemon';
import { projectsStore } from '~/state/projects';
import * as kp from '~/lib/known-projects';
import { log } from '~/lib/log';
import WizardStep from './WizardStep';

type RegisterState =
  | { kind: 'idle' } // no direct register attempted → fallback prompt+scan UI
  | { kind: 'registering' }
  | { kind: 'done'; id: string; name: string; scaffolded: boolean }
  | { kind: 'error'; message: string };

/** AX10 — the daemon has 15s to scaffold + register. Past that it is
 *  hung (or unreachable) and the operator gets an error they can act on
 *  instead of a spinner that never resolves. */
const REGISTER_TIMEOUT_MS = 15_000;

/** Beat before the auto-switch so the operator can read the ✓. */
const DONE_PAUSE_MS = 1100;

/** The transport carries a base URL, not a port. Same regex the daemon
 *  store's 401 self-heal uses to map an httpBase back to its port. */
function portOf(httpBase: string): number {
  const m = /:(\d+)(?:\/|$)/.exec(httpBase);
  return m && m[1] ? parseInt(m[1], 10) : 0;
}

/**
 * Map the wizard answers to a POST /projects body, or null when a direct
 * register isn't possible (no target path). The daemon accepts EITHER an
 * explicit `path` (adopt an existing folder) OR `parent` + `name`
 * (create-from-scratch under an allowlisted parent). PathPicker collects the
 * project folder for 'existing' and the PARENT folder for 'new'.
 */
function registerBody(
  a: AddProjectAnswers,
): { path: string; name?: string } | { parent: string; name: string } | null {
  const name = a.projectName.trim();
  const path = a.path.trim();
  if (a.startKind === 'existing') {
    if (!path) return null;
    return name ? { path, name } : { path };
  }
  // 'new' — needs both a parent folder and a name to create-from-scratch.
  if (!path || !name) return null;
  // AX10 (OB-F7) — the PATH field is documented as the PARENT directory and
  // the daemon appends slugify(name) to it, but operators routinely paste the
  // FULL intended path. Unguarded that produced `<parent>/<slug>/<slug>/`.
  // genPrompt.ts has had this basename check since it shipped; the direct
  // register path never did. When the pasted path already ends in the slug it
  // IS the project folder — send it as an explicit `path` instead.
  if (basename(path) === slugify(name)) return { path, name };
  return { parent: path, name };
}

export default function NewPromptScreen(props: { answers: AddProjectAnswers }) {
  const [copied, setCopied] = createSignal(false);
  const [reg, setReg] = createSignal<RegisterState>({ kind: 'idle' });
  const prompt = () => genPrompt(props.answers);

  const liveClient = () => daemonStore.state.client;
  // Direct register is possible when a central daemon is attached AND we have a
  // usable target. Otherwise fall back to the paste-a-prompt + scan flow.
  const canDirect = () => !!liveClient() && !!registerBody(props.answers);

  // ── FALLBACK path state (only used when !canDirect) ──────────────────
  // Cluster ids already live when this screen opened — anything NEW that
  // appears in liveClusters while we watch is the daemon the operator just
  // launched.
  const [baseline, setBaseline] = createSignal<Set<string> | null>(null);
  const [found, setFound] = createSignal<LiveProbe | null>(null);
  let registerAbort: AbortController | null = null;
  let registerCancelled = false;

  onMount(() => {
    if (canDirect()) {
      void doRegister();
      return;
    }
    // Baseline FIRST, sweep second: the rail's watch loop is a full
    // 5570-5589 sweep, so starting it before the baseline is primed
    // could fold the very daemon we are waiting for into the "already
    // existed" set and make it undetectable.
    void (async () => {
      await primeBaseline();
      try { projectsRailScan.start(); } catch (e) { log.warn('projectsRailScan.start failed', e); }
    })();
  });

  /**
   * AX10 (OB-F5) — the baseline used to be a synchronous snapshot of
   * `liveClusters()` at mount. If discovery hadn't completed yet that set
   * was EMPTY, so the first pre-existing project the sweep found was
   * announced as "your new project" and the wizard switched into it.
   * Await one discovery pass, then union with every cluster id the
   * cockpit already knows about — a project that was merely stopped is
   * not new either.
   */
  async function primeBaseline(): Promise<void> {
    try { await discoverProjects(); } catch { /* probe errors are normal */ }
    const seen = new Set<string>(liveClusters().keys());
    for (const p of kp.list()) if (p.cluster_id) seen.add(p.cluster_id);
    setBaseline(seen);
  }

  async function doRegister(): Promise<void> {
    const client = liveClient();
    const body = registerBody(props.answers);
    if (!client || !body) {
      setReg({ kind: 'error', message: 'No live daemon to register against.' });
      return;
    }
    // AX10 (OB-F9) — capture the port from the client that is about to do
    // the POST. Reading `daemonStore.state.health?.port` after the pause
    // read the LIVE facade, which may have swapped to another project by
    // then and would have sent the switch to the wrong daemon.
    const port = portOf(client.transport.httpBase);
    setReg({ kind: 'registering' });
    registerCancelled = false;
    registerAbort = new AbortController();
    // AX10 (OB-F6) — bound the POST. Without a signal a hung daemon left
    // "Scaffolding & registering…" spinning forever with no way out.
    const timer = setTimeout(() => registerAbort?.abort(), REGISTER_TIMEOUT_MS);
    const res = await client.projectRegister(body, registerAbort.signal);
    clearTimeout(timer);
    registerAbort = null;
    if (registerCancelled) return; // the cancel handler already set the message
    if (!res.ok) {
      let msg = res.body || res.error || `HTTP ${res.status}`;
      try {
        const j = JSON.parse(res.body) as { error?: string };
        if (j?.error) msg = j.error;
      } catch { /* body wasn't JSON — use it raw */ }
      log.warn('add-project: register failed', res.status, msg);
      setReg({ kind: 'error', message: msg });
      return;
    }
    const { id, name, scaffolded } = res.data;
    log.info('add-project: registered', id, 'scaffolded', scaffolded);
    setReg({ kind: 'done', id, name, scaffolded });
    // AX10 (OB-F6) — put the row in the rail BEFORE attempting the switch.
    // The rail entry used to be a side effect of the switch succeeding, so
    // a failed switch left a project that exists on the daemon and nowhere
    // in the UI.
    projectsStore.upsert({
      port,
      base: client.transport.httpBase,
      cluster_id: id,
      cluster_name: name || id,
      status: 'live',
    });
    void discoverProjects();
    setTimeout(() => {
      void switchProject(port, id, {
        display: name || id,
        cluster_id: id,
        cluster_name: name,
      }).catch(() => undefined);
      closeAddProjectWizard();
    }, DONE_PAUSE_MS);
  }

  function cancelRegister(): void {
    registerCancelled = true;
    registerAbort?.abort();
    setReg({ kind: 'error', message: 'Cancelled. The daemon may still finish in the background — rescan the rail to check.' });
  }

  // First cluster_id that wasn't in the baseline = the newly-launched daemon.
  // Null baseline = discovery hasn't primed yet; matching now would be the
  // very race OB-F5 describes.
  const fresh = createMemo<LiveProbe | null>(() => {
    const base = baseline();
    if (!base) return null;
    for (const [id, probe] of liveClusters()) if (!base.has(id)) return probe;
    return null;
  });

  // On first detection (FALLBACK path only): show success, then enter it.
  createEffect(() => {
    if (reg().kind !== 'idle') return; // direct register in progress — ignore scan
    const p = fresh();
    if (!p || found()) return;
    setFound(p);
    log.info('add-project: detected new daemon', p.cluster_id, 'on', p.port);
    // AX10/AX9 (OB-F12) — this used to refuse to enter without a token
    // already in localStorage, so a freshly-launched LOCAL daemon (the
    // whole point of this flow) sat in the rail waiting for a click. The
    // switch flow acquires a local token itself (GET /auth/local-token)
    // and falls back to the unlock prompt when it can't — just go.
    setTimeout(() => {
      void switchProject(p.port, p.cluster_id ?? String(p.port), {
        display: p.cluster_name ?? p.cluster_id ?? `:${p.port}`,
        cluster_id: p.cluster_id,
        cluster_name: p.cluster_name,
      }).catch(() => undefined);
      closeAddProjectWizard();
    }, DONE_PAUSE_MS);
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — operator can still select manually */ }
  };

  // ── DIRECT REGISTER UI ───────────────────────────────────────────────
  // NOTE: returned via a reactive <Show> at the bottom — a bare
  // `if (reg()...) return` reads the signal in the component body (runs once)
  // and would never re-render when reg() changes.
  const DirectRegisterUI = () => (
      <WizardStep
        title="Adding your project"
        subtitle="Registering it with your running daemon — no terminal needed."
      >
        <Show when={reg().kind === 'registering'}>
          <div class="bg-emerald-500/[0.06] border border-emerald-500/30 rounded-lg p-4 flex items-center gap-3">
            <span
              class="inline-block w-4 h-4 rounded-full border-2 border-emerald-400/30 border-t-emerald-300 animate-spin"
              aria-hidden="true"
            />
            <span class="font-mono text-[12px] text-emerald-300 tracking-wider flex-1">
              Scaffolding &amp; registering…
            </span>
            <button
              type="button"
              onClick={cancelRegister}
              class="px-2.5 py-1 rounded-md border border-gray-700 text-gray-400 hover:text-gray-100 hover:border-gray-500 font-mono text-[10.5px]"
            >Cancel</button>
          </div>
        </Show>

        <Show when={reg().kind === 'done'}>
          {(() => {
            const s = reg() as Extract<RegisterState, { kind: 'done' }>;
            return (
              <div class="bg-emerald-500/[0.12] border border-emerald-400/50 rounded-lg p-4">
                <div class="flex items-center gap-2.5">
                  <span class="text-emerald-300 text-[15px] leading-none">✓</span>
                  <span class="font-mono text-[12px] text-emerald-200 tracking-wider">
                    “{s.name}” added — opening it now.
                  </span>
                </div>
                <p class="mt-2 text-[11.5px] text-emerald-100/70 leading-relaxed">
                  {s.scaffolded
                    ? 'A fresh .meshkore/ was scaffolded in the folder.'
                    : 'The folder already had a .meshkore/ — adopted it as-is.'}
                </p>
              </div>
            );
          })()}
        </Show>

        <Show when={reg().kind === 'error'}>
          {(() => {
            const s = reg() as Extract<RegisterState, { kind: 'error' }>;
            return (
              <div class="bg-red-500/[0.10] border border-red-400/45 rounded-lg p-4">
                <div class="flex items-center gap-2.5">
                  <span class="text-red-300 text-[15px] leading-none">✕</span>
                  <span class="font-mono text-[12px] text-red-200 tracking-wider">
                    Couldn't add the project
                  </span>
                </div>
                <p class="mt-2 text-[11.5px] text-red-100/80 leading-relaxed break-words">{s.message}</p>
                <button
                  type="button"
                  onClick={() => void doRegister()}
                  class="mt-3 px-3 py-1.5 rounded-md bg-red-500/20 hover:bg-red-500/30 text-red-100 border border-red-400/45 font-mono text-[11px]"
                >Retry</button>
              </div>
            );
          })()}
        </Show>
      </WizardStep>
  );

  // ── FALLBACK: paste-a-prompt + scan for a launched daemon ────────────
  const FallbackUI = () => (
    <WizardStep
      title="Paste this in your coding agent"
      subtitle={
        <>
          Open <strong class="text-gray-200">Claude Code</strong>,{' '}
          <strong class="text-gray-200">Cursor</strong> or <strong class="text-gray-200">Windsurf</strong>{' '}
          at the root of your projects folder, paste, hit enter. The prompt handles both cases — if the agent can't start the daemon, it prints the exact terminal command for you to run.
        </>
      }
    >
      <div class="relative bg-[#020617] border border-emerald-500/35 rounded-lg p-3.5 pr-16 font-mono text-[11.5px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words max-h-[320px] overflow-y-auto">
        <button
          type="button"
          onClick={() => void copy()}
          class="absolute top-2.5 right-2.5 px-2.5 py-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/45 font-mono text-[10.5px]"
        >{copied() ? 'copied ✓' : 'copy'}</button>
        {prompt()}
      </div>

      <Show
        when={!found()}
        fallback={
          <div class="mt-3 bg-emerald-500/[0.12] border border-emerald-400/50 rounded-lg p-3.5">
            <div class="flex items-center gap-2.5">
              <span class="text-emerald-300 text-[15px] leading-none">✓</span>
              <span class="font-mono text-[12px] text-emerald-200 tracking-wider">
                Found “{found()?.cluster_name ?? found()?.cluster_id}” on port {found()?.port} — opening it now.
              </span>
            </div>
            <p class="mt-2 text-[11.5px] text-emerald-100/70 leading-relaxed">
              If it asks for a token, open the <strong>auto-unlock link</strong> your terminal printed — that adopts it cleanly.
            </p>
          </div>
        }
      >
        <div class="mt-3 bg-emerald-500/[0.06] border border-emerald-500/30 rounded-lg p-3.5">
          <div class="flex items-center gap-2.5">
            {/* Spinner — makes it obvious the cockpit is actively listening. */}
            <span
              class="inline-block w-3.5 h-3.5 rounded-full border-2 border-emerald-400/30 border-t-emerald-300 animate-spin"
              aria-hidden="true"
            />
            <span class="font-mono text-[12px] text-emerald-300 tracking-wider">
              Listening for your daemon on ports 5570-5589…
            </span>
          </div>
          <p class="mt-2.5 text-[12px] text-slate-300 leading-relaxed">
            The moment your daemon starts, this detects it automatically and opens the project — no refresh needed.
          </p>
          <p class="mt-2 text-[11.5px] text-gray-400 leading-relaxed">
            <strong class="text-amber-400">⚠</strong> Most coding agents won't start a long-running downloaded script — that's expected. Watch the agent's output for a{' '}
            <code class="font-mono text-emerald-300">cd … &amp;&amp; python3 .meshkore/scripts/daemon.py</code>{' '}
            command and paste it in your terminal.
          </p>
          <p class="mt-2 text-[11.5px] text-gray-400 leading-relaxed">
            You can close this window — detection keeps running in the projects rail.
          </p>
        </div>
      </Show>
    </WizardStep>
  );

  return (
    <Show when={reg().kind !== 'idle'} fallback={<FallbackUI />}>
      <DirectRegisterUI />
    </Show>
  );
}
