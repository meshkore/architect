import { JSX, createSignal } from 'solid-js';
import { log } from '~/lib/log';

export type ManualViewProps = {
  shellCmd: string;
  onBack: () => void;
};

export function ManualView(props: ManualViewProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.shellCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      log.warn('clipboard write failed', err);
    }
  };
  return (
    <>
      <div class="flex items-center gap-2 mb-2">
        <button
          type="button"
          class="text-[11px] text-gray-400 hover:text-emerald-300 flex items-center gap-1"
          onClick={props.onBack}
        >← back</button>
        <span class="text-[12px] text-gray-300 font-semibold">Run this in the project folder</span>
      </div>
      <p class="text-[11px] text-gray-500 mb-3 leading-relaxed">
        Open a terminal in the directory where{' '}
        <code class="font-mono">.meshkore/</code>{' '}lives, then paste:
      </p>
      <pre class="bg-gray-950 border border-gray-800 rounded p-3 text-[11px] font-mono text-emerald-200 whitespace-pre-wrap leading-relaxed mb-3">{props.shellCmd}</pre>
      <div class="flex gap-2">
        <button
          type="button"
          class="flex-1 px-3 py-2 rounded bg-gray-900 text-gray-300 border border-gray-800 text-sm hover:text-gray-100 transition"
          onClick={doCopy}
        >{copied() ? 'copied ✓' : 'Copy command'}</button>
      </div>
    </>
  );
}

export const SHELL_CMD =
  "pkill -f 'python3 .meshkore/scripts/daemon.py' ; \\\n" +
  'curl -fsSL https://meshkore.com/reference/cluster/scripts/daemon.py \\\n' +
  '  -o .meshkore/scripts/daemon.py && \\\n' +
  'mkdir -p .meshkore/.runtime && \\\n' +
  'nohup python3 .meshkore/scripts/daemon.py \\\n' +
  '  > .meshkore/.runtime/daemon.log 2>&1 & \\\n' +
  'disown ; sleep 1 ; \\\n' +
  "echo '✓ MeshKore daemon launched. Open https://architect.meshkore.com and hit \"I'\\''ve updated — recheck\" — it will auto-detect this project. Logs: tail -f .meshkore/.runtime/daemon.log'";
