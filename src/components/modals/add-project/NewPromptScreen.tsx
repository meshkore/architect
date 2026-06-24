/**
 * NewPromptScreen — final wizard step. Renders the genPrompt() output
 * with a copy button, then a live "watching for your daemon" panel.
 *
 * Detection (2026-06-24): on mount we flip the rail's `scanning()` signal
 * ON — the ProjectsRail (always mounted) then runs a bounded full sweep of
 * 5570-5589 every few seconds, so a brand-new daemon on ANY port is found
 * automatically, no refresh. This screen watches `liveClusters` for a
 * cluster that wasn't live when it opened; the instant one appears it shows
 * a success state, switches the cockpit to it, and closes the wizard. The
 * box always shows a spinner while listening so it's obvious it's active.
 */
import { createSignal, createMemo, createEffect, onMount, Show } from 'solid-js';
import { genPrompt, type AddProjectAnswers } from './genPrompt';
import { projectsRailScan } from '~/components/ProjectsRail';
import { liveClusters, type LiveProbe } from '~/components/projects-rail/discovery';
import { switchProject } from '~/components/ProjectsRailRow';
import { closeAddProjectWizard } from '~/components/modals/AddProjectWizard';
import { clusterTokenKey, tokenForCluster } from '~/lib/tokens';
import { log } from '~/lib/log';
import WizardStep from './WizardStep';

export default function NewPromptScreen(props: { answers: AddProjectAnswers }) {
  const [copied, setCopied] = createSignal(false);
  const prompt = () => genPrompt(props.answers);

  // Cluster ids already live when this screen opened — anything NEW that
  // appears in liveClusters while we watch is the daemon the operator just
  // launched. Captured once at mount so we don't match pre-existing projects.
  const baseline = new Set<string>();
  const [found, setFound] = createSignal<LiveProbe | null>(null);

  onMount(() => {
    for (const id of liveClusters().keys()) baseline.add(id);
    try { projectsRailScan.start(); } catch (e) { log.warn('projectsRailScan.start failed', e); }
  });

  // First cluster_id that wasn't in the baseline = the newly-launched daemon.
  const fresh = createMemo<LiveProbe | null>(() => {
    for (const [id, probe] of liveClusters()) if (!baseline.has(id)) return probe;
    return null;
  });

  // On first detection: show success. Only auto-switch + close the wizard if
  // we ALREADY have a token for this cluster (e.g. adopted via the launch URL
  // in another tab — localStorage is shared). With no token, do NOT switch:
  // that would pop the unlock modal here. The operator enters the project via
  // the auto-unlock link the launch printed (which adopts the token cleanly).
  createEffect(() => {
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

  return (
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
}
