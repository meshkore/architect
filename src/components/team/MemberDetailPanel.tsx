/**
 * MemberDetailPanel — ATM6. Right-hand editor sliding over the roster.
 *
 * Per-section save: each section PATCHes only its own fields. `kind` and
 * `required` are shown but never editable (the daemon rejects them).
 * Optimistic store update with rollback + inline error on 4xx (handled
 * inside teamStore.update). A concurrent-edit warning fires when the
 * on-disk `updated:` timestamp moves while the panel is open.
 *
 * TEG-3 — "External access" section: exposure toggle (PATCH), token
 * reveal/copy/regenerate/revoke, and a ready-to-paste connection
 * snippet for the consuming project. The token is read from the
 * in-memory teamStore detail cache only (never localStorage).
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

  // ── TEG-3 · External access ─────────────────────────────────────────
  const exposure = () => member()?.exposure ?? 'internal';
  const isExternal = () => exposure() === 'external';
  // Token comes from the store's in-memory detail cache (authed
  // GET /team/<id>); reading the store directly keeps it reactive to
  // rotate / revoke without re-running the resource.
  const token = () => teamStore.state.details[props.memberId]?.token ?? null;
  const [extOpen, setExtOpen] = createSignal(false);
  const [tokenRevealed, setTokenRevealed] = createSignal(false);
  const [copied, setCopied] = createSignal<'token' | 'snippet' | null>(null);
  // Open the section by default for already-external members (the
  // member may not be loaded yet on mount, so seed reactively once).
  createEffect(() => { if (isExternal()) setExtOpen(true); });

  const copy = async (what: 'token' | 'snippet', text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
    } catch {
      setError('Copy failed — your browser blocked clipboard access.');
    }
  };

  /** External callers hit the shared daemon on loopback; derive the
   *  port from this client's transport instead of hardcoding it. */
  const askBase = (): string => {
    let port = 5573;
    try {
      const raw = new URL(client()?.transport.httpBase ?? '').port;
      if (raw) port = Number(raw);
    } catch { /* keep default */ }
    return `https://127.0.0.1:${port}`;
  };
  const clusterId = (): string =>
    client()?.transport.projectId ?? daemonStore.state.activeId ?? '<cluster-id>';

  const connectionSnippet = (tok: string): string => {
    const base = askBase();
    const id = props.memberId;
    return [
      `# 1. Ask ${id} — returns {"request_id": "..."}`,
      `curl -sk -X POST ${base}/team/${id}/ask \\`,
      `  -H "Authorization: Bearer ${tok}" \\`,
      `  -H "X-MeshKore-Project: ${clusterId()}" \\`,
      `  -H "content-type: application/json" \\`,
      `  -d '{"text": "Your question here"}'`,
      ``,
      `# 2. Poll until status is "done" — the answer is in result_text`,
      `curl -sk ${base}/team/requests/<request_id> \\`,
      `  -H "Authorization: Bearer ${tok}" \\`,
      `  -H "X-MeshKore-Project: ${clusterId()}"`,
    ].join('\n');
  };

  const setExposureExternal = async (): Promise<void> => {
    if (isExternal()) return;
    await saveSection('exposure', { exposure: 'external' });
    // The PATCH response is frontmatter-only; force-refetch the detail
    // so the freshly minted token lands in the cache.
    const c = client();
    if (c) await teamStore.detail(c, props.memberId, /*force*/ true);
  };

  const revokeAccess = async (): Promise<void> => {
    if (!isExternal()) return;
    if (!confirm('The member becomes private and its token is destroyed — external callers are cut off immediately. Revoke access?')) return;
    setTokenRevealed(false);
    await saveSection('exposure', { exposure: 'internal' });
  };

  const regenerateToken = async (): Promise<void> => {
    const c = client();
    if (!c) return;
    if (!confirm('The old token stops working immediately. Regenerate?')) return;
    setSavingSection('token');
    setError(null);
    const res = await teamStore.rotateToken(c, props.memberId);
    setSavingSection(null);
    if (!res.ok) setError(`Token regeneration failed (HTTP ${res.status}).`);
  };

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

          {/* Section 4 — External access (TEG-3) */}
          <section class="space-y-3 pt-2 border-t border-gray-800/60">
            <button
              type="button"
              onClick={() => setExtOpen((o) => !o)}
              class="w-full flex items-center justify-between gap-2 text-left"
              aria-expanded={extOpen()}
            >
              <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">
                <span class="inline-block w-3 text-gray-600" aria-hidden="true">{extOpen() ? '▾' : '▸'}</span>
                External access
              </h3>
              <Show when={isExternal()}>
                <span class="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-sky-200 bg-sky-500/10 border border-sky-500/30 rounded px-1.5 py-0.5">
                  ↗ external
                </span>
              </Show>
            </button>

            <Show when={extOpen()}>
              <div class="space-y-3">
                <p class="text-[11px] text-gray-500 leading-snug">
                  External members can be queried by other software on this
                  machine (another project, a bare CLI session) via a
                  per-member token. Internal members are reachable from this
                  cockpit only.
                </p>

                {/* Segmented Internal / External */}
                <div class="flex gap-1" role="group" aria-label="Exposure">
                  <button
                    type="button"
                    onClick={() => void revokeAccess()}
                    disabled={savingSection() === 'exposure'}
                    aria-pressed={!isExternal()}
                    class="px-2.5 py-1.5 text-[12px] font-mono border transition flex-shrink-0 disabled:opacity-50"
                    classList={{
                      'bg-emerald-500/12 border-emerald-500/60 text-white': !isExternal(),
                      'bg-[rgba(11,18,32,0.5)] border-gray-700/40 text-gray-300 hover:text-gray-100': isExternal(),
                    }}
                  >Internal</button>
                  <button
                    type="button"
                    onClick={() => void setExposureExternal()}
                    disabled={savingSection() === 'exposure'}
                    aria-pressed={isExternal()}
                    class="px-2.5 py-1.5 text-[12px] font-mono border transition flex-shrink-0 disabled:opacity-50"
                    classList={{
                      'bg-sky-500/12 border-sky-500/60 text-white': isExternal(),
                      'bg-[rgba(11,18,32,0.5)] border-gray-700/40 text-gray-300 hover:text-gray-100': !isExternal(),
                    }}
                  >External</button>
                  <Show when={savingSection() === 'exposure'}>
                    <span class="self-center text-[11px] font-mono text-gray-500">Saving…</span>
                  </Show>
                </div>

                <Show when={isExternal()}>
                  {/* Token */}
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between">
                      <span class="font-mono text-[10px] uppercase tracking-wider text-gray-500">Bearer token</span>
                      <span class="text-[10px] text-gray-600">Never expires — rotate or revoke below.</span>
                    </div>
                    <Show
                      when={token()}
                      fallback={
                        <p class="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded px-2.5 py-1.5">
                          Token unavailable — the daemon didn't return it (needs py-1.30.0+). Try reopening this panel.
                        </p>
                      }
                    >
                      <div class="flex gap-1.5 items-center">
                        <code class="flex-1 min-w-0 truncate bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[12px] font-mono text-gray-100 select-all">
                          {tokenRevealed() ? token() : '••••••••••••••••••••••••'}
                        </code>
                        <button
                          type="button"
                          onClick={() => setTokenRevealed((v) => !v)}
                          class="flex-shrink-0 text-[11px] font-mono text-gray-400 hover:text-gray-100 border border-gray-700/50 hover:border-gray-500/60 rounded px-2 py-1.5"
                          title={tokenRevealed() ? 'Hide token' : 'Reveal token'}
                        >{tokenRevealed() ? 'Hide' : 'Reveal'}</button>
                        <button
                          type="button"
                          onClick={() => void copy('token', token() ?? '')}
                          class="flex-shrink-0 text-[11px] font-mono text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1.5"
                          title="Copy token to clipboard"
                        >{copied() === 'token' ? 'Copied ✓' : 'Copy'}</button>
                      </div>
                    </Show>
                    <div class="flex gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => void regenerateToken()}
                        disabled={savingSection() === 'token'}
                        class="text-[11px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 rounded px-2.5 py-1.5 disabled:opacity-50"
                        title="Mint a new token — the old one stops working immediately"
                      >{savingSection() === 'token' ? 'Regenerating…' : 'Regenerate'}</button>
                      <button
                        type="button"
                        onClick={() => void revokeAccess()}
                        disabled={savingSection() === 'exposure'}
                        class="text-[11px] font-mono text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 rounded px-2.5 py-1.5 disabled:opacity-50"
                        title="Make the member private and destroy its token"
                      >Revoke access</button>
                    </div>
                  </div>

                  {/* Connection snippet */}
                  <Show when={token()}>
                    <div class="space-y-1.5">
                      <div class="flex items-center justify-between">
                        <span class="font-mono text-[10px] uppercase tracking-wider text-gray-500">Connection snippet</span>
                        <button
                          type="button"
                          onClick={() => void copy('snippet', connectionSnippet(token()!))}
                          class="text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1"
                          title="Copy the ready-to-paste snippet (includes the real token)"
                        >{copied() === 'snippet' ? 'Copied ✓' : 'Copy'}</button>
                      </div>
                      <pre class="bg-[#020617] border border-gray-700/40 rounded px-2.5 py-2 text-[11px] font-mono leading-relaxed text-gray-200 overflow-x-auto whitespace-pre">
                        {connectionSnippet(tokenRevealed() ? token()! : '<token — use Copy>')}
                      </pre>
                      <p class="text-[10px] text-gray-600 leading-snug">
                        Hand this to the consuming project. The copied version
                        always contains the real token; the endpoint is this
                        machine's shared daemon (loopback only).
                      </p>
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>
          </section>

          {/* Section 5 — Danger zone (hidden when required) */}
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
