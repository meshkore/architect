/** Header — V64 layout: logo + project plate · zone buttons + Config tab · daemon/cluster pills. */

import { Show } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { activeProject } from '~/state/projects';
import { uiStore, type Zone } from '~/state/ui';
import { mcModal } from '~/lib/modal';
import { useTlsDaemon, LOOPBACK_HOSTNAME } from '~/lib/transport';
import ThemePicker from '~/components/ThemePicker';

const BUILD_VERSION = (import.meta.env.VITE_BUILD_VERSION as string | undefined) ?? 'dev';
const BUILD_COMMIT  = (import.meta.env.VITE_BUILD_COMMIT  as string | undefined) ?? '';
const BUILD_DATE    = (import.meta.env.VITE_BUILD_DATE    as string | undefined) ?? '';

function toggleTlsAndReload(next: boolean): void {
  try { localStorage.setItem('mc-daemon-via-tls', next ? '1' : '0'); } catch { /* quota */ }
  window.location.reload();
}

function openAboutModal(): void {
  const port = daemonStore.state.health?.port;
  const cluster = daemonStore.state.health?.cluster_name ?? daemonStore.state.health?.cluster_id ?? '—';
  const daemonV = daemonStore.state.health?.version ?? '—';
  const tls = useTlsDaemon();
  void mcModal({
    title: 'MeshKore Architect',
    subtitle: 'Operator cockpit for MeshKore clusters',
    body: () => (
      <div class="flex flex-col gap-3.5 py-2">
        <div class="flex items-center gap-2.5">
          <span class="font-mono text-[11px] text-gray-500 tracking-widest uppercase">build</span>
          <span class="font-mono text-base text-emerald-400 font-bold">{BUILD_VERSION}</span>
          <Show when={BUILD_COMMIT}>
            <span class="font-mono text-[10px] text-gray-600">· {BUILD_COMMIT.slice(0, 7)}</span>
          </Show>
          <Show when={BUILD_DATE}>
            <span class="font-mono text-[10px] text-gray-600">· {BUILD_DATE.slice(0, 10)}</span>
          </Show>
        </div>
        <div class="h-px bg-gray-700/30" />
        <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
          <span class="font-mono text-[10px] text-gray-500 uppercase tracking-wider self-center">Cluster</span>
          <span class="text-gray-200">{cluster}</span>
          <span class="font-mono text-[10px] text-gray-500 uppercase tracking-wider self-center">Daemon</span>
          <span class="text-gray-200 font-mono text-[11px]">{daemonV}</span>
          <span class="font-mono text-[10px] text-gray-500 uppercase tracking-wider self-center">Endpoint</span>
          <span class="text-gray-200 font-mono text-[11px]">
            {port ? `${tls ? `https://${LOOPBACK_HOSTNAME}` : 'http://localhost'}:${port}` : '—'}
          </span>
          <span class="font-mono text-[10px] text-gray-500 uppercase tracking-wider self-center">TLS mode</span>
          <div class="flex items-center gap-2">
            <span class={`font-mono text-[11px] ${tls ? 'text-emerald-400' : 'text-gray-400'}`}>{tls ? 'ON · daemon.meshkore.com' : 'off · localhost'}</span>
            <button type="button"
              class="font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500"
              onClick={() => toggleTlsAndReload(!tls)}>
              {tls ? 'switch off' : 'switch on'}
            </button>
          </div>
        </div>
        <Show when={tls}>
          <div class="text-[11px] text-amber-400/80 leading-relaxed">
            <strong>Heads-up:</strong> TLS mode points the cockpit at <code class="font-mono">https://{LOOPBACK_HOSTNAME}:&lt;port&gt;</code>. The daemon must serve TLS with a cert for that name. Until that lands in the daemon (task <code class="font-mono">local-tls-subdomain</code>) you'll see TLS-handshake failures instead of mixed-content errors.
          </div>
        </Show>
        <div class="h-px bg-gray-700/30" />
        <div class="text-[12.5px] text-gray-300 leading-relaxed">
          Web cockpit for any MeshKore cluster. Connects to your local Python daemon — your roadmap, docs and credentials stay on your machine.
        </div>
        <div class="flex flex-col gap-1.5 text-[12px]">
          <a href="https://meshkore.com/architect" target="_blank" rel="noopener" class="text-emerald-400 hover:underline">→ meshkore.com/architect</a>
          <a href="https://meshkore.com/standard" target="_blank" rel="noopener" class="text-emerald-400 hover:underline">→ The MeshKore standard</a>
          <a href="https://meshkore.com/docs" target="_blank" rel="noopener" class="text-emerald-400 hover:underline">→ Documentation</a>
          <a href="https://github.com/meshkore" target="_blank" rel="noopener" class="text-emerald-400 hover:underline">→ GitHub</a>
        </div>
      </div>
    ),
    buttons: [{ id: 'ok', label: 'Close', primary: true }],
  });
}

const ZONES: { id: Zone; label: string; title: string }[] = [
  { id: 'architect', label: 'Architect', title: 'Architect — project dashboard (modules · roadmap · chat)' },
  { id: 'agents',    label: 'Equipo',    title: 'Equipo — global view of who is working on what' },
  { id: 'bookmarks', label: 'Bookmarks', title: 'Bookmarks — quick-access shelf' },
  { id: 'crons',     label: 'Crons',     title: 'Crons — scheduled jobs' },
  { id: 'links',     label: 'Links',     title: 'Links — deployment registry' },
  // Protocols moved 2026-06-19 into the Roadmap column's sub-tabs.
  { id: 'diary',     label: 'Diary',     title: 'Diary — chronological activity blog' },
  { id: 'config',    label: 'Config',    title: 'Config — cluster settings' },
];

function ZoneIcon(props: { id: Zone }) {
  return (
    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <Show when={props.id === 'architect'}><path d="M3 7h18M3 12h18M3 17h13" /></Show>
      <Show when={props.id === 'agents'}><><circle cx="9" cy="8" r="3" /><circle cx="17" cy="11" r="2.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M13 20c0-2.2 1.8-4 4-4s4 1.8 4 4" /></></Show>
      <Show when={props.id === 'bookmarks'}><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z" /></Show>
      <Show when={props.id === 'crons'}><><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></></Show>
      <Show when={props.id === 'links'}><><path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5" /></></Show>
      <Show when={props.id === 'protocols'}><><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></></Show>
      <Show when={props.id === 'diary'}><><path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" /></></Show>
    </svg>
  );
}

export default function Header() {
  return (
    <header class="sticky top-0 z-40 bg-gray-950/95 backdrop-blur-xl border-b border-gray-800/60 shadow-sm">
      <div class="h-12 flex items-center gap-2 px-3">

        {/* LEFT — logo (V63: click → About modal with build version) */}
        <button type="button" class="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 hover:bg-emerald-500/25 transition-colors" title="MeshKore Architect — click for build info" onClick={openAboutModal}>
          <svg class="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" aria-hidden="true">
            <g stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none">
              <line x1="12" y1="12" x2="12" y2="3.5" /><line x1="12" y1="12" x2="20.5" y2="12" /><line x1="12" y1="12" x2="12" y2="20.5" /><line x1="12" y1="12" x2="3.5" y2="12" />
            </g>
            <g fill="currentColor">
              <circle cx="12" cy="3.5" r="2" /><circle cx="20.5" cy="12" r="2" /><circle cx="12" cy="20.5" r="2" /><circle cx="3.5" cy="12" r="2" /><circle cx="12" cy="12" r="2.8" />
            </g>
          </svg>
        </button>

        {/* LEFT — project plate (200px). Falls back to identity when no cluster_name. */}
        <div class="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-gray-900/40 border border-gray-800/60 overflow-hidden flex-shrink-0 w-[200px]">
          <ProjectPlate />
        </div>

        {/* CENTER — zone buttons + Config text tab. Hidden on small viewports. */}
        <div class="hidden md:flex items-center gap-0 flex-shrink-0 ml-1">
          {ZONES.map((z) => (
            <ZoneButton zone={z} />
          ))}
        </div>

        <div class="flex-1" />

        {/* RIGHT — daemon pill (carries version) + theme picker.
            The cluster name is already shown on the left ProjectPlate;
            we no longer repeat it on the right. */}
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <DaemonPill />
          <ThemePicker />
        </div>
      </div>
    </header>
  );
}

function ZoneButton(props: { zone: typeof ZONES[number] }) {
  const active = () => uiStore.state.activeZone === props.zone.id;
  return (
    <button
      type="button"
      onClick={() => uiStore.setActiveZone(props.zone.id)}
      class={`px-2 py-1.5 text-[12px] transition flex items-center gap-1.5 rounded border ${
        active()
          ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
          : 'text-gray-500 hover:text-gray-200 border-transparent hover:border-gray-800/60'
      }`}
      title={props.zone.title}
    >
      <ZoneIcon id={props.zone.id} />
      <span class="hidden lg:inline">{props.zone.label}</span>
    </button>
  );
}

function ProjectPlate() {
  const p = activeProject;
  const fallbackName = () => daemonStore.state.health?.cluster_name ?? daemonStore.state.health?.identity ?? '—';
  return (
    <>
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
      <span class="text-[12px] font-semibold text-gray-100 truncate">{p()?.cluster_name ?? fallbackName()}</span>
    </>
  );
}

function DaemonPill() {
  const phase = () => daemonStore.state.phase;
  const version = () => daemonStore.state.health?.version;
  const cls = () => phase() === 'connected'
    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
    : phase() === 'connecting' || phase() === 'probing'
      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
      : 'bg-red-500/15 border-red-500/40 text-red-300';
  // When connected: show "daemon · <version>" so the operator can spot
  // auto-update bumps at a glance. Fall back to phase label when not
  // connected, or to plain "daemon" if the health snapshot hasn't
  // landed yet (rare race on first connect).
  const label = () => {
    if (phase() !== 'connected') return phase();
    const v = version();
    return v ? `daemon · ${v}` : 'daemon';
  };
  return (
    <span class={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-mono uppercase tracking-wider ${cls()}`} title="local daemon">
      <span class={`w-1.5 h-1.5 rounded-full ${phase() === 'connected' ? 'bg-emerald-400' : phase() === 'probing' || phase() === 'connecting' ? 'bg-amber-400' : 'bg-red-400'}`} />
      {label()}
    </span>
  );
}
