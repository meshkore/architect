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
 *
 * AX17 moved the two form steps into `team/new-member/`; the engine
 * picker is shared with MemberDetailPanel so both write the same
 * client/provider/model/effort combination.
 */

import { Match, Show, Switch, createMemo, createSignal } from 'solid-js';
import { Modal } from '~/components/Modal';
import { daemonStore } from '~/state/daemon';
import { teamStore } from '~/state/team';
import { DEFAULT_PROVIDER } from '~/lib/models';
import { engineBody, type EngineChoice } from '~/components/team/ClientModelEffortPicker';
import { InputStep } from '~/components/team/new-member/InputStep';
import { ReviewStep } from '~/components/team/new-member/ReviewStep';
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
  const [engine, setEngine] = createSignal<EngineChoice>({
    client: 'claude-code',
    provider: DEFAULT_PROVIDER,
    model: 'sonnet',
    effort: 'default',
  });
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
      setEngine((e) => ({ ...e, model: d.model || 'sonnet', effort: d.effort || 'default' }));
      setRefs(Array.isArray(d.refs) ? d.refs : []);
      setPrompt(d.prompt || rawText().trim());
      if (d.name) setName(d.name);
      if (d.emoji) setEmoji(d.emoji);
    } else {
      // Normaliser failed (timeout / key missing / no /team/draft route):
      // fall through to review with the raw text + safe defaults so the
      // operator can still save manually.
      setEngine((e) => ({ ...e, model: 'sonnet', effort: 'default' }));
      setRefs([]);
      setPrompt(rawText().trim());
      setError('Auto-draft unavailable — review the fields below and save manually.');
    }
    setStep('review');
  };

  const create = async (): Promise<void> => {
    const c = client();
    if (!c) return;
    setSaving(true);
    setError(null);
    const body: TeamCreateBody = {
      name: name().trim(),
      emoji: emoji().trim() || '🤖',
      ...engineBody(engine()),
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
        <Match when={step() === 'input'}>
          <InputStep
            name={name()}
            onName={setName}
            emoji={emoji()}
            onEmoji={setEmoji}
            rawText={rawText()}
            onRawText={setRawText}
            canSubmit={canSubmitInput()}
          />
        </Match>

        <Match when={step() === 'loading'}>
          <div class="flex items-center gap-3 py-10 justify-center text-gray-400">
            <span class="inline-block w-4 h-4 rounded-full border-2 border-emerald-400/70 border-t-transparent animate-spin" aria-hidden="true" />
            <span class="text-[13px]">Drafting the member profile… (2–5s)</span>
          </div>
        </Match>

        <Match when={step() === 'review'}>
          <ReviewStep
            name={name()}
            onName={setName}
            emoji={emoji()}
            onEmoji={setEmoji}
            engine={engine()}
            onEngine={setEngine}
            refs={refs()}
            onRefs={setRefs}
            prompt={prompt()}
            onPrompt={setPrompt}
          />
        </Match>
      </Switch>
    </Modal>
  );
}
