import { For, Show, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Modal } from '~/components/Modal';
import { chatStore } from '~/state/chat';
import type { AgentType } from '~/state/chat';
import { AGENT_TYPES, AGENT_TYPE_ORDER } from '~/lib/agent-types';
import { MODEL_CATALOG, EFFORT_CATALOG, DEFAULT_MODEL, DEFAULT_EFFORT } from '~/lib/models';
import AgentTypePill from './new-agent/AgentTypePill';

const MODEL_GROUPS = ['Latest (alias)', 'Pinned version', 'Auto'] as const;

interface OpenOpts {
  scope?: { module?: string | null; taskId?: string | null };
  defaultModel?: string;
}

interface State extends OpenOpts { open: boolean; }

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
  const [model, setModel] = createSignal(props.defaultModel ?? DEFAULT_MODEL);
  const [effort, setEffort] = createSignal(DEFAULT_EFFORT);

  const pickType = (t: AgentType) => {
    setPicked(t);
    if (!titleTouched()) setTitle(defaultTitleFor(t, props.scope));
  };

  const create = () => {
    const t = picked();
    const finalTitle = title().trim() || AGENT_TYPES[t].label;
    chatStore.createConv({ type: t, title: finalTitle, model: model(), effort: effort(), scope: props.scope });
    props.onClose();
  };

  const onClose = (id: string | null) => {
    if (id === 'create') create();
    else props.onClose();
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
          <AgentTypePill type="custom" hero picked={picked()} onPick={pickType} />
        </div>
        <div class="pt-3 border-t border-dashed border-gray-700/40 flex flex-wrap gap-1.5">
          <For each={AGENT_TYPE_ORDER.filter((t) => t !== 'custom')}>
            {(t) => <AgentTypePill type={t} picked={picked()} onPick={pickType} />}
          </For>
        </div>
        <div class="grid gap-2.5 items-end grid-cols-[1fr_140px]">
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
              <For each={MODEL_GROUPS}>{(grp) => (
                <optgroup label={grp}>
                  <For each={MODEL_CATALOG.filter((m) => m.group === grp)}>
                    {(m) => <option value={m.id}>{m.label}</option>}
                  </For>
                </optgroup>
              )}</For>
            </select>
          </div>
        </div>
        {/* MODEL hint — version, cost, "always latest" semantics. */}
        <p class="mt-1.5 text-[11px] text-gray-500 leading-snug">
          {MODEL_CATALOG.find((m) => m.id === model())?.hint ?? ''}
        </p>

        {/* MP3 (2026-06-12) — Effort = the reasoning-depth / "thinking"
            dial (claude-code `--effort`). There is no separate thinking
            toggle; effort IS it. low → fast/cheap, max → deepest. */}
        <div class="mt-3">
          <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1">
            Effort <span class="text-gray-600 normal-case tracking-normal">· reasoning depth</span>
          </label>
          <select
            value={effort()}
            onChange={(e) => setEffort(e.currentTarget.value)}
            class="w-full bg-[#020617] border border-gray-700/40 rounded-md px-2.5 py-1.5 text-[13px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
          >
            <For each={EFFORT_CATALOG}>{(e) => <option value={e.id}>{e.label}</option>}</For>
          </select>
          <p class="mt-1.5 text-[11px] text-gray-500 leading-snug">
            {EFFORT_CATALOG.find((e) => e.id === effort())?.hint ?? ''}
          </p>
        </div>
      </div>
    </Modal>
  );
}
