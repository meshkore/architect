/**
 * ClientsBlock — MPV1 (multi-provider-agents) + same-day follow-ups. Machine-
 * level "Providers" list: every AI credential the daemon manages, in ONE
 * place — Anthropic (native, no key), ZAI/GLM, and Codex/Gemini (each their
 * own API key). Toggling a provider on + pasting its key (when it needs
 * one) makes it selectable in a project's team member editor.
 *
 * 2026-07-09 simplification — operator feedback: an API key is the only
 * thing an operator should ever have to provide here. The endpoint/small-
 * model details ZAI needs (base URL, background model) are implementation
 * defaults the daemon already knows (`providers.py` ZAI_DEFAULT_BASE_URL /
 * ZAI_DEFAULT_SMALL_MODEL) — NOT exposed in this UI anymore. The daemon
 * still accepts overriding them via a direct `POST /config/providers` call
 * for an advanced/future use case; this cockpit just never asks for them.
 *
 * This is DAEMON state (one config per machine, NOT per project), so it
 * lives in the General settings drawer, not the per-project Config tab.
 * Contract (py-1.32.1, portal-authed):
 *   GET  /config/providers → { providers[] }  (keyPresent only, never the key)
 *   POST /config/providers → apply partial patch, returns fresh config
 *
 * Security: API keys are WRITE-ONLY here — the daemon stores them chmod-600
 * and never returns their value; we only ever show a `keyPresent` badge.
 * A daemon older than MPV1 404s → the block renders a short "unavailable"
 * note instead of an error.
 */

import { For, Show, createEffect, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import type { ProviderConfigInfo, ProvidersConfigPatch, ProvidersConfigResponse } from '~/lib/daemon-client';
import { withAuthRetry } from '~/lib/retry';
import { Block, Toggle } from './atoms';

// Shown (read-only) in the API-key input when a key is already stored —
// the daemon never returns the real value, so this is a generic mask, not
// the actual key's length. Matches the masked-token look already used for
// the Remote-control bearer token. Click "Clear" to make the field
// editable again and paste a new one.
const MASKED_KEY = '••••••••••••••••••••••••';

type CfgState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: ProvidersConfigResponse };

export function ClientsBlock() {
  const client = () => daemonStore.state.client;

  // 2026-07-09 fix — this block now mounts at APP BOOT (GeneralConfigDrawer
  // is always in the DOM so its close animation can play), well before the
  // daemon client attaches. A one-shot `createResource(fn)` with no
  // reactive `source` param captured that early `null` client FOREVER and
  // never refetched once the daemon connected — it was permanently stuck
  // showing "upgrade your daemon" even on an already-upgraded, fully
  // connected daemon. Fixed the same way `CredentialsBlock` (V107.16)
  // already solved this: a plain signal refreshed from a `createEffect`
  // keyed on `daemonStore.state.client`, so it reruns the moment the
  // client attaches (or changes on a project switch) — not just once at
  // mount. `loading` is a distinct state (not `unavailable`) so the brief
  // pre-connect window never flashes the "upgrade your daemon" message.
  const [cfg, setCfg] = createSignal<CfgState>({ status: 'loading' });

  const refetch = async (): Promise<void> => {
    const c = client();
    if (!c) {
      setCfg({ status: 'loading' });
      return;
    }
    // `withAuthRetry` absorbs a 401 that happens right after the daemon
    // (re)connects (observed: fails on first load, succeeds a few seconds
    // later on a manual retry) — the operator should never have to click a
    // button for a request that "can't fail"; give it the same few seconds
    // automatically before ever showing an error.
    const r = await withAuthRetry(() => c.providerConfigGet());
    if (r.ok) {
      setCfg({ status: 'ok', data: r.data });
      return;
    }
    // 404 → daemon too old for this feature; anything else is a real error.
    if (r.status === 404) {
      setCfg({ status: 'unavailable' });
      return;
    }
    setCfg({ status: 'error', message: `HTTP ${r.status}` });
  };

  createEffect(() => {
    client(); // establishes the dependency — reruns on attach/project-switch
    void refetch();
  });

  const okData = (): ProvidersConfigResponse | null => {
    const c = cfg();
    return c.status === 'ok' ? c.data : null;
  };
  const errorMessage = (): string => {
    const c = cfg();
    return c.status === 'error' ? c.message : '';
  };

  const [busy, setBusy] = createSignal<string | null>(null);
  const [err, setErr] = createSignal<string | null>(null);
  // Local edit buffer: just the (write-only) key being typed, keyed by id.
  // 2026-07-09 simplification — operator feedback: base-url/small-model are
  // implementation defaults ("tú ya sabrás cómo conectarte"), not something
  // an operator should ever need to set. The daemon still applies its own
  // sensible defaults (providers.py ZAI_DEFAULT_BASE_URL/SMALL_MODEL); this
  // UI only ever asks for the one thing that's actually the operator's:
  // the API key.
  const [draft, setDraft] = createSignal<Record<string, string>>({});

  const patchKeyDraft = (id: string, key: string) =>
    setDraft((d) => ({ ...d, [id]: key }));

  const apply = async (label: string, body: ProvidersConfigPatch): Promise<void> => {
    const c = client();
    if (!c) return;
    setBusy(label);
    setErr(null);
    const r = await c.providerConfigSet(body);
    setBusy(null);
    if (!r.ok) { setErr(`Save failed (HTTP ${r.status}).`); return; }
    setDraft({}); // clear typed keys — they've been sent
    await refetch();
  };

  const saveProvider = (p: ProviderConfigInfo) => {
    const key = (draft()[p.id] ?? '').trim();
    if (!key) return;
    void apply(`save:${p.id}`, { providers: { [p.id]: { key } } });
  };

  const toggleProvider = (id: string, enabled: boolean) =>
    void apply(`toggle:${id}`, { providers: { [id]: { enabled } } });

  const clearKey = (id: string) =>
    void apply(`clear:${id}`, { providers: { [id]: { clear_key: true } } });

  return (
    <Block
      title="Providers"
      subtitle="Machine-level — one config per Mac, shared by every project. Not per-project."
    >
      <div class="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[12px] text-sky-100/90 leading-snug mb-3">
        <span class="font-mono text-[9px] uppercase tracking-wider text-sky-300 bg-sky-500/15 border border-sky-500/30 rounded px-1.5 py-0.5 mr-1.5 align-middle">machine-level</span>
        One key per provider, set ONCE here — shared by every project on this
        Mac, never copied project-to-project. Enable a provider and (if it
        needs one) paste its key — any project's team members can then
        select it. <b>Anthropic</b> needs no key (Claude Code's own Mac login
        handles it); <b>Codex</b>/<b>Gemini</b> also keep working via their
        own native login even without a key here — the key is just a
        convenience for headless agents.
      </div>

      <Show when={err()}>
        <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200 mb-3">{err()}</div>
      </Show>

      <Show
        when={okData()}
        fallback={
          <div class="flex items-center justify-between gap-3 text-[12px] text-gray-500 leading-relaxed">
            <p>
              {cfg().status === 'loading'
                ? 'Connecting to the daemon…'
                : cfg().status === 'error'
                  ? errorMessage()
                  : "This daemon doesn't expose provider config yet — upgrade it (py-1.32.1+) to manage providers here."}
            </p>
            <Show when={cfg().status === 'error'}>
              <button
                type="button"
                onClick={() => void refetch()}
                class="flex-shrink-0 text-[11px] font-mono uppercase tracking-wider text-red-200 hover:text-white border border-red-500/40 hover:border-red-400/70 rounded px-2 py-1"
              >Retry</button>
            </Show>
          </div>
        }
      >
        <div class="space-y-4">
          <For each={okData()!.providers}>
            {(p) => (
              <div class="rounded-lg border border-gray-800/60 p-4 space-y-3">
                {/* Title row — clearly delimited from the fields below. */}
                <div class="flex items-center justify-between gap-2 pb-2.5 border-b border-gray-800/60">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-[13px] text-gray-100">{p.label}</span>
                    <Show when={p.available}>
                      <span class="font-mono text-[9px] uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">available</span>
                    </Show>
                    <Show when={!p.available}>
                      <span class="font-mono text-[9px] uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">unavailable</span>
                    </Show>
                  </div>
                  <Toggle
                    checked={p.enabled}
                    onChange={(v) => toggleProvider(p.id, v)}
                    disabled={busy() !== null}
                    label={`Enable ${p.label}`}
                  />
                </div>

                <Show
                  when={p.requiresKey}
                  fallback={
                    <p class="text-[11px] text-gray-500 leading-snug">
                      Native login/config — no API key needed here.
                    </p>
                  }
                >
                  {/* API key (write-only) — input + Save on the same line. */}
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between">
                      <span class="font-mono text-[10px] uppercase tracking-wider text-gray-500">API key</span>
                      <span class="text-[10px]" classList={{ 'text-emerald-400': p.keyPresent, 'text-amber-400': !p.keyPresent }}>
                        {p.keyPresent ? 'key set ✓' : 'no key'}
                      </span>
                    </div>
                    <div class="flex gap-1.5">
                      <input
                        type="password"
                        value={draft()[p.id] ?? (p.keyPresent ? MASKED_KEY : '')}
                        readOnly={p.keyPresent && draft()[p.id] === undefined}
                        onInput={(e) => patchKeyDraft(p.id, e.currentTarget.value)}
                        placeholder={`paste the ${p.label} API key`}
                        title={p.keyPresent ? 'A key is already set — click Clear to replace it' : undefined}
                        class="flex-1 min-w-0 bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[12px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/55"
                      />
                      <button
                        type="button"
                        onClick={() => saveProvider(p)}
                        disabled={busy() !== null || !(draft()[p.id] ?? '').trim()}
                        class="flex-shrink-0 text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-3 py-1.5 disabled:opacity-50"
                      >{busy() === `save:${p.id}` ? 'Saving…' : 'Save'}</button>
                      <Show when={p.keyPresent}>
                        <button
                          type="button"
                          onClick={() => clearKey(p.id)}
                          disabled={busy() !== null}
                          class="flex-shrink-0 text-[11px] font-mono text-red-300 border border-red-500/30 hover:bg-red-500/10 rounded px-2 py-1.5 disabled:opacity-50"
                          title="Delete the stored key"
                        >Clear</button>
                      </Show>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Block>
  );
}
