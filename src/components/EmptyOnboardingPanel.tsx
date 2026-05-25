/**
 * EmptyOnboardingPanel — V46 empty-state when the cluster has no
 * initiatives AND no tasks (Ikamiro-style fresh repo).
 *
 * Behaviour matches the V46 monolith: explain what's expected,
 * point at the canonical folder, expose a "force rebuild" button
 * that hits the daemon's /reload endpoint.
 */

import { createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { serverStore } from '~/state/server';
import { log } from '~/lib/log';

export default function EmptyOnboardingPanel() {
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal<string | null>(null);

  async function rebuild() {
    const client = daemonStore.state.client;
    if (!client) { setMsg('No daemon client'); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await client.reload();
      if (!res.ok) { setMsg(`Reload failed (${res.status})`); return; }
      await serverStore.refreshNow(client);
      setMsg('Rebuilt.');
    } catch (e) {
      log.warn('reload failed', e);
      setMsg('Reload failed — restart meshcore.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="py-12 px-6 text-center">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium mb-5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Empty cluster
      </div>
      <h2 class="text-xl font-bold text-gray-100 mb-2">No roadmap yet</h2>
      <p class="text-sm text-gray-400 leading-relaxed max-w-md mx-auto mb-5">
        This cluster has no initiatives or tasks. Drop markdown files under{' '}
        <code class="font-mono text-emerald-300">.meshkore/roadmap/initiatives/</code> and{' '}
        <code class="font-mono text-emerald-300">.meshkore/modules/&lt;id&gt;/tasks/</code> to populate the roadmap, then rebuild.
      </p>
      <button
        type="button"
        onClick={rebuild}
        disabled={busy()}
        class="px-3 py-1.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 text-emerald-300 border border-emerald-500/30 text-xs font-mono transition-colors"
      >
        {busy() ? 'rebuilding…' : 'force rebuild state.json'}
      </button>
      <p class="text-[11px] text-gray-600 mt-3">
        {msg() ?? 'or restart meshcore on your machine'}
      </p>
    </section>
  );
}
