/**
 * MemberDetailPanel — ATM6. Right-hand editor sliding over the roster.
 *
 * Per-section save: each section PATCHes only its own fields. `kind` and
 * `required` are shown but never editable (the daemon rejects them).
 * Optimistic store update with rollback + inline error on 4xx (handled
 * inside teamStore.update). A concurrent-edit warning fires when the
 * on-disk `updated:` timestamp moves while the panel is open.
 *
 * AX17 split the sections out to `team/detail/`; what stays here is the
 * shell: the working copies seeded from the member, the `saveSection`
 * plumbing every section shares, and the danger zone.
 */

import { Show, createEffect, createMemo, createResource, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { teamStore } from '~/state/team';
import { DEFAULT_PROVIDER } from '~/lib/models';
import type { EngineChoice } from '~/components/team/ClientModelEffortPicker';
import { ModelSection } from '~/components/team/detail/ModelSection';
import { PromptSection } from '~/components/team/detail/PromptSection';
import { RefsSection } from '~/components/team/detail/RefsSection';
import { ExternalAccessSection } from '~/components/team/detail/ExternalAccessSection';
import { ConfirmButtons } from '~/components/ui/ConfirmButtons';

export default function MemberDetailPanel(props: { memberId: string; onClose: () => void; onDeleted?: () => void }) {
  const client = () => daemonStore.state.client;
  const member = () => teamStore.get(props.memberId);

  // Lazy-load the init-prompt body.
  const [detail] = createResource(
    () => props.memberId,
    async (id) => {
      const c = client();
      if (!c) return null;
      return teamStore.detail(c, id);
    },
  );

  // Editable working copies (seeded from the member / detail once loaded).
  const [engine, setEngine] = createSignal<EngineChoice>({
    client: 'claude-code',
    provider: DEFAULT_PROVIDER,
    model: 'sonnet',
    effort: 'default',
  });
  const [prompt, setPrompt] = createSignal<string>('');
  const [refs, setRefs] = createSignal<string[]>([]);
  const [promptTab, setPromptTab] = createSignal<'edit' | 'preview'>('edit');

  const [savingSection, setSavingSection] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  // Capture the on-disk `updated:` at mount; warn if it moves (another
  // cockpit tab edited the same member) — ATM6 concurrent-edit warning.
  const mountedUpdated = member()?.updated ?? null;
  const diskMoved = createMemo(() => {
    const cur = member()?.updated ?? null;
    return mountedUpdated !== null && cur !== null && cur !== mountedUpdated;
  });

  // Seed working copies once the frontmatter + body are available.
  createEffect(() => {
    const m = member();
    if (m) {
      setEngine({
        client: m.client || 'claude-code',
        provider: m.provider || DEFAULT_PROVIDER,
        model: m.model || 'sonnet',
        effort: m.effort || 'default',
      });
      setRefs(Array.isArray(m.refs) ? [...m.refs] : []);
    }
    const d = detail();
    if (d) setPrompt(d.body ?? '');
  });

  const required = () => member()?.required === true;
  const exposure = () => member()?.exposure ?? 'internal';

  const saveSection = async (section: string, body: Record<string, unknown>): Promise<void> => {
    const c = client();
    if (!c) {
      setError('Not connected to the daemon — reconnect (reload the page) and try again.');
      return;
    }
    setSavingSection(section);
    setError(null);
    const res = await teamStore.update(c, props.memberId, body);
    setSavingSection(null);
    if (!res.ok) setError(`Save failed (HTTP ${res.status}) — reverted.`);
  };

  const del = async (): Promise<void> => {
    const c = client();
    if (!c) {
      setError('Not connected to the daemon — reconnect (reload the page) and try again.');
      return;
    }
    const res = await teamStore.remove(c, props.memberId);
    if (res.ok) {
      props.onDeleted?.();
      props.onClose();
    } else if (res.status === 409) {
      setError('This member is required and cannot be deleted.');
    } else {
      setError(`Delete failed (HTTP ${res.status}).`);
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex justify-end" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="absolute inset-0 bg-[rgba(2,4,12,0.6)] backdrop-blur-sm" aria-hidden="true" />
      <aside class="relative w-full max-w-xl h-full bg-[#0b1220] border-l border-gray-700/40 shadow-2xl flex flex-col">
        <header class="flex items-center gap-2.5 px-4 py-3 border-b border-gray-800/60">
          <span class="text-2xl leading-none" aria-hidden="true">{member()?.emoji ?? '🤖'}</span>
          <div class="flex-1 min-w-0">
            <h2 class="text-[15px] font-semibold text-gray-100 truncate">{member()?.name ?? props.memberId}</h2>
            <div class="flex items-center gap-1.5 mt-0.5">
              <span class="font-mono text-[9px] uppercase tracking-wider text-gray-400 bg-gray-800/60 border border-gray-700/60 rounded px-1.5 py-0.5">
                {member()?.kind ?? 'profile'}
              </span>
              <Show when={required()}>
                <span class="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5" title="Required member — kind/required immutable, cannot be deleted">
                  🔒 required
                </span>
              </Show>
            </div>
          </div>
          <button type="button" onClick={props.onClose} class="text-gray-400 hover:text-gray-100 px-2 py-1" aria-label="Close">✕</button>
        </header>

        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          <Show when={diskMoved()}>
            <div class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
              This member was changed elsewhere since you opened it. Saving here overwrites those changes (last-write-wins).
            </div>
          </Show>
          <Show when={error()}>
            <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error()}</div>
          </Show>

          <ModelSection
            value={engine()}
            onChange={setEngine}
            saving={savingSection() === 'model'}
            onSave={(body) => { void saveSection('model', body); }}
          />

          <PromptSection
            prompt={prompt()}
            onPrompt={setPrompt}
            tab={promptTab()}
            onTab={setPromptTab}
            saving={savingSection() === 'prompt'}
            onSave={(body) => { void saveSection('prompt', body); }}
          />

          <RefsSection
            refs={refs()}
            onRefs={setRefs}
            saving={savingSection() === 'refs'}
            onSave={(body) => { void saveSection('refs', body); }}
          />

          <ExternalAccessSection
            memberId={props.memberId}
            exposure={exposure()}
            savingSection={savingSection()}
            onError={setError}
            onSave={saveSection}
            onSavingSection={setSavingSection}
          />

          {/* Danger zone — hidden when the member is required. */}
          <Show when={!required()}>
            <section class="space-y-2 pt-2 border-t border-gray-800/60">
              <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-red-400/80">Danger zone</h3>
              <ConfirmButtons
                question={`Delete "${member()?.name ?? props.memberId}"? This cannot be undone.`}
                confirmLabel="Delete"
                onConfirm={() => { void del(); }}
                trigger={(arm) => (
                  <button
                    type="button"
                    onClick={arm}
                    class="text-[12px] font-mono text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 rounded px-3 py-1.5"
                  >Delete member</button>
                )}
              />
            </section>
          </Show>
        </div>
      </aside>
    </div>
  );
}
