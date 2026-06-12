/**
 * BootingPanel — full-body block that covers the workspace area
 * while the cockpit is hydrating the active cluster's data
 * (CBO1, initiative `cockpit-boot-overlay`).
 *
 * Why this exists: the moment a daemon WS opens, `Cockpit.tsx`
 * enters its workspace branch (3-col layout). Modules tree,
 * ChatRail, ChatPanel all render with placeholder data while
 * `serverStore.refreshNow()` + `client.chatSnapshot()` are still
 * in flight. The operator sees a UI that looks ready but isn't —
 * the modules collapse button doesn't respond, agent rows are
 * empty, chat shows "Loading chat history…" skeletons.
 *
 * The fix: cover the workspace area with this panel until both
 * snapshots have hydrated. ProjectsRail (column to the left of
 * `<main>`) is OUTSIDE this panel by construction — the operator
 * can switch clusters at any moment.
 *
 * UX: matches the shape of DaemonOutdatedPanel / DaemonAheadPanel
 * (centered card, dark background, same paddings). No buttons —
 * dismisses itself when both stores hydrate.
 */

import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { serverStore } from '~/state/server';
import { chatStore } from '~/state/chat';

function Step(props: { done: boolean; pending: boolean; label: string }): JSX.Element {
  return (
    <li class="flex items-center gap-3 py-1.5">
      <Show
        when={props.done}
        fallback={
          <span
            class="inline-flex items-center justify-center w-4 h-4 rounded-full border border-emerald-500/30"
            aria-hidden="true"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400/60 animate-pulse-soft" />
          </span>
        }
      >
        <span
          class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold"
          aria-hidden="true"
        >
          ✓
        </span>
      </Show>
      <span class={props.done ? 'text-gray-300 text-sm' : 'text-gray-400 text-sm'}>
        {props.label}
      </span>
    </li>
  );
}

export default function BootingPanel(): JSX.Element {
  const cluster = (): string =>
    daemonStore.state.health?.cluster_name
    ?? daemonStore.state.health?.identity
    ?? 'this project';
  const snapshotDone = (): boolean => serverStore.state.snapshot != null;
  const chatDone = (): boolean => chatStore.state.convsHydratedAt != null;

  return (
    <section class="h-full flex items-center justify-center px-6 py-12 overflow-auto">
      <div class="max-w-md w-full">
        <header class="mb-6 text-center">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium mb-4">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
            Inicializando
          </div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight mb-2">
            Conectando con <span class="font-mono text-emerald-200">{cluster()}</span>
          </h1>
          <p class="text-gray-400 leading-relaxed text-sm">
            Hidratando roadmap, módulos y conversaciones del daemon. Suele
            tardar menos de un segundo.
          </p>
        </header>

        <section class="bg-gray-900/50 border border-gray-800 rounded-2xl p-6">
          <ul class="space-y-1">
            <Step done={true} pending={false} label="Daemon conectado" />
            <Step done={snapshotDone()} pending={!snapshotDone()} label="Snapshot del roadmap" />
            <Step done={chatDone()} pending={!chatDone()} label="Historial de conversaciones" />
          </ul>
          <p class="text-gray-500 text-[11px] leading-relaxed mt-5">
            Puedes saltar a otro proyecto en cualquier momento desde la
            barra de la izquierda.
          </p>
        </section>
      </div>
    </section>
  );
}
