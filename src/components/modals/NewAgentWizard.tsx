/**
 * NewAgentWizard — single-step "+ new agent" modal (V79p / V80 parity).
 *
 * Operator decision 2026-05-25: no multi-step wizard. One screen:
 *   1. Hero pill row   — General coder (custom), selected by default
 *   2. Separator       — thin dashed border
 *   3. Service pills   — deploy / db / testing / audit / docs / review
 *   4. Title + Model   — grid row (text input + 140px select)
 *   5. Footer          — Cancel + Create agent (modal primitive default)
 *
 * Behaviour: type pills auto-populate Title until the operator types,
 * then the field locks. Enter submits. Pill colours come from
 * `agent-types.ts` (M5.5). The created conv is registered in chatStore
 * via createConv(); the picked type rides every subsequent dispatch as
 * `agent_type` + `agent_id` (M2.4 wiring).
 */

import { For, Show, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Modal } from '~/components/Modal';
import { chatStore } from '~/state/chat';
import type { AgentType } from '~/state/chat';
import { AGENT_TYPES, AGENT_TYPE_ORDER } from '~/lib/agent-types';

const MODEL_OPTIONS = ['auto', 'opus', 'sonnet', 'haiku'];

interface OpenOpts {
  scope?: { module?: string | null; taskId?: string | null };
  defaultModel?: string;
}

interface State extends OpenOpts {
  open: boolean;
}

const [state, setState] = createSignal<State>({ open: false });

export function openNewAgentWizard(opts: OpenOpts = {}): void {
  setState({ open: true, scope: opts.scope, defaultModel: opts.defaultModel });
}

function defaultTitleFor(type: AgentType, scope?: OpenOpts['scope']): string {
  if (type === 'custom') return (scope?.taskId || scope?.module || '').toString();
  return AGENT_TYPES[type].label;
}

export function NewAgentWizardHost() {
  return (
    <Portal mount={document.body}>
      <Show when={state().open}>
        <NewAgentWizard
          scope={state().scope}
          defaultModel={state().defaultModel}
          onClose={() => setState({ open: false })}
        />
      </Show>
    </Portal>
  );
}

function NewAgentWizard(props: {
  scope?: OpenOpts['scope'];
  defaultModel?: string;
  onClose: () => void;
}) {
  const [picked, setPicked] = createSignal<AgentType>('custom');
  const [title, setTitle] = createSignal(defaultTitleFor('custom', props.scope));
  const [titleTouched, setTitleTouched] = createSignal(false);
  const [model, setModel] = createSignal(props.defaultModel ?? 'auto');

  const pickType = (t: AgentType) => {
    setPicked(t);
    if (!titleTouched()) setTitle(defaultTitleFor(t, props.scope));
  };

  const create = () => {
    const t = picked();
    const finalTitle = title().trim() || AGENT_TYPES[t].label;
    chatStore.createConv({
      type: t,
      title: finalTitle,
      model: model(),
      scope: props.scope,
    });
    props.onClose();
  };

  const onClose = (id: string | null) => {
    if (id === 'create') create();
    else props.onClose();
  };

  const Pill = (p: { type: AgentType; hero?: boolean }) => {
    const info = AGENT_TYPES[p.type];
    const active = () => picked() === p.type;
    return (
      <button
        type="button"
        onClick={() => pickType(p.type)}
        aria-pressed={active()}
        class="inline-flex items-center gap-1.5 rounded-full bg-[rgba(11,18,32,0.6)] border transition hover:bg-[rgba(11,18,32,0.9)]"
        classList={{
          'px-3 py-1.5 text-[13px]': p.hero,
          'px-2.5 py-1 text-[12px]': !p.hero,
          'text-white': active(),
          'text-gray-300': !active(),
        }}
        style={{
          'border-color': active() ? info.color : 'rgba(75,85,99,0.40)',
          'border-left': `3px solid ${info.color}`,
          'box-shadow': active() ? `inset 0 0 0 1px ${info.color}` : 'none',
        }}
      >
        <span aria-hidden="true">{info.emoji}</span>
        <span>{info.label}</span>
      </button>
    );
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="New agent"
      subtitle="Type · title · model."
      zIndex={60}
      buttons={[
        { id: 'cancel', label: 'Cancel' },
        { id: 'create', label: 'Create agent', primary: true },
      ]}
    >
      <div class="space-y-4">
        <div>
          <Pill type="custom" hero />
        </div>
        <div class="pt-3 border-t border-dashed border-gray-700/40 flex flex-wrap gap-1.5">
          <For each={AGENT_TYPE_ORDER.filter((t) => t !== 'custom')}>
            {(t) => <Pill type={t} />}
          </For>
        </div>
        <div class="grid gap-2.5 items-end" style={{ 'grid-template-columns': '1fr 140px' }}>
          <div>
            <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1">Title</label>
            <input
              type="text"
              autofocus
              value={title()}
              onInput={(e) => { setTitle(e.currentTarget.value); setTitleTouched(true); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
              placeholder="e.g. webapp deploy"
              class="w-full bg-[#020617] border border-gray-700/40 rounded-md px-2.5 py-1.5 text-[13px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
            />
          </div>
          <div>
            <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1">Model</label>
            <select
              value={model()}
              onChange={(e) => setModel(e.currentTarget.value)}
              class="w-full bg-[#020617] border border-gray-700/40 rounded-md px-2.5 py-1.5 text-[13px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
            >
              <For each={MODEL_OPTIONS}>{(m) => <option value={m}>{m}</option>}</For>
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}
