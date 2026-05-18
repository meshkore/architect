/**
 * Header — top bar with cluster identity, connection state, and a refresh button.
 * Sticky so it stays visible while panels scroll.
 */

import { Show } from 'solid-js';
import { store, type WsState } from '~/state/store';
import type { HealthResponse } from '~/lib/daemon-client';

export default function Header(props: { health: HealthResponse }) {
  return (
    <header class="sticky top-0 z-30 bg-gray-950/85 backdrop-blur-xl border-b border-gray-800/60">
      <div class="max-w-[1600px] mx-auto px-5 h-14 flex items-center gap-4">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 rounded-md bg-emerald-500/20 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-emerald-400"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
          </div>
          <span class="text-base font-bold tracking-tight">Architect</span>
        </div>

        <div class="flex items-center gap-3 text-sm min-w-0">
          <Show when={props.health.cluster_name}>
            <span class="text-gray-100 font-semibold truncate">{props.health.cluster_name}</span>
            <span class="text-gray-700">/</span>
          </Show>
          <span class="font-mono text-xs text-gray-400 truncate">{props.health.identity}</span>
          <Show when={props.health.device}>
            <span class="hidden md:inline text-gray-700">·</span>
            <span class="hidden md:inline font-mono text-xs text-gray-500 truncate">{props.health.device!.hostname}</span>
          </Show>
        </div>

        <div class="ml-auto flex items-center gap-3">
          <WsBadge state={store.wsState()} />
          <button
            type="button"
            onClick={() => void store.refresh()}
            class="px-3 py-1.5 rounded-md bg-gray-900/70 hover:bg-gray-800/70 border border-gray-800 text-gray-300 text-xs font-medium transition-colors"
            title="Reload state from the daemon"
          >
            Reload
          </button>
        </div>
      </div>
    </header>
  );
}

function WsBadge(props: { state: WsState }) {
  const cls = () => props.state === 'open'
    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
    : props.state === 'connecting'
      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
      : 'bg-red-500/15 border-red-500/40 text-red-300';
  const dot = () => props.state === 'open' ? 'bg-emerald-400' : props.state === 'connecting' ? 'bg-amber-400' : 'bg-red-400';
  const label = () => props.state === 'open' ? 'live' : props.state === 'connecting' ? 'connecting' : props.state === 'closed' ? 'offline' : 'error';
  return (
    <span class={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono uppercase tracking-wider ${cls()}`}>
      <span class={`w-1.5 h-1.5 rounded-full ${dot()} ${props.state === 'open' ? 'animate-pulse-soft' : ''}`} />
      {label()}
    </span>
  );
}
