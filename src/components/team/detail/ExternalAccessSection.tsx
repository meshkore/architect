/**
 * ExternalAccessSection — TEG-3 exposure toggle, bearer token and the
 * connection snippet (MemberDetailPanel section 4).
 *
 * The token is read from teamStore's in-memory detail cache only, never
 * localStorage, and never rendered unless the operator reveals it — the
 * masked field and the snippet's `<token — use Copy>` placeholder exist
 * so a shared screen doesn't leak a credential that never expires.
 * Copy always puts the REAL token on the clipboard.
 *
 * Revoke and Regenerate are destructive and immediate (old token dies
 * on the spot), so both are inline two-step confirms — never the native
 * blocking `confirm()`, which freezes the WS pump along with the UI.
 */

import { Show, createEffect, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { teamStore } from '~/state/team';
import { connectionSnippet } from '~/lib/team-snippet';
import { useClipboard } from '~/lib/use-clipboard';
import { ConfirmButtons } from '~/components/ui/ConfirmButtons';

const TOKEN_MASK = '••••••••••••••••••••••••';

export function ExternalAccessSection(props: {
  memberId: string;
  exposure: string;
  savingSection: string | null;
  onError: (msg: string) => void;
  /** PATCH one section; the panel owns the store call + rollback. */
  onSave: (section: string, body: Record<string, unknown>) => Promise<void>;
  onSavingSection: (section: string | null) => void;
}) {
  const client = () => daemonStore.state.client;
  const isExternal = (): boolean => props.exposure === 'external';
  // Read the store directly so rotate / revoke stay reactive without
  // re-running a resource.
  const token = (): string | null => teamStore.state.details[props.memberId]?.token ?? null;

  const [open, setOpen] = createSignal(false);
  const [revealed, setRevealed] = createSignal(false);
  const [snippetOpen, setSnippetOpen] = createSignal(false);
  const clip = useClipboard();

  // Open by default for already-external members. The member may not be
  // loaded on mount, so seed reactively rather than once.
  createEffect(() => { if (isExternal()) setOpen(true); });

  const snippet = (tok: string): string =>
    connectionSnippet({
      memberId: props.memberId,
      token: tok,
      clusterId: client()?.transport.projectId ?? daemonStore.state.activeId ?? '<cluster-id>',
      httpBase: client()?.transport.httpBase,
    });

  const copy = (what: 'token' | 'snippet', text: string): void => {
    void clip.copy(text, what).then((ok) => {
      if (!ok) props.onError('Copy failed — your browser blocked clipboard access.');
    });
  };

  const goExternal = async (): Promise<void> => {
    if (isExternal()) return;
    await props.onSave('exposure', { exposure: 'external' });
    // The PATCH response is frontmatter-only; force-refetch the detail so
    // the freshly minted token lands in the cache.
    const c = client();
    if (c) await teamStore.detail(c, props.memberId, /*force*/ true);
  };

  const revoke = async (): Promise<void> => {
    if (!isExternal()) return;
    setRevealed(false);
    await props.onSave('exposure', { exposure: 'internal' });
  };

  const regenerate = async (): Promise<void> => {
    const c = client();
    if (!c) {
      props.onError('Not connected to the daemon — reconnect (reload the page) and try again.');
      return;
    }
    props.onSavingSection('token');
    const res = await teamStore.rotateToken(c, props.memberId);
    props.onSavingSection(null);
    if (!res.ok) props.onError(`Token regeneration failed (HTTP ${res.status}).`);
  };

  return (
    <section class="space-y-3 pt-2 border-t border-gray-800/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        class="w-full flex items-center justify-between gap-2 text-left"
        aria-expanded={open()}
      >
        <h3 class="font-mono text-[10px] uppercase tracking-[0.14em] text-gray-500">
          <span class="inline-block w-3 text-gray-600" aria-hidden="true">{open() ? '▾' : '▸'}</span>
          External access
        </h3>
        <Show when={isExternal()}>
          <span class="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-sky-200 bg-sky-500/10 border border-sky-500/30 rounded px-1.5 py-0.5">
            ↗ external
          </span>
        </Show>
      </button>

      <Show when={open()}>
        <div class="space-y-3">
          <p class="text-[11px] text-gray-500 leading-snug">
            External members can be queried by other software on this
            machine (another project, a bare CLI session) via a per-member
            token. Internal members are reachable from this cockpit only.
          </p>

          {/* Segmented Internal / External */}
          <div class="flex gap-1" role="group" aria-label="Exposure">
            <ConfirmButtons
              question="Cut off external callers?"
              onConfirm={() => { void revoke(); }}
              trigger={(arm) => (
                <button
                  type="button"
                  onClick={() => (isExternal() ? arm() : undefined)}
                  disabled={props.savingSection === 'exposure'}
                  aria-pressed={!isExternal()}
                  class="px-2.5 py-1.5 text-[12px] font-mono border transition flex-shrink-0 disabled:opacity-50"
                  classList={{
                    'bg-emerald-500/12 border-emerald-500/60 text-white': !isExternal(),
                    'bg-[rgba(11,18,32,0.5)] border-gray-700/40 text-gray-300 hover:text-gray-100': isExternal(),
                  }}
                >Internal</button>
              )}
            />
            <button
              type="button"
              onClick={() => { void goExternal(); }}
              disabled={props.savingSection === 'exposure'}
              aria-pressed={isExternal()}
              class="px-2.5 py-1.5 text-[12px] font-mono border transition flex-shrink-0 disabled:opacity-50"
              classList={{
                'bg-sky-500/12 border-sky-500/60 text-white': isExternal(),
                'bg-[rgba(11,18,32,0.5)] border-gray-700/40 text-gray-300 hover:text-gray-100': !isExternal(),
              }}
            >External</button>
            <Show when={props.savingSection === 'exposure'}>
              <span class="self-center text-[11px] font-mono text-gray-500">Saving…</span>
            </Show>
          </div>

          <Show when={isExternal()}>
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
                    {revealed() ? token() : TOKEN_MASK}
                  </code>
                  <button
                    type="button"
                    onClick={() => setRevealed((v) => !v)}
                    class="flex-shrink-0 text-[11px] font-mono text-gray-400 hover:text-gray-100 border border-gray-700/50 hover:border-gray-500/60 rounded px-2 py-1.5"
                    title={revealed() ? 'Hide token' : 'Reveal token'}
                  >{revealed() ? 'Hide' : 'Reveal'}</button>
                  <button
                    type="button"
                    onClick={() => copy('token', token() ?? '')}
                    class="flex-shrink-0 text-[11px] font-mono text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1.5"
                    title="Copy token to clipboard"
                  >{clip.isCopied('token') ? 'Copied ✓' : 'Copy'}</button>
                </div>
              </Show>
              <div class="flex gap-1.5 pt-0.5">
                <ConfirmButtons
                  question="The old token stops working immediately."
                  confirmLabel="Regenerate"
                  onConfirm={() => { void regenerate(); }}
                  trigger={(arm) => (
                    <button
                      type="button"
                      onClick={arm}
                      disabled={props.savingSection === 'token'}
                      class="text-[11px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 rounded px-2.5 py-1.5 disabled:opacity-50"
                      title="Mint a new token — the old one stops working immediately"
                    >{props.savingSection === 'token' ? 'Regenerating…' : 'Regenerate'}</button>
                  )}
                />
                <ConfirmButtons
                  question="Destroy the token and cut off external callers?"
                  confirmLabel="Revoke"
                  onConfirm={() => { void revoke(); }}
                  trigger={(arm) => (
                    <button
                      type="button"
                      onClick={arm}
                      disabled={props.savingSection === 'exposure'}
                      class="text-[11px] font-mono text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 rounded px-2.5 py-1.5 disabled:opacity-50"
                      title="Make the member private and destroy its token"
                    >Revoke access</button>
                  )}
                />
              </div>
            </div>

            {/* Connection snippet — collapsed by default. */}
            <Show when={token()}>
              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="font-mono text-[10px] uppercase tracking-wider text-gray-500">Connection snippet</span>
                  <div class="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSnippetOpen((v) => !v)}
                      class="text-[11px] font-mono uppercase tracking-wider text-gray-400 hover:text-gray-100 border border-gray-700/50 hover:border-gray-500/60 rounded px-2 py-1"
                      aria-expanded={snippetOpen()}
                    >{snippetOpen() ? 'Hide' : 'Show'}</button>
                    <button
                      type="button"
                      onClick={() => copy('snippet', snippet(token() ?? ''))}
                      class="text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1"
                      title="Copy the ready-to-paste snippet (includes the real token)"
                    >{clip.isCopied('snippet') ? 'Copied ✓' : 'Copy'}</button>
                  </div>
                </div>
                <Show when={snippetOpen()}>
                  <pre class="bg-[#020617] border border-gray-700/40 rounded px-2.5 py-2 text-[11px] font-mono leading-relaxed text-gray-200 overflow-x-auto whitespace-pre">
                    {snippet(revealed() ? (token() ?? '') : '<token — use Copy>')}
                  </pre>
                  <p class="text-[10px] text-gray-600 leading-snug">
                    Hand this to the consuming project. The copied version
                    always contains the real token; the endpoint is this
                    machine's shared daemon (loopback only).
                  </p>
                </Show>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </section>
  );
}

export default ExternalAccessSection;
