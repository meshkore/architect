/**
 * ClientModelEffortPicker — the dial that decides WHICH engine runs a
 * team member: CLI client → provider → model → reasoning effort.
 *
 * AX17 (cockpit-excellence). The same four controls existed twice, ~80%
 * identical, in MemberDetailPanel and NewMemberDialog, and they have to
 * stay identical: the daemon's ClientDrivers (DM-CLI-08) and the
 * multi-provider work (MPV1) both key off these exact four fields, and
 * a member saved with one panel's idea of a valid combination is
 * dispatched by the other's.
 *
 * Two invariants live in `onClientChange` / `onProviderChange` and are
 * the reason this is one component rather than two copies:
 *   - switching CLIENT resets model+effort to that client's own first
 *     option, so a leftover claude-code model id is never submitted for
 *     a Gemini/Codex member;
 *   - switching PROVIDER resets the model, so an Anthropic id is never
 *     submitted for a ZAI member (or vice versa).
 *
 * Provider is claude-code-only — the other CLIs bring their own auth.
 */

import { For, Show, createMemo } from 'solid-js';
import { clientsStore } from '~/state/clients';
import { EFFORT_CATALOG, DEFAULT_PROVIDER, providerCatalog } from '~/lib/models';

const SELECT_CLASS =
  'w-full bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[13px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55';
const LABEL_CLASS = 'block font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500 mb-1.5';

export interface EngineChoice {
  client: string;
  provider: string;
  model: string;
  effort: string;
}

/** Normalise a choice for submission: only claude-code carries a provider. */
export function engineBody(c: EngineChoice): EngineChoice {
  return {
    client: c.client,
    provider: c.client === 'claude-code' ? c.provider : DEFAULT_PROVIDER,
    model: c.model,
    effort: c.effort,
  };
}

export function ClientModelEffortPicker(props: {
  value: EngineChoice;
  onChange: (next: EngineChoice) => void;
  /** Render field labels above each control (the create dialog does;
   *  the detail panel's section header already names them). */
  labels?: boolean;
}) {
  const isClaude = (): boolean => props.value.client === 'claude-code';
  const catalog = createMemo(() => clientsStore.catalogFor(props.value.client));
  const providerOptions = createMemo(() => clientsStore.providersFor('claude-code'));
  const providerModels = createMemo(() => providerCatalog(props.value.provider));
  const modelGroups = createMemo(() => [...new Set(providerModels().map((m) => m.group))]);
  const efforts = createMemo(() => (isClaude() ? EFFORT_CATALOG : catalog().efforts));

  const onClientChange = (id: string): void => {
    const cat = clientsStore.catalogFor(id);
    props.onChange({
      ...props.value,
      client: id,
      model: cat.models[0]?.id ?? '',
      effort: cat.efforts[0]?.id ?? 'default',
    });
  };
  const onProviderChange = (id: string): void => {
    props.onChange({
      ...props.value,
      provider: id,
      model: providerCatalog(id)[0]?.id ?? '',
    });
  };

  return (
    <>
      <div>
        <Show when={props.labels}>
          <label class={LABEL_CLASS}>Client</label>
        </Show>
        <select
          value={props.value.client}
          onChange={(e) => onClientChange(e.currentTarget.value)}
          class={SELECT_CLASS}
          aria-label="Client"
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

      {/* Provider (MPV1) — claude-code only. Unavailable providers (no key
          set in Config) are shown but not selectable. */}
      <Show when={isClaude()}>
        <div>
          <label class={props.labels ? LABEL_CLASS : 'block font-mono text-[9px] uppercase tracking-[0.14em] text-gray-600'}>
            Provider
          </label>
          <select
            value={props.value.provider}
            onChange={(e) => onProviderChange(e.currentTarget.value)}
            class={SELECT_CLASS}
            aria-label="Provider"
          >
            <For each={providerOptions()}>
              {(pr) => (
                <option value={pr.id} disabled={!pr.available && pr.id !== props.value.provider}>
                  {pr.label}
                  {pr.requiresKey && !pr.available ? ' (needs API key — set in Config)' : ''}
                </option>
              )}
            </For>
          </select>
        </div>
      </Show>

      <div>
        <Show when={props.labels}>
          <label class={LABEL_CLASS}>
            Model <span class="text-gray-600 normal-case tracking-normal">· required</span>
          </label>
        </Show>
        <Show
          when={isClaude()}
          fallback={
            <select
              value={props.value.model}
              onChange={(e) => props.onChange({ ...props.value, model: e.currentTarget.value })}
              class={SELECT_CLASS}
              aria-label="Model"
            >
              <For each={catalog().models}>{(m) => <option value={m.id}>{m.label}</option>}</For>
            </select>
          }
        >
          <select
            value={props.value.model}
            onChange={(e) => props.onChange({ ...props.value, model: e.currentTarget.value })}
            class={SELECT_CLASS}
            aria-label="Model"
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

      <div>
        <Show when={props.labels}>
          <label class={LABEL_CLASS}>
            Effort <span class="text-gray-600 normal-case tracking-normal">· reasoning depth</span>
          </label>
        </Show>
        <div class="flex flex-wrap gap-1">
          <For each={efforts()}>
            {(e) => (
              <button
                type="button"
                onClick={() => props.onChange({ ...props.value, effort: e.id })}
                aria-pressed={props.value.effort === e.id}
                class="px-2.5 py-1.5 text-[12px] font-mono border transition flex-shrink-0"
                classList={{
                  'bg-emerald-500/12 border-emerald-500/60 text-white': props.value.effort === e.id,
                  'bg-[rgba(11,18,32,0.5)] border-gray-700/40 text-gray-300 hover:text-gray-100': props.value.effort !== e.id,
                }}
              >{e.label}</button>
            )}
          </For>
        </div>
      </div>
    </>
  );
}

export default ClientModelEffortPicker;
