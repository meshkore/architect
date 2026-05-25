import { createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { mcAlert, mcConfirm } from '~/lib/modal';
import { Block, KV, BtnRow, Btn } from './atoms';
import { CLUSTER_YAML } from './yaml-shortcut';

export function DaemonBlock() {
  const [busy, setBusy] = createSignal<'rebuild' | 'shutdown' | null>(null);

  async function forceRebuild() {
    const c = daemonStore.state.client;
    if (!c) { void mcAlert('Daemon offline.', { title: 'No daemon' }); return; }
    setBusy('rebuild');
    try {
      const r = await c.reload();
      if (!r.ok) void mcAlert(`Rebuild failed: ${r.status} ${r.body.slice(0, 200)}`, { title: 'Error' });
      else void mcAlert(`state.json rebuilt at ${r.data.generated_at}.`, { title: 'Rebuilt' });
    } finally { setBusy(null); }
  }

  async function forceShutdown() {
    const ok = await mcConfirm(
      'Stop the local daemon? You will lose the WS feed until you restart it (npx meshcore start).',
      { title: 'Force shutdown daemon', okLabel: 'Shutdown', danger: true },
    );
    if (!ok) return;
    const c = daemonStore.state.client;
    if (!c) return;
    setBusy('shutdown');
    try {
      const r = await c.shutdown();
      if (!r.ok && r.status !== 0) void mcAlert(`Shutdown failed: ${r.status} ${r.body.slice(0, 200)}`, { title: 'Error' });
      else void mcAlert('Daemon stopping. Run `npx meshcore start` to bring it back.', { title: 'Shutting down' });
    } finally { setBusy(null); }
  }

  function toggleAutoUpdate() {
    const on = daemonStore.state.autoUpdateEnabled;
    void mcAlert(
      `Auto-update is currently ${on ? 'ON' : 'OFF'}.\n\nEdit ${CLUSTER_YAML} and set:\n\n  daemon:\n    auto_update: ${on ? 'false' : 'true'}\n\nThe daemon picks up the change on the next watcher tick (Standard v7 §10.4).`,
      { title: 'Toggle daemon.auto_update' },
    );
  }

  const h = () => daemonStore.state.health;
  return (
    <Block title="Daemon" subtitle="Local meshcore process controls.">
      <KV k="version" v={h()?.version ?? '—'} />
      <KV k="implementation" v={h()?.implementation ?? '—'} />
      <KV k="auto_update" v={daemonStore.state.autoUpdateEnabled ? 'true' : 'false'} />
      <KV k="self-update" v={daemonStore.state.supportsSelfUpdate ? 'supported' : 'not supported'} />
      <BtnRow>
        <Btn onClick={toggleAutoUpdate}>toggle auto_update ({daemonStore.state.autoUpdateEnabled ? 'on → off' : 'off → on'})</Btn>
        <Btn onClick={forceRebuild} disabled={busy() !== null}>{busy() === 'rebuild' ? '…' : 'force rebuild state.json'}</Btn>
        <Btn onClick={forceShutdown} disabled={busy() !== null} danger>{busy() === 'shutdown' ? '…' : 'force shutdown daemon'}</Btn>
      </BtnRow>
    </Block>
  );
}
