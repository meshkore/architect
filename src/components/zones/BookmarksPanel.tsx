/**
 * BookmarksPanel — V44 zone stub.
 *
 * Operator-curated quick-access shelf backed by
 * `.meshkore/public/bookmarks.yaml`. The V80 monolith only shows a
 * coming-soon toast for this zone; this Solid port renders an
 * equivalent placeholder card so the zone button + `#bookmarks` deep
 * link have something visible to open. Real content lands with V44.
 */

import { uiStore } from '~/state/ui';

export default function BookmarksPanel() {
  return (
    <div class="flex-1 flex items-center justify-center px-6 py-10">
      <div class="max-w-xl w-full rounded-2xl border border-gray-800/60 bg-gray-900/40 px-8 py-10 text-center">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 mb-5">
          <svg class="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z" />
          </svg>
        </div>

        <h2 class="text-lg font-semibold text-gray-100 mb-2">Bookmarks</h2>
        <p class="text-sm text-gray-400 leading-relaxed mb-5">
          The quick-access shelf is coming with{' '}
          <span class="font-mono text-amber-300">V44</span>. Once shipped,
          this panel renders operator-curated links from{' '}
          <span class="font-mono text-emerald-300">.meshkore/public/bookmarks.yaml</span>.
        </p>

        <div class="text-[11px] text-gray-500 leading-relaxed font-mono bg-gray-950/60 border border-gray-800/60 rounded-lg px-4 py-3 text-left">
          <div class="text-gray-400 mb-1"># .meshkore/public/bookmarks.yaml</div>
          <div class="text-gray-500">bookmarks:</div>
          <div class="text-gray-500 pl-3">- title: Standard</div>
          <div class="text-gray-500 pl-5">url: https://meshkore.com/standard</div>
          <div class="text-gray-500 pl-3">- title: Architect</div>
          <div class="text-gray-500 pl-5">url: https://meshkore.com/architect</div>
        </div>

        <button
          type="button"
          onClick={() => uiStore.setActiveZone('architect')}
          class="mt-6 px-3 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-medium hover:bg-emerald-500/25 transition-colors"
        >
          ← Back to Architect
        </button>
      </div>
    </div>
  );
}
