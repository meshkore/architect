/**
 * NewMemberDialog — ATM4. Free-text mission → structured member draft.
 *
 * Flow: (1) operator types a paragraph + name + emoji, (2) POST
 * /team/draft runs the daemon's LLM normaliser, (3) operator reviews /
 * tweaks the structured fields (model is a required picker), (4) POST
 * /team creates the member; the roster picks it up via the team.created
 * WS event and highlights the new card.
 *
 * Error paths (ATM4): normaliser failure → jump straight to review with
 * the raw text prefilled as the prompt + safe defaults; slug collision
 * (409) → suggest a suffixed name so the operator is never dead-ended.
 */

import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import { Modal } from '~/components/Modal';
import { daemonStore } from '~/state/daemon';
import { teamStore } from '~/state/team';
import { clientsStore } from '~/state/clients';
import { EFFORT_CATALOG, DEFAULT_PROVIDER, providerCatalog } from '~/lib/models';
import type { TeamCreateBody } from '~/lib/daemon-client';

type Step = 'input' | 'loading' | 'review';

export default function NewMemberDialog(props: { onClose: () => void; onCreated?: (id: string) => void }) {
  const client = () => daemonStore.state.client;

  const [step, setStep] = createSignal<Step>('input');

  // Step 1 fields.
  const [rawText, setRawText] = createSignal('');
  const [name, setName] = createSignal('');
  const [emoji, setEmoji] = createSignal('🤖');

  // Step 3 (review) fields — prefilled from the draft.
  const [model, setModel] = createSignal('sonnet');
  const [effort, setEffort] = createSignal('default');
  // DM-CLI-08 (multi-cli-clients) — which CLI dispatches this member.
  // Default claude-code; changing it re-populates model/effort below
  // from that client's own catalog (clientsStore.catalogFor).
  const [selectedClient, setSelectedClient] = createSignal('claude-code');
  // MPV1 (multi-provider-agents) — provider for the claude-code client.
  const [provider, setProvider] = createSignal(DEFAULT_PROVIDER);
  const catalog = createMemo(() => clientsStore.catalogFor(selectedClient()));
  const providerOptions = createMemo(() => clientsStore.providersFor('claude-code'));
  const providerModels = createMemo(() => providerCatalog(provider()));
  const modelGroups = createMemo(() => [...new Set(providerModels().map((m) => m.group))]);
  const onClientChange = (id: string) => {
    setSelectedClient(id);
    const cat = clientsStore.catalogFor(id);
    // Reset to that client's own first option so a leftover
    // claude-code model/effort id never gets submitted for a different
    // client's member.
    setModel(cat.models[0]?.id ?? '');
    setEffort(cat.efforts[0]?.id ?? 'default');
  };
  const onProviderChange = (id: string) => {
    setProvider(id);
    setModel(providerCatalog(id)[0]?.id ?? '');
  };
  const [refs, setRefs] = createSignal<string[]>([]);
  const [prompt, setPrompt] = createSignal('');

  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  const canSubmitInput = createMemo(() => name().trim().length > 0 && rawText().trim().length > 0);

  const runDraft = async (): Promise<void> => {
    const c = client();
    if (!c || !canSubmitInput()) return;
    setError(null);
    setStep('loading');
    const res = await c.teamDraft({ name: name().trim(), emoji: emoji().trim() || '🤖', raw_text: rawText().trim() });
    if (res.ok) {
      const d = res.data;
      setModel(d.model || 'sonnet');
      setEffort(d.effort || 'default');
      setRefs(Array.isArray(d.refs) ? d.refs : []);
      setPrompt(d.prompt || rawText().trim());
      if (d.name) setName(d.name);
      if (d.emoji) setEmoji(d.emoji);
    } else {
      // Normaliser failed (timeout / key missing / no /team/draft route):
      // fall through to review with the raw text + safe defaults so the
      // operator can still save manually.
      setModel('sonnet');
      setEffort('default');
      setRefs([]);
      setPrompt(rawText().trim());
      setError('Auto-draft unavailable — review the fields below and save manually.');
    }
    setStep('review');
  };

  const addRef = () => setRefs((xs) => [...xs, '']);
  const setRefAt = (i: number, v: string) => setRefs((xs) => xs.map((r, j) => (j === i ? v : r)));
  const removeRef = (i: number) => setRefs((xs) => xs.filter((_, j) => j !== i));

  const create = async (): Promise<void> => {
    const c = client();
    if (!c) return;
    setSaving(true);
    setError(null);
    const body: TeamCreateBody = {
      name: name().trim(),
      emoji: emoji().trim() || '🤖',
      client: selectedClient(),
      provider: selectedClient() === 'claude-code' ? provider() : DEFAULT_PROVIDER,
      model: model(),
      effort: effort(),
      kind: 'profile',
      refs: refs().map((r) => r.trim()).filter(Boolean),
      prompt: prompt(),
    };
    const res = await teamStore.create(c, body);
    setSaving(false);
    if (res.ok) {
      props.onCreated?.(res.member.id);
      props.onClose();
      return;
    }
    if (res.status === 409) {
      // Slug collision — suggest a suffix so the operator isn't stuck.
      setName((n) => (/-\d+$/.test(n) ? n.replace(/-(\d+)$/, (_, d) => `-${Number(d) + 1}`) : `${n}-2`));
      setError('A member with that name already exists — a suffix was suggested. Adjust and Create again.');
      return;
    }
    setError(`Create failed (HTTP ${res.status}). Adjust and try again.`);
  };

  const onModalClose = (id: string | null) => {
    if (id === 'back') { setStep('input'); return; }
    if (id === 'draft') { void runDraft(); return; }
    if (id === 'create') { void create(); return; }
    props.onClose();
  };

  const buttons = createMemo(() => {
    if (step() === 'input') {
      return [
        { id: 'cancel', label: 'Cancel' },
        { id: 'draft', label: 'Draft with AI', primary: true },
      ];
    }
    if (step() === 'review') {
      return [
        { id: 'back', label: 'Back' },
        { id: 'create', label: saving() ? 'Creating…' : 'Create', primary: true },
      ];
    }
    return [{ id: 'cancel', label: 'Cancel' }];
  });

  return (
    <Modal
      isOpen={true}
      onClose={onModalClose}
      title="New team member"
      subtitle="Describe the member in plain language — the daemon drafts a structured profile you confirm."
      zIndex={60}
      buttons={buttons()}
    >
      <Show when={error()}>
        <div class="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
          {error()}
        </div>
      </Show>

      <Switch>
        {/* STEP 1 — free text */}
        <Match when={step() === 'input'}>
          <div class="space-y-4">
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Name</label>
                <input
                  type="text"
                  autofocus
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  placeholder="e.g. SEO writer"
                  class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[13px] text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500/55"
                />
              </div>
              <div class="w-24">
                <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Emoji</label>
                <input
                  type="text"
                  value={emoji()}
                  onInput={(e) => setEmoji(e.currentTarget.value)}
                  maxLength={4}
                  class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[16px] text-center text-gray-100 focus:outline-none focus:border-emerald-500/55"
                />
              </div>
            </div>
            <div>
              <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">
                Describe what this team member does
              </label>
              <textarea
                rows={10}
                value={rawText()}
                onInput={(e) => setRawText(e.currentTarget.value)}
                placeholder="Its mission, the docs it should know, the credentials it can access, its limits."
                class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-2 text-[13px] leading-relaxed text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500/55 resize-y"
              />
            </div>
            <Show when={!canSubmitInput()}>
              <p class="text-[11px] text-gray-500">A name and a description are required.</p>
            </Show>
          </div>
        </Match>

        {/* STEP 2 — loading */}
        <Match when={step() === 'loading'}>
          <div class="flex items-center gap-3 py-10 justify-center text-gray-400">
            <span class="inline-block w-4 h-4 rounded-full border-2 border-emerald-400/70 border-t-transparent animate-spin" aria-hidden="true" />
            <span class="text-[13px]">Drafting the member profile… (2–5s)</span>
          </div>
        </Match>

        {/* STEP 3 — review & save */}
        <Match when={step() === 'review'}>
          <div class="space-y-4">
            <div class="flex gap-3">
              <div class="flex-1">
                <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Name</label>
                <input
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[13px] text-gray-100 focus:outline-none focus:border-emerald-500/55"
                />
              </div>
              <div class="w-24">
                <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Emoji</label>
                <input
                  type="text"
                  value={emoji()}
                  onInput={(e) => setEmoji(e.currentTarget.value)}
                  maxLength={4}
                  class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[16px] text-center text-gray-100 focus:outline-none focus:border-emerald-500/55"
                />
              </div>
            </div>

            {/* Client — DM-CLI-08. Default claude-code; switching
                re-populates Model/Effort below from that client's own
                catalog (clientsStore.catalogFor). */}
            <div>
              <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Client</label>
              <select
                value={selectedClient()}
                onChange={(e) => onClientChange(e.currentTarget.value)}
                class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[13px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
              >
                <For each={clientsStore.options()}>
                  {(c) => (
                    <option value={c.id} disabled={c.installed === false || c.authConfigured === false}>
                      {c.label}
                      {c.installed === false
                        ? ' (not installed on daemon host)'
                        : c.authConfigured === false
                          ? ' (no API key — set in ⚙ General settings)'
                          : ''}
                    </option>
                  )}
                </For>
              </select>
            </div>

            {/* Provider — MPV1, claude-code only. Repopulates Model below. */}
            <Show when={selectedClient() === 'claude-code'}>
              <div>
                <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Provider</label>
                <select
                  value={provider()}
                  onChange={(e) => onProviderChange(e.currentTarget.value)}
                  class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[13px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
                >
                  <For each={providerOptions()}>
                    {(pr) => (
                      <option value={pr.id} disabled={!pr.available && pr.id !== provider()}>
                        {pr.label}
                        {pr.requiresKey && !pr.available ? ' (needs API key — set in Config)' : ''}
                      </option>
                    )}
                  </For>
                </select>
              </div>
            </Show>

            {/* Model — required picker */}
            <div>
              <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Model <span class="text-gray-600 normal-case tracking-normal">· required</span></label>
              <Show
                when={selectedClient() === 'claude-code'}
                fallback={
                  <select
                    value={model()}
                    onChange={(e) => setModel(e.currentTarget.value)}
                    class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[13px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
                  >
                    <For each={catalog().models}>{(m) => <option value={m.id}>{m.label}</option>}</For>
                  </select>
                }
              >
                <select
                  value={model()}
                  onChange={(e) => setModel(e.currentTarget.value)}
                  class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[13px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
                >
                  <For each={modelGroups()}>{(grp) => (
                    <optgroup label={grp}>
                      <For each={providerModels().filter((m) => m.group === grp)}>
                        {(m) => <option value={m.id}>{m.label}</option>}
                      </For>
                    </optgroup>
                  )}</For>
                </select>
              </Show>
            </div>

            {/* Effort */}
            <div>
              <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Effort <span class="text-gray-600 normal-case tracking-normal">· reasoning depth</span></label>
              <div class="flex flex-wrap gap-1">
                <For each={selectedClient() === 'claude-code' ? EFFORT_CATALOG : catalog().efforts}>
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
            </div>

            {/* References */}
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">References</label>
                <button type="button" onClick={addRef} class="text-[11px] font-mono text-emerald-300/80 hover:text-emerald-200">+ add</button>
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
                  <p class="text-[11px] text-gray-600 italic">No references. Add paths/URLs the member should consult.</p>
                </Show>
              </div>
            </div>

            {/* Init prompt */}
            <div>
              <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Init prompt</label>
              <textarea
                rows={12}
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
                class="w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-2 text-[12px] font-mono leading-relaxed text-gray-100 focus:outline-none focus:border-emerald-500/55 resize-y"
              />
            </div>
          </div>
        </Match>
      </Switch>
    </Modal>
  );
}
