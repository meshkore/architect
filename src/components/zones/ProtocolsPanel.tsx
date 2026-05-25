/**
 * ProtocolsPanel — V42 zone stub.
 *
 * Standard §14 protocols registry: every protocol the cluster speaks
 * (A2A, MCP, ACP, x402, future custom verbs) listed with version +
 * handler module + last-run history. The V80 monolith only shows a
 * coming-soon toast for this zone; this Solid port renders an
 * equivalent placeholder card so the header button + `#protocols`
 * deep link have something visible to open. Real content lands with
 * V42.
 */

import { uiStore } from '~/state/ui';

export default function ProtocolsPanel() {
  return (
    <div class="flex-1 flex items-center justify-center px-6 py-10">
      <div class="max-w-xl w-full rounded-2xl border border-gray-800/60 bg-gray-900/40 px-8 py-10 text-center">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-violet-500/15 border border-violet-500/30 mb-5">
          <svg class="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h10" />
            <circle cx="18" cy="17" r="2.5" />
          </svg>
        </div>

        <h2 class="text-lg font-semibold text-gray-100 mb-2">Protocols</h2>
        <p class="text-sm text-gray-400 leading-relaxed mb-5">
          The protocols registry is coming with{' '}
          <span class="font-mono text-amber-300">V42</span>. Once shipped,
          this panel lists every verb the cluster speaks (A2A, MCP, ACP,
          x402, custom) from{' '}
          <span class="font-mono text-violet-300">/protocols</span> with a
          run-history viewer and live updates over WS{' '}
          <span class="font-mono text-violet-300">protocol.*</span>.
        </p>

        <div class="text-[11px] text-gray-500 leading-relaxed font-mono bg-gray-950/60 border border-gray-800/60 rounded-lg px-4 py-3 text-left">
          <div class="text-gray-400 mb-1"># GET /protocols</div>
          <div class="text-gray-500">protocols:</div>
          <div class="text-gray-500 pl-3">- id: a2a</div>
          <div class="text-gray-500 pl-5">version: 0.3.0</div>
          <div class="text-gray-500 pl-5">handler: modules/a2a</div>
          <div class="text-gray-500 pl-3">- id: mcp</div>
          <div class="text-gray-500 pl-5">version: 2025-06-18</div>
          <div class="text-gray-500 pl-5">handler: modules/mcp</div>
        </div>

        <button
          type="button"
          onClick={() => uiStore.setActiveZone('architect')}
          class="mt-6 px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs font-medium hover:bg-violet-500/25 transition-colors"
        >
          ← Back to Architect
        </button>
      </div>
    </div>
  );
}
