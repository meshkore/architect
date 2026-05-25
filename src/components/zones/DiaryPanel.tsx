/**
 * DiaryPanel — V43 zone stub.
 *
 * The full diary merges `.meshkore/log/<date>.md` daily logs,
 * `.meshkore/timeline/*.jsonl`, git history, and live WS events into
 * a single chronological blog. The V80 monolith does not ship that
 * view yet; this Solid port renders an equivalent coming-soon card so
 * the header Diary button + `#diary` deep link have something visible
 * to open. Real content lands with V43.
 */

import { uiStore } from '~/state/ui';

export default function DiaryPanel() {
  return (
    <div class="flex-1 flex items-center justify-center px-6 py-10">
      <div class="max-w-xl w-full rounded-2xl border border-gray-800/60 bg-gray-900/40 px-8 py-10 text-center">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 mb-5">
          <svg class="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M4 4h12a2 2 0 012 2v14l-4-2-4 2-4-2-2 2V6a2 2 0 012-2z" />
            <path d="M8 8h8M8 12h8M8 16h5" />
          </svg>
        </div>

        <h2 class="text-lg font-semibold text-gray-100 mb-2">Diary</h2>
        <p class="text-sm text-gray-400 leading-relaxed mb-5">
          Chronological activity blog lands with{' '}
          <span class="font-mono text-amber-300">V43</span>. It merges
          daily logs, the timeline ledger, git history, and live WS
          events into a single reverse-chronological feed.
        </p>

        <div class="text-[11px] text-gray-500 leading-relaxed font-mono bg-gray-950/60 border border-gray-800/60 rounded-lg px-4 py-3 text-left">
          <div class="text-gray-400 mb-1"># sources merged by the diary</div>
          <div class="text-gray-500">- .meshkore/log/&lt;YYYY-MM-DD&gt;.md</div>
          <div class="text-gray-500">- .meshkore/timeline/*.jsonl</div>
          <div class="text-gray-500">- git log (commits, branches, merges)</div>
          <div class="text-gray-500">- live WS: task.*, initiative.*, chat.*</div>
        </div>

        <button
          type="button"
          onClick={() => uiStore.setActiveZone('architect')}
          class="mt-6 px-3 py-1.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium hover:bg-amber-500/25 transition-colors"
        >
          ← Back to Architect
        </button>
      </div>
    </div>
  );
}
