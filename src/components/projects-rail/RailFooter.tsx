import { createSignal, Show } from 'solid-js';
import { openAddProjectWizard } from '~/components/modals/AddProjectWizard';
import { discoverProjects, scanning, setScanning } from './discovery';

const [rescanBusy, setRescanBusy] = createSignal(false);

export function RailFooter(props: { short: boolean }) {
  return (
    <div class="border-t border-gray-800/60 p-1.5 flex flex-col gap-1">
      <button type="button" onClick={openAddProjectWizard}
        class="w-full px-2 py-1.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium hover:bg-emerald-500/25 transition flex items-center justify-center gap-1.5" title="Add another project">
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
        <Show when={!props.short}><span>add project</span></Show>
      </button>
      <button type="button" disabled={rescanBusy()}
        onClick={async () => { setRescanBusy(true); try { await discoverProjects({ fullScan: true }); } finally { setRescanBusy(false); } }}
        class="w-full px-2 py-1 rounded text-gray-400 text-[11px] hover:bg-gray-900 hover:text-gray-200 transition flex items-center justify-center gap-1.5 disabled:opacity-50" title="Rescan ports 5570-5589">
        <svg class={`w-3 h-3 ${rescanBusy() ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 019-9 9 9 0 016.5 2.8L21 8M21 3v5h-5M21 12a9 9 0 01-9 9 9 9 0 01-6.5-2.8L3 16M3 21v-5h5" /></svg>
        <Show when={!props.short}><span>rescan</span></Show>
      </button>
    </div>
  );
}

export function ScanIndicator(props: { short: boolean }) {
  return (
    <Show when={scanning()}>
      <button type="button" onClick={() => setScanning(false)}
        class="mx-1.5 mb-1.5 px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-mono flex items-center gap-1.5 hover:bg-amber-500/25" title="Stop scanning for new daemons">
        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <Show when={!props.short}><span class="flex-1 text-left">scanning…</span></Show>
        <Show when={!props.short}><span class="text-amber-200">stop</span></Show>
      </button>
    </Show>
  );
}
