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
  const [editingTitle, setEditingTitle] = createSignal(false);
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
      subtitleNode={
        /* 2026-06-13 — editable title lives in the header (operator
           request). Click the line → inline input; Enter / blur
           commits. Placeholder when empty. */
        <Show
          when={editingTitle()}
          fallback={
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              class="group inline-flex items-center gap-1.5 text-left max-w-full"
              title="Click to rename"
            >
              <span class={`truncate text-[13px] ${title().trim() ? 'text-gray-200' : 'text-gray-500 italic'}`}>
                {title().trim() || 'Untitled agent — click to name'}
              </span>
              <svg class="w-3 h-3 text-gray-600 group-hover:text-gray-400 flex-shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          }
        >
          <input
            type="text"
            autofocus
            value={title()}
            onInput={(e) => { setTitle(e.currentTarget.value); setTitleTouched(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); setEditingTitle(false); }
              else if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); }
            }}
            onBlur={() => setEditingTitle(false)}
            placeholder="e.g. webapp deploy"
            class="w-full bg-[#020617] border border-emerald-500/40 rounded px-2 py-1 text-[13px] font-mono text-gray-100 placeholder-gray-600 focus:outline-none"
          />
        </Show>
      }
      zIndex={60}
      buttons={[
        { id: 'cancel', label: 'Cancel' },
        { id: 'create', label: 'Create agent', primary: true },
      ]}
    >
      <div class="space-y-4">
        {/* Agent type — single row of straight-edged rectangles. */}
        <div>
          <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Type</label>
          <div class="flex gap-1 overflow-x-auto pb-1 -mx-0.5 px-0.5">
            <For each={AGENT_TYPE_ORDER}>
              {(t) => <AgentTypePill type={t} picked={picked()} onPick={pickType} />}
            </For>
          </div>
        </div>

        {/* Model — single combo. */}
        <div>
          <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">Model</label>
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
          <p class="mt-1.5 text-[11px] text-gray-500 leading-snug">
            {MODEL_CATALOG.find((m) => m.id === model())?.hint ?? ''}
          </p>
        </div>

        {/* Effort — segmented cells (NOT a combo). The reasoning-depth /
            "thinking" dial (claude-code --effort). */}
        <div>
          <label class="block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5">
            Effort <span class="text-gray-600 normal-case tracking-normal">· reasoning depth</span>
          </label>
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
                    'bg-[rgba(11,18,32,0.5)] border-gray-700/40 text-gray-300 hover:bg-[rgba(11,18,32,0.85)] hover:text-gray-100': effort() !== e.id,
                  }}
                >
                  {e.label}
                </button>
              )}
            </For>
          </div>
          <p class="mt-1.5 text-[11px] text-gray-500 leading-snug">
            {EFFORT_CATALOG.find((e) => e.id === effort())?.hint ?? ''}
          </p>
        </div>
      </div>
    </Modal>
  );
}
