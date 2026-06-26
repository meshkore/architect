/**
 * BootingPanel — brief loader that covers the workspace area while the
 * cockpit connects + hydrates the active cluster (CBO1).
 *
 * 2026-06-19 operator rewrite: drop the verbose checklist ("Inicializando
 * / Snapshot del roadmap / Historial…") for a SHORT spinner on a BLACK
 * surface (the same near-black as the dashboard panels, never the bluish
 * --bg-canvas gap colour). If it stalls (or /state errors), surface two
 * actions — retry, or hand off to OfflinePanel (the existing screen with
 * "start it myself" / "hand it to Claude Code").
 *
 * ProjectsRail lives OUTSIDE this panel — the operator can switch projects
 * at any moment.
 */

import type { JSX } from 'solid-js';
import { Show, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { serverStore } from '~/state/server';

const SLOW_AFTER_MS = 12_000;

export default function BootingPanel(): JSX.Element {
  const cluster = (): string =>
    daemonStore.state.health?.cluster_name
    ?? daemonStore.state.health?.identity
    ?? 'el proyecto';

  const [slow, setSlow] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
  };
  onMount(arm);
  onCleanup(() => { if (timer) clearTimeout(timer); });

  // Something's wrong if the snapshot errored or it's just taking too long.
  const failed = createMemo(() => slow() || !!serverStore.state.error);

  const retry = (): void => {
    const c = daemonStore.state.client;
    const id = daemonStore.state.activeId;
    if (c && id) void serverStore.refreshNow(c, id);
    setSlow(false);
    arm();
  };

  // Hand off to OfflinePanel (the existing manual / Claude-Code start screen).
  const startOptions = (): void => {
    const h = daemonStore.state.health;
    const id = daemonStore.state.activeId;
    if (!id) return;
    daemonStore.selectOffline({
      key: id,
      port: h?.port ?? 0,
      cluster_id: h?.cluster_id ?? null,
      cluster_name: h?.cluster_name ?? null,
      display: h?.cluster_name ?? h?.identity ?? 'el proyecto',
      reason: 'unknown',
    });
  };

  return (
    <section
      class="h-full w-full flex items-center justify-center px-6"
      style={{ background: '#0a0d12' }}
    >
      <Show
        when={!failed()}
        fallback={
          <div class="flex flex-col items-center gap-4 text-center max-w-sm">
            <p class="text-sm text-gray-300">
              Tarda más de lo normal en inicializar{' '}
              <span class="font-mono text-emerald-200">{cluster()}</span>.
            </p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                onClick={retry}
                class="px-3 py-1.5 rounded-md text-xs border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition-colors"
              >
                Reintentar
              </button>
              <button
                type="button"
                onClick={startOptions}
                class="px-3 py-1.5 rounded-md text-xs border border-gray-700 text-gray-300 hover:bg-gray-800/60 transition-colors"
              >
                Opciones de arranque
              </button>
            </div>
            <p class="text-[11px] text-gray-600">
              Arranca el daemon tú mismo o deja que Claude Code lo haga.
            </p>
          </div>
        }
      >
        <div class="flex flex-col items-center gap-4">
          <span
            class="w-8 h-8 rounded-full border-2 border-emerald-500/25 border-t-emerald-400 animate-spin"
            aria-hidden="true"
          />
          {/* FC-2 (daemon-centralized) — one daemon serves every local project,
              so switching is NOT a (re)connection: we just sync the front-end
              state for the selected project. Wording reflects that. */}
          <p class="text-sm text-gray-400">
            Inicializando <span class="font-mono text-emerald-200">{cluster()}</span>…
          </p>
        </div>
      </Show>
    </section>
  );
}
