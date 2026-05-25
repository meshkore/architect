import { JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { MIN_DAEMON_VERSION } from '~/lib/version';
import { clusterLabel, runningVersion } from './Header';

export function LockPanel(props: { onShowOptions: () => void }): JSX.Element {
  return (
    <Portal mount={document.body}>
      <div class="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(6,10,18,0.94)] backdrop-blur-sm pointer-events-auto px-4">
        <div class="max-w-md w-full rounded-xl shadow-2xl p-6 text-center bg-[#0b1220] border border-gray-700/40">
          <div class="flex items-center justify-center gap-2 mb-3">
            <div class="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" width="18" height="18">
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
          </div>
          <h3 class="text-base font-semibold leading-tight text-gray-100">
            {clusterLabel()} is locked
          </h3>
          <p class="text-[11px] text-gray-500 font-mono mt-1 mb-4">
            daemon <span class="text-amber-300">{runningVersion()}</span>{' '}
            · cockpit needs <span class="text-emerald-300">{MIN_DAEMON_VERSION}</span>
          </p>
          <p class="text-[12px] text-gray-300 mb-4 leading-relaxed">
            Update this project's daemon to keep working on it.{' '}
            <strong>Other projects in the rail are unaffected</strong> — click any of them to switch.
          </p>
          <button
            type="button"
            class="px-4 py-2 rounded bg-emerald-500 text-gray-950 text-sm font-semibold hover:bg-emerald-400 transition"
            onClick={props.onShowOptions}
          >Show update options</button>
        </div>
      </div>
    </Portal>
  );
}
