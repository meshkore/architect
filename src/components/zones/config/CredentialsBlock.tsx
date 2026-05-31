/**
 * CredentialsBlock — V107.16. Per-project credential CRUD.
 *
 * The cockpit reads + writes single-file secrets stored under
 * `.meshkore/credentials/` in the ACTIVE project. Wire is the
 * daemon's `cluster.credentials.crud.v1` endpoints (py-1.11.3+):
 *   GET  /credentials              → list of names + sizes
 *   GET  /credentials/<name>       → value (auth-required, opt-in reveal)
 *   PUT  /credentials/<name>       → upsert
 *   DELETE /credentials/<name>     → remove
 *
 * Values are NEVER fetched until the operator clicks "reveal" on a
 * specific row. Listing is automatic on mount + cluster swap.
 *
 * `portal-token` is daemon-managed and rendered with edit/delete
 * disabled; the daemon also refuses overwrites server-side (403).
 *
 * Cluster isolation: `createEffect` keyed on `daemonStore.state.client`
 * resets local state + refetches on project swap. Same pattern as the
 * other zones audited under V107.2.
 */

import { For, Show, createEffect, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import type { CredentialListEntry } from '~/lib/daemon-client';
import { mcAlert, mcConfirm } from '~/lib/modal';
import { log } from '~/lib/log';
import { Block, Btn, BtnRow } from './atoms';

interface RevealedState {
  loading: boolean;
  value: string | null;
  error: string | null;
}

export function CredentialsBlock() {
  const [list, setList] = createSignal<CredentialListEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [revealed, setRevealed] = createSignal<Record<string, RevealedState>>({});
  const [editing, setEditing] = createSignal<string | null>(null);
  const [editDraft, setEditDraft] = createSignal('');
  // Add-credential form state.
  const [adding, setAdding] = createSignal(false);
  const [newName, setNewName] = createSignal('');
  const [newValue, setNewValue] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);

  const refresh = async (): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c) {
      setList([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await c.credentials();
      if (!res.ok) {
        setError(`/credentials → ${res.status}`);
        setList([]);
        return;
      }
      setList(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      log.warn('[credentials] refresh threw', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // V107.16 — Reactive cluster binding. Reset all local state +
  // refetch every time the active client changes. Prevents one
  // project's credential names leaking into another's view.
  createEffect(() => {
    const c = daemonStore.state.client;
    setRevealed({});
    setEditing(null);
    setEditDraft('');
    setAdding(false);
    setNewName('');
    setNewValue('');
    setError(null);
    if (!c) {
      setList([]);
      return;
    }
    void refresh();
  });

  const onReveal = async (name: string): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c) return;
    setRevealed((r) => ({ ...r, [name]: { loading: true, value: null, error: null } }));
    const res = await c.credentialRead(name);
    if (!res.ok) {
      setRevealed((r) => ({
        ...r,
        [name]: { loading: false, value: null, error: res.error ?? `HTTP ${res.status}` },
      }));
      return;
    }
    setRevealed((r) => ({ ...r, [name]: { loading: false, value: res.data.value, error: null } }));
  };

  const onHide = (name: string): void => {
    setRevealed((r) => {
      const next = { ...r };
      delete next[name];
      return next;
    });
  };

  const onBeginEdit = async (name: string): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c) return;
    setEditing(name);
    setEditDraft('');
    // Pre-fill with current value so the operator can edit incrementally.
    const res = await c.credentialRead(name);
    if (res.ok) setEditDraft(res.data.value);
  };

  const onCancelEdit = (): void => {
    setEditing(null);
    setEditDraft('');
  };

  const onSaveEdit = async (name: string): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c) return;
    setSubmitting(true);
    try {
      const res = await c.credentialWrite(name, editDraft());
      if (!res.ok) {
        void mcAlert(`Save failed: ${res.status} ${res.body.slice(0, 200)}`, { title: 'Credentials' });
        return;
      }
      setEditing(null);
      setEditDraft('');
      // Refresh listing to reflect updated size.
      void refresh();
      // Drop any cached revealed value — operator can re-reveal if needed.
      setRevealed((r) => {
        const next = { ...r };
        delete next[name];
        return next;
      });
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (name: string): Promise<void> => {
    const ok = await mcConfirm(
      `Delete the credential "${name}"? Agents that read it will lose access until you set it again.`,
      { title: 'Delete credential', okLabel: 'Delete', danger: true },
    );
    if (!ok) return;
    const c = daemonStore.state.client;
    if (!c) return;
    const res = await c.credentialDelete(name);
    if (!res.ok) {
      void mcAlert(`Delete failed: ${res.status} ${res.body.slice(0, 200)}`, { title: 'Credentials' });
      return;
    }
    void refresh();
    setRevealed((r) => {
      const next = { ...r };
      delete next[name];
      return next;
    });
  };

  const onAdd = async (): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c) return;
    const name = newName().trim();
    if (!name) {
      void mcAlert('Name is required.', { title: 'Add credential' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await c.credentialWrite(name, newValue());
      if (!res.ok) {
        void mcAlert(`Add failed: ${res.status} ${res.body.slice(0, 200)}`, { title: 'Credentials' });
        return;
      }
      setAdding(false);
      setNewName('');
      setNewValue('');
      void refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Block
      title="Credentials"
      subtitle="Per-project secrets at .meshkore/credentials/. Agents read these files directly. Values stay on disk; the cockpit only fetches them when you click Reveal."
    >
      <Show when={error()}>
        <p class="text-[11px] text-red-400 font-mono mb-2">{error()}</p>
      </Show>
      <Show when={loading() && list().length === 0}>
        <p class="text-[12px] text-gray-600">Loading…</p>
      </Show>
      <Show when={!loading() && list().length === 0 && !error()}>
        <p class="text-[12px] text-gray-600 italic">No credentials yet. Add one below.</p>
      </Show>
      <Show when={list().length > 0}>
        <ul class="space-y-2">
          <For each={list()}>
            {(entry) => (
              <li class="bg-gray-950/40 border border-gray-800/50 rounded-md px-3 py-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-mono text-[12px] text-emerald-300 flex-shrink-0">{entry.name}</span>
                  <Show when={entry.protected}>
                    <span class="font-mono text-[9px] uppercase tracking-wider text-amber-300/80 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                      protected
                    </span>
                  </Show>
                  <span class="text-[10px] text-gray-600 font-mono">
                    {entry.size !== null ? `${entry.size} B` : '—'}
                  </span>
                  <div class="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    <Show
                      when={revealed()[entry.name]?.value}
                      fallback={
                        <Btn
                          onClick={() => { void onReveal(entry.name); }}
                          disabled={revealed()[entry.name]?.loading}
                        >
                          {revealed()[entry.name]?.loading ? '…' : 'Reveal'}
                        </Btn>
                      }
                    >
                      <Btn onClick={() => onHide(entry.name)}>Hide</Btn>
                    </Show>
                    <Show when={!entry.protected}>
                      <Btn onClick={() => { void onBeginEdit(entry.name); }} disabled={editing() !== null}>Edit</Btn>
                      <Btn onClick={() => { void onDelete(entry.name); }} danger>Delete</Btn>
                    </Show>
                  </div>
                </div>
                <Show when={revealed()[entry.name]?.error}>
                  <p class="text-[11px] text-red-400 font-mono mt-1.5">{revealed()[entry.name]?.error}</p>
                </Show>
                <Show when={revealed()[entry.name]?.value}>
                  <pre class="mt-2 text-[11px] font-mono text-gray-200 bg-gray-950 border border-gray-800/60 rounded px-2 py-1.5 whitespace-pre-wrap break-all">{revealed()[entry.name]?.value}</pre>
                </Show>
                <Show when={editing() === entry.name}>
                  <div class="mt-2 space-y-1.5">
                    <textarea
                      value={editDraft()}
                      onInput={(e) => setEditDraft(e.currentTarget.value)}
                      rows={3}
                      disabled={submitting()}
                      class="w-full bg-gray-950 border border-emerald-500/40 rounded px-2 py-1.5 text-[12px] font-mono text-gray-100 focus:outline-none focus:border-emerald-500/70"
                    />
                    <div class="flex gap-2">
                      <Btn onClick={() => { void onSaveEdit(entry.name); }} disabled={submitting()}>
                        {submitting() ? 'Saving…' : 'Save'}
                      </Btn>
                      <Btn onClick={onCancelEdit} disabled={submitting()}>Cancel</Btn>
                    </div>
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <BtnRow>
        <Show when={!adding()} fallback={null}>
          <Btn onClick={() => setAdding(true)}>+ Add credential</Btn>
        </Show>
        <Btn onClick={() => { void refresh(); }} disabled={loading()}>Refresh</Btn>
      </BtnRow>

      <Show when={adding()}>
        <div class="mt-3 space-y-2 bg-gray-950/40 border border-emerald-500/30 rounded-md px-3 py-2.5">
          <p class="text-[10px] font-mono uppercase tracking-wider text-emerald-300">New credential</p>
          <input
            type="text"
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            placeholder="cloudflare-token  ·  openrouter.env  ·  fly-org-id"
            disabled={submitting()}
            class="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-[12px] font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500/70"
          />
          <textarea
            value={newValue()}
            onInput={(e) => setNewValue(e.currentTarget.value)}
            rows={3}
            placeholder="Paste the secret value here. Agents will read it from .meshkore/credentials/<name> directly."
            disabled={submitting()}
            class="w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-[12px] font-mono text-gray-100 placeholder-gray-600 focus:outline-none focus:border-emerald-500/70"
          />
          <div class="flex gap-2">
            <Btn onClick={() => { void onAdd(); }} disabled={submitting() || !newName().trim()}>
              {submitting() ? 'Saving…' : 'Save'}
            </Btn>
            <Btn
              onClick={() => { setAdding(false); setNewName(''); setNewValue(''); }}
              disabled={submitting()}
            >
              Cancel
            </Btn>
          </div>
        </div>
      </Show>
    </Block>
  );
}
