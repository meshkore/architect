/**
 * CockpitOutdatedBanner — the COCKPIT's own version signal.
 *
 * Fires when `/health.json` reports a build commit other than the one
 * this bundle was built with: a new cockpit was deployed and the
 * operator's tab is stale.
 *
 * No "Later" dismiss, unlike the daemon-ahead case. When the cockpit is
 * stale, fixes the operator just asked for are not in their hands until
 * they reload — we want them to do it. Daemon-version signals do NOT
 * belong here; those own the centre of the screen (DaemonBehindPanel).
 */

import { Show } from 'solid-js';
import { cockpitOutdated, latestCockpitCommit, COCKPIT_COMMIT, probeCockpitHealth } from '~/lib/cockpit-version';

export default function CockpitOutdatedBanner() {
  const refresh = (): void => { window.location.reload(); };
  return (
    <Show when={cockpitOutdated()}>
      <div class="border-b border-cyan-500/40 bg-cyan-500/15 text-cyan-100 text-[12px] px-4 py-2 flex items-center gap-3">
        <span class="font-mono text-cyan-300/90 flex-shrink-0">↻ cockpit ahead</span>
        <span class="flex-1 min-w-0">
          A new Architect cockpit is live (<span class="font-mono text-cyan-300">{latestCockpitCommit() ?? '?'}</span>).
          Your tab is running <span class="font-mono text-cyan-300">{COCKPIT_COMMIT}</span>.
          Reload to pick up the new bundle — fixes shipped after that commit are not in this tab yet.
        </span>
        <button
          type="button"
          onClick={() => { void probeCockpitHealth(); }}
          class="font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded border border-cyan-500/30 hover:border-cyan-500/60 text-cyan-200/80 hover:text-cyan-100 transition-colors flex-shrink-0"
          title="Re-probe /health.json"
        >
          Re-check
        </button>
        <button
          type="button"
          onClick={refresh}
          class="font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded bg-cyan-500/30 hover:bg-cyan-500/50 border border-cyan-500/60 text-cyan-50 transition-colors flex-shrink-0"
        >
          Reload now
        </button>
      </div>
    </Show>
  );
}
