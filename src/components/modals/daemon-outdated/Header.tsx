import { JSX } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { activeProject } from '~/state/projects';
import { MIN_DAEMON_VERSION } from '~/lib/version';

export function clusterLabel(): string {
  const p = activeProject();
  return p?.cluster_name ?? p?.base ?? 'this project';
}

export function runningVersion(): string {
  return daemonStore.state.version?.raw ?? daemonStore.state.health?.version ?? 'unknown';
}

export function Header(): JSX.Element {
  return (
    <div class="flex items-center gap-2 mb-3">
      <div class="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" width="16" height="16">
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </div>
      <div class="min-w-0">
        <h3 class="text-base font-semibold leading-tight text-gray-100">
          Update <span class="text-amber-300">{clusterLabel()}</span>'s daemon
        </h3>
        <p class="text-[11px] text-gray-500 font-mono truncate">
          {activeProject()?.base ?? ''} · running <span class="text-amber-300">{runningVersion()}</span>{' '}
          · needs <span class="text-emerald-300">{MIN_DAEMON_VERSION}</span>
        </p>
      </div>
    </div>
  );
}
