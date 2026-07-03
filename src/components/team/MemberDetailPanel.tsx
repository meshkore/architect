/**
 * MemberDetailPanel — ATM6. Right-hand editor sliding over the roster.
 *
 * Per-section save: each section PATCHes only its own fields. `kind` and
 * `required` are shown but never editable (the daemon rejects them).
 * Optimistic store update with rollback + inline error on 4xx (handled
 * inside teamStore.update). A concurrent-edit warning fires when the
 * on-disk `updated:` timestamp moves while the panel is open.
 */

import { For, Show, createEffect, createMemo, createResource, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { teamStore } from '~/state/team';
import { MODEL_CATALOG, EFFORT_CATALOG } from '~/lib/models';
import { ensureMarked } from '~/lib/cdn-loaders';
import { log } from '~/lib/log';

const MODEL_GROUPS = ['Latest (alias)', 'Pinned version', 'Auto'] as const;

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
  const [model, setModel] = createSignal<string>('');
  const [effort, setEffort] = createSignal<string>('default');
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
      setModel(m.model || 'sonnet');
      setEffort(m.effort || 'default');
      setRefs(Array.isArray(m.refs) ? [...m.refs] : []);
    }
    const d = detail();
    if (d) setPrompt(d.body ?? '');
  });

  const [previewHtml] = createResource(
    () => (promptTab() === 'preview' ? prompt() : null),
    async (raw) => {
      if (!raw) return '';
      try {
        const marked = await ensureMarked();
        return marked.parse(raw, { gfm: true }) as string;
      } catch (e) {
        log.warn('member-detail marked render failed', e instanceof Error ? e.message : String(e));
        return '<p class="text-red-300">Preview unavailable (renderer failed to load).</p>';
      }
    },
  );

  const required = () => member()?.required === true;

  const saveSection = async (section: string, body: Record<string, unknown>): Promise<void> => {
    const c = client();
    if (!c) return;
    setSavingSection(section);
    setError(null);
    const res = await teamStore.update(c, props.memberId, body);
    setSavingSection(null);
    if (!res.ok) {
      setError(`Save failed (HTTP ${res.status}) — reverted.`);
    }
  };

  const addRef = () => setRefs((xs) => [...xs, '']);
  const setRefAt = (i: number, v: string) => setRefs((xs) => xs.map((r, j) => (j === i ? v : r)));
  const removeRef = (i: number) => setRefs((xs) => xs.filter((_, j) => j !== i));

  const del = async (): Promise<void> => {
    const c = client();
    if (!c) return;
    if (!confirm(`Delete member "${member()?.name ?? props.memberId}"? This cannot be undone.`)) return;
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
        {/* Header */}
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

          {/* Section 1 — Model & effort */}
          <section class="space-y-3">
            <div class="flex items-center justify-between">
              <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">Model &amp; effort</h3>
              <button
                type="button"
                onClick={() => void saveSection('model', { model: model(), effort: effort() })}
                disabled={savingSection() === 'model'}
                class="text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1 disabled:opacity-50"
              >{savingSection() === 'model' ? 'Saving…' : 'Save'}</button>
            </div>
            <select
              value={model()}
              onChange={(e) => setModel(e.currentTarget.value)}
              class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[13px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
            >
              <For each={MODEL_GROUPS}>{(grp) => (
                <optgroup label={grp}>
                  <For each={MODEL_CATALOG.filter((m) => m.group === grp)}>
                    {(m) => <option value={m.id}>{m.label}</option>}
                  </For>
                </optgroup>
              )}</For>
            </select>
            <div class="flex flex-wrap gap-1">
              <For each={EFFORT_CATALOG}>
                {(e) => (
                  <button
                    type="button"
                    onClick={() => setEffort(e.id)}
                    aria-pressed={effort() === e.id}
                    class="px-2.5 py-1.5 text-[12px] font-mono border transition flex-shrink-0"
                    classList={{
                      'bg-emerald-500/12 border-emerald-500/60 text-white': effort() === e.id,
                      'bg-[rgba(11,18,32,0.5)] border-gray-700/40 text-gray-300 hover:text-gray-100': effort() !== e.id,
                    }}
                  >{e.label}</button>
                )}
              </For>
            </div>
          </section>

          {/* Section 2 — Init prompt */}
          <section class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">Init prompt</h3>
              <div class="flex items-center gap-1.5">
                <div class="flex rounded border border-gray-700/50 overflow-hidden">
                  <button type="button" onClick={() => setPromptTab('edit')}
                    class={`px-2 py-0.5 text-[11px] font-mono ${promptTab() === 'edit' ? 'bg-emerald-500/15 text-emerald-200' : 'text-gray-400 hover:text-gray-200'}`}>Edit</button>
                  <button type="button" onClick={() => setPromptTab('preview')}
                    class={`px-2 py-0.5 text-[11px] font-mono ${promptTab() === 'preview' ? 'bg-emerald-500/15 text-emerald-200' : 'text-gray-400 hover:text-gray-200'}`}>Preview</button>
                </div>
                <button
                  type="button"
                  onClick={() => void saveSection('prompt', { prompt: prompt() })}
                  disabled={savingSection() === 'prompt'}
                  class="text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1 disabled:opacity-50"
                >{savingSection() === 'prompt' ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
            <Show
              when={promptTab() === 'edit'}
              fallback={
                <div
                  class="prose prose-sm prose-invert max-w-none bg-[#020617] border border-gray-700/40 rounded px-3 py-2 text-[13px] text-gray-200 min-h-[20rem] overflow-y-auto [&_h1]:text-[15px] [&_h2]:text-[13px] [&_h2]:font-semibold [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-emerald-300/90 [&_code]:bg-gray-900/60 [&_code]:px-1 [&_code]:rounded [&_a]:text-sky-300 [&_a]:underline"
                  innerHTML={previewHtml() ?? ''}
                />
              }
            >
              <textarea
                rows={20}
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
                class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-2 text-[12px] font-mono leading-relaxed text-gray-100 focus:outline-none focus:border-emerald-500/55 resize-y"
              />
            </Show>
          </section>

          {/* Section 3 — References */}
          <section class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">References</h3>
              <div class="flex items-center gap-1.5">
                <button type="button" onClick={addRef} class="text-[11px] font-mono text-emerald-300/80 hover:text-emerald-200">+ add</button>
                <button
                  type="button"
                  onClick={() => void saveSection('refs', { refs: refs().map((r) => r.trim()).filter(Boolean) })}
                  disabled={savingSection() === 'refs'}
                  class="text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1 disabled:opacity-50"
                >{savingSection() === 'refs' ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
            <div class="space-y-1.5">
              <For each={refs()}>
                {(r, i) => (
                  <div class="flex gap-1.5">
                    <input
                      type="text"
                      value={r}
                      onInput={(e) => setRefAt(i(), e.currentTarget.value)}
                      placeholder=".meshkore/context/stack.md"
                      class="flex-1 bg-[#020617] border border-gray-700/40 rounded px-2 py-1 text-[12px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
                    />
                    <button type="button" onClick={() => removeRef(i())} class="px-2 text-gray-500 hover:text-red-300" title="Remove">✕</button>
                  </div>
                )}
              </For>
              <Show when={refs().length === 0}>
                <p class="text-[11px] text-gray-600 italic">No references.</p>
              </Show>
            </div>
          </section>

          {/* Section 4 — Danger zone (hidden when required) */}
          <Show when={!required()}>
            <section class="space-y-2 pt-2 border-t border-gray-800/60">
              <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-red-400/80">Danger zone</h3>
              <button
                type="button"
                onClick={() => void del()}
                class="text-[12px] font-mono text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 rounded px-3 py-1.5"
              >Delete member</button>
            </section>
          </Show>
        </div>
      </aside>
    </div>
  );
}
