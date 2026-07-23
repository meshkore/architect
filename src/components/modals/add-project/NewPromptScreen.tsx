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
import { genPrompt, type AddProjectAnswers } from './genPrompt';
import { projectsRailScan } from '~/components/ProjectsRail';
import { liveClusters, type LiveProbe } from '~/components/projects-rail/discovery';
import { switchProject } from '~/components/ProjectsRailRow';
import { closeAddProjectWizard } from '~/components/modals/AddProjectWizard';
import { clusterTokenKey, tokenForCluster } from '~/lib/tokens';
import { daemonStore } from '~/state/daemon';
import { log } from '~/lib/log';
import WizardStep from './WizardStep';

type RegisterState =
  | { kind: 'idle' } // no direct register attempted → fallback prompt+scan UI
  | { kind: 'registering' }
  | { kind: 'done'; id: string; name: string; scaffolded: boolean }
  | { kind: 'error'; message: string };

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
  if (path && name) return { parent: path, name };
  return null;
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
  // launched. Captured once at mount so we don't match pre-existing projects.
  const baseline = new Set<string>();
  const [found, setFound] = createSignal<LiveProbe | null>(null);

  onMount(() => {
    if (canDirect()) {
      void doRegister();
      return;
    }
    for (const id of liveClusters().keys()) baseline.add(id);
    try { projectsRailScan.start(); } catch (e) { log.warn('projectsRailScan.start failed', e); }
  });

  async function doRegister(): Promise<void> {
    const client = liveClient();
    const body = registerBody(props.answers);
    if (!client || !body) {
      setReg({ kind: 'error', message: 'No live daemon to register against.' });
      return;
    }
    setReg({ kind: 'registering' });
    const res = await client.projectRegister(body);
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
    // The new project lives on the SAME central daemon we just POSTed to.
    const port = daemonStore.state.health?.port ?? 0;
    setTimeout(() => {
      void switchProject(port, id, {
        display: name || id,
        cluster_id: id,
        cluster_name: name,
      }).catch(() => undefined);
      closeAddProjectWizard();
    }, 1100); // let the operator see the ✓ before we jump
  }

  // First cluster_id that wasn't in the baseline = the newly-launched daemon.
  const fresh = createMemo<LiveProbe | null>(() => {
    for (const [id, probe] of liveClusters()) if (!baseline.has(id)) return probe;
    return null;
  });

  // On first detection (FALLBACK path only): show success. Only auto-switch +
  // close the wizard if we ALREADY have a token for this cluster (e.g. adopted
  // via the launch URL in another tab — localStorage is shared). With no token,
  // do NOT switch: that would pop the unlock modal here. The operator enters
  // via the auto-unlock link the launch printed (which adopts the token
  // cleanly).
  createEffect(() => {
    if (reg().kind !== 'idle') return; // direct register in progress — ignore scan
    const p = fresh();
    if (!p || found()) return;
    setFound(p);
    log.info('add-project: detected new daemon', p.cluster_id, 'on', p.port);
    const haveToken = !!tokenForCluster(clusterTokenKey({ cluster_id: p.cluster_id, port: p.port }));
    if (!haveToken) return; // leave it in the rail; adopt-link is the way in
    setTimeout(() => {
      void switchProject(p.port, p.cluster_id ?? String(p.port), {
        display: p.cluster_name ?? p.cluster_id ?? `:${p.port}`,
        cluster_id: p.cluster_id,
        cluster_name: p.cluster_name,
      }).catch(() => undefined);
      closeAddProjectWizard();
    }, 1100); // let the operator see the ✓ before we jump
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
            <span class="font-mono text-[12px] text-emerald-300 tracking-wider">
              Scaffolding &amp; registering…
            </span>
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
                Found “{found()?.cluster_name ?? found()?.cluster_id}” on port {found()?.port} — it's in your rail.
              </span>
            </div>
            <p class="mt-2 text-[11.5px] text-emerald-100/70 leading-relaxed">
              Open the <strong>auto-unlock link</strong> your terminal printed to enter it with no token paste (or it opens here automatically if this cluster is already unlocked).
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
            <code class="font-mono text-emerald-300">cd … && python3 .meshkore/scripts/daemon.py</code>{' '}
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
