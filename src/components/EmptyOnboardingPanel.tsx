/**
 * EmptyOnboardingPanel — V46 empty-state when the cluster has no
 * initiatives + no tasks (Ikamiro-style fresh repo).
 *
 * Per the V78b monolith: lead with the Coordinator CTA (→ open the
 * chat), keep the force-rebuild escape hatch tucked under an
 * <details> for users whose cached state predates the new
 * `roadmap/initiatives/` layout.
 */

import { createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { serverStore } from '~/state/server';
import { chatStore, ONBOARDING_CONV_ID } from '~/state/chat';
import { nav } from '~/state/nav';
import { log } from '~/lib/log';

export default function EmptyOnboardingPanel() {
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal<string | null>(null);

  const openCoordinatorChat = () => {
    chatStore.seedOnboardingConv();
    nav.goToConv(ONBOARDING_CONV_ID);
  };

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
    <section class="py-12 px-4 max-w-md mx-auto text-left">
      <div class="text-[17px] font-semibold text-gray-200 mb-1.5">No roadmap yet.</div>
      <p class="text-sm text-gray-400 leading-relaxed mb-4">
        Tell your <strong class="text-gray-200">Coordinator</strong> what this project is — it will draft the initiatives, tasks and context.
      </p>
      <button
        type="button"
        onClick={openCoordinatorChat}
        class="px-3 py-1.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[12px] font-mono transition-colors"
      >
        → open the chat
      </button>
      <details class="mt-6 text-[11px] text-gray-500">
        <summary class="cursor-pointer select-none hover:text-gray-400">Already initialised?</summary>
        <button
          type="button"
          onClick={rebuild}
          disabled={busy()}
          class="mt-2 px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-800/70 hover:border-emerald-500/30 hover:text-emerald-300 disabled:opacity-50 text-gray-300 border border-gray-700 text-[11px] font-mono transition-colors"
        >
          {busy() ? 'rebuilding…' : 'force rebuild state.json'}
        </button>
        <p class="text-[11px] text-gray-600 mt-2">
          {msg() ?? 'or restart meshcore on your machine'}
        </p>
      </details>
    </section>
  );
}
