/**
 * DaemonAheadPanel — full-body block when the daemon is meaningfully
 * ahead (CVS2, initiative `cockpit-version-sync`).
 *
 * Trips when `daemonStore.state.ahead === true` — that flag already
 * gates on major/minor mismatch (see `isDaemonAhead` in lib/version.ts),
 * NOT patch. Patch differences keep using the thin top
 * `DaemonAheadBanner`; minor / major differences mean the wire-format
 * contract may have evolved and the cockpit can't safely render the
 * roadmap / chat without risking partial breakage.
 *
 * UX: matches DaemonOutdatedPanel's "full body block" mode but the
 * resolution is operator-side (Reload) instead of daemon-side
 * (upgrade). One button. No wizard.
 *
 * ProjectsRail stays clickable so the operator can switch to a
 * cluster whose daemon matches the cockpit bundle.
 */

import type { JSX } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { EXPECTED_DAEMON_VERSION } from '~/lib/version';

export default function DaemonAheadPanel(): JSX.Element {
  const cluster = (): string =>
    daemonStore.state.health?.cluster_name
    ?? daemonStore.state.health?.identity
    ?? 'this project';
  const daemonV = (): string => daemonStore.state.version?.raw ?? '?';
  const reload = (): void => { window.location.reload(); };

  return (
    <section class="h-full flex items-center justify-center px-6 py-12 overflow-auto">
      <div class="max-w-xl w-full">
        <header class="mb-6">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 text-xs font-medium mb-4">
            <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse-soft" />
            Cockpit refresh required
          </div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight mb-2">
            Daemon ahead — reload to continue
          </h1>
          <p class="text-gray-400 leading-relaxed text-sm">
            The daemon at <span class="font-mono text-cyan-200">{cluster()}</span>{' '}
            is now <span class="font-mono text-cyan-300">{daemonV()}</span>.
            This cockpit bundle was built for{' '}
            <span class="font-mono text-cyan-300">{EXPECTED_DAEMON_VERSION}</span>{' '}
            — the wire format may have evolved between those versions, so we
            can't safely render this project's roadmap and chat until you
            reload to pick up the matching frontend.
          </p>
        </header>

        <section class="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
          <p class="text-gray-300 text-sm leading-relaxed mb-5">
            Click <span class="font-mono text-cyan-300">Reload</span> below to
            fetch the matching cockpit bundle. If you still see this panel
            after the reload, the deploy hasn't propagated yet — wait ~30 s
            and reload again.
          </p>
          <button
            type="button"
            onClick={reload}
            class="w-full font-mono text-xs uppercase tracking-wider px-4 py-3 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-100 transition-colors"
          >
            ↻ Reload cockpit
          </button>
          <p class="text-gray-500 text-[11px] leading-relaxed mt-4">
            The projects rail on the left stays clickable — if you need to
            keep working on another cluster, switch there while this one
            waits.
          </p>
        </section>
      </div>
    </section>
  );
}
