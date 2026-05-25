/**
 * LinksPanel — V45 zone stub.
 *
 * Standard §13 deployment registry: every module's local/prod/repo
 * coordinates served by the daemon at `/links` and persisted in
 * `.meshkore/public/links.yaml`. The V80 monolith only shows a
 * coming-soon toast for this zone; this Solid port renders an
 * equivalent placeholder card so the header button + `#links` deep
 * link have something visible to open. Real content lands with V45.
 */

import { uiStore } from '~/state/ui';

export default function LinksPanel() {
  return (
    <div class="flex-1 flex items-center justify-center px-6 py-10">
      <div class="max-w-xl w-full rounded-2xl border border-gray-800/60 bg-gray-900/40 px-8 py-10 text-center">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-sky-500/15 border border-sky-500/30 mb-5">
          <svg class="w-6 h-6 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
        </div>

        <h2 class="text-lg font-semibold text-gray-100 mb-2">Links</h2>
        <p class="text-sm text-gray-400 leading-relaxed mb-5">
          The deployment registry is coming with{' '}
          <span class="font-mono text-amber-300">V45</span>. Once shipped,
          this panel renders every module's local / prod / repo
          coordinates from{' '}
          <span class="font-mono text-sky-300">.meshkore/public/links.yaml</span>{' '}
          and stays live via WS <span class="font-mono text-sky-300">links.updated</span>.
        </p>

        <div class="text-[11px] text-gray-500 leading-relaxed font-mono bg-gray-950/60 border border-gray-800/60 rounded-lg px-4 py-3 text-left">
          <div class="text-gray-400 mb-1"># .meshkore/public/links.yaml</div>
          <div class="text-gray-500">modules:</div>
          <div class="text-gray-500 pl-3">api:</div>
          <div class="text-gray-500 pl-5">local: {'{ url: http://localhost:8080 }'}</div>
          <div class="text-gray-500 pl-5">prod:  {'{ provider: fly, url: https://hub.meshkore.com }'}</div>
          <div class="text-gray-500 pl-5">repo:  {'{ branch: main, commit: f3fbe04 }'}</div>
        </div>

        <button
          type="button"
          onClick={() => uiStore.setActiveZone('architect')}
          class="mt-6 px-3 py-1.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs font-medium hover:bg-sky-500/25 transition-colors"
        >
          ← Back to Architect
        </button>
      </div>
    </div>
  );
}
