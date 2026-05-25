/**
 * NewPromptScreen — final wizard step. Renders the genPrompt() output
 * with a copy button, then an emerald-tinted "watching for your daemon"
 * panel. Starts the continuous projects-rail scan on mount; the scan
 * keeps running after the modal closes so the rail picks up the new
 * project as soon as its daemon boots.
 */
import { createSignal, onMount } from 'solid-js';
import { genPrompt, type AddProjectAnswers } from './genPrompt';
import { projectsRailScan } from '~/components/ProjectsRail';
import { log } from '~/lib/log';
import WizardStep from './WizardStep';

export default function NewPromptScreen(props: { answers: AddProjectAnswers }) {
  const [copied, setCopied] = createSignal(false);
  const prompt = () => genPrompt(props.answers);

  onMount(() => {
    try { projectsRailScan.start(); } catch (e) { log.warn('projectsRailScan.start failed', e); }
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
      <div class="mt-3 bg-emerald-500/[0.06] border border-emerald-500/30 rounded-lg p-3.5">
        <div class="flex items-center gap-2.5">
          <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span class="font-mono text-[12px] text-emerald-300 tracking-wider">
            Watching for your daemon on ports 5570-5589
          </span>
        </div>
        <p class="mt-2.5 text-[12px] text-slate-300 leading-relaxed">
          As soon as your agent (or you, if the agent prints the terminal command) starts the daemon, the new project pops into the rail on the left.
        </p>
        <p class="mt-2 text-[11.5px] text-gray-400 leading-relaxed">
          <strong class="text-amber-400">⚠</strong> Most coding agents refuse to spawn long-running downloaded scripts — totally normal. Watch the agent's output: it should print a{' '}
          <code class="font-mono text-emerald-300">cd … && python3 .meshkore/scripts/daemon.py</code>{' '}
          command for you to paste in your terminal.
        </p>
        <p class="mt-2 text-[11.5px] text-gray-400 leading-relaxed">
          You can close this window — detection keeps running in the projects rail.
        </p>
      </div>
    </WizardStep>
  );
}
