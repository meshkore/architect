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
      <div class="flex items-center gap-2 mb-3">
        <button
          type="button"
          class="text-[11px] text-gray-500 hover:text-emerald-300"
          onClick={props.onBack}
        >← back</button>
        <span class="text-[12px] text-gray-200 font-semibold">Paste in a terminal at the project root</span>
      </div>
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
  // V107.14 — Refresh TLS bundle too (V107.13 field lessons). Without
  // it the daemon serves plain HTTP and the HTTPS-only cockpit can't
  // reach the new install. The bundle was previously rolled into the
  // self-update codepath — no-op on same-version — so a fresh repo
  // shipped without it. Unconditional refresh here.
  'mkdir -p .meshkore/scripts/tls .meshkore/.runtime && \\\n' +
  'curl -fsSL https://architect.meshkore.com/reference/cluster/scripts/daemon.py \\\n' +
  '  -o .meshkore/scripts/daemon.py && \\\n' +
  'curl -fsSL https://architect.meshkore.com/reference/cluster/scripts/tls/fullchain.pem \\\n' +
  '  -o .meshkore/scripts/tls/fullchain.pem && \\\n' +
  'curl -fsSL https://architect.meshkore.com/reference/cluster/scripts/tls/privkey.pem \\\n' +
  '  -o .meshkore/scripts/tls/privkey.pem && \\\n' +
  'chmod 600 .meshkore/scripts/tls/privkey.pem && \\\n' +
  'nohup python3 .meshkore/scripts/daemon.py \\\n' +
  '  > .meshkore/.runtime/daemon.log 2>&1 & \\\n' +
  'disown ; sleep 1 ; \\\n' +
  "echo '✓ MeshKore daemon launched with fresh TLS bundle. Open https://architect.meshkore.com — it will auto-reconnect. Logs: tail -f .meshkore/.runtime/daemon.log'";
