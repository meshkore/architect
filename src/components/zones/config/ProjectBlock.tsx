import { daemonStore } from '~/state/daemon';
import { clusterInfo } from '~/state/server';
import { useTlsDaemon } from '~/lib/transport';
import { Block, KV } from './atoms';

/** ProjectBlock — the project's identity + which daemon it's talking to.
 *  Today every project connects to the local daemon on this Mac; the
 *  endpoint line is here so a future "connect to another daemon in the
 *  cluster" switch has an obvious home. */
export function ProjectBlock() {
  const info = () => clusterInfo();
  const httpBase = () => daemonStore.state.client?.transport.httpBase ?? null;
  return (
    <Block title="Project" subtitle="This project's identity and which daemon serves it.">
      <KV k="name" v={info()?.name ?? '—'} />
      <KV k="id" v={info()?.id ?? '—'} />
      <div class="flex gap-3 py-0.5 items-baseline">
        <span class="text-gray-600 font-mono text-xs min-w-[12rem]">daemon</span>
        <span class="text-gray-200 font-mono text-xs break-all">
          local {useTlsDaemon() ? '(TLS)' : ''} · {httpBase() ?? '—'}
        </span>
      </div>
      <p class="text-[11px] text-gray-600 mt-2 leading-snug">
        Connected to the daemon on this Mac. Switching a project to a different
        daemon elsewhere in the cluster is planned but not available yet.
      </p>
    </Block>
  );
}
