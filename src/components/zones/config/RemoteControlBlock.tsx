/**
 * RemoteControlBlock — CPL-4. Machine-level remote-control token surface.
 *
 * This is DAEMON state (one token per daemon, NOT per project): the single
 * operator credential that lets the personal agent (Hermes) drive EVERY
 * project's architect-master through the shared daemon (X-MeshKore-Project
 * routes each ask). It therefore lives in the Config zone's daemon section,
 * never inside a project's Team panel.
 *
 * Mirrors the TEG-3 token idioms from MemberDetailPanel: status line,
 * masked token + reveal + copy, regenerate (old dies instantly), revoke
 * (danger — the personal agent loses access to ALL projects at once), and a
 * ready-to-paste connection snippet for the personal agent.
 *
 * Daemon contract (py-1.30.1), all portal-authed:
 *   GET    /remote/token         → 200 {token, minted:true} | 404 {minted:false}
 *   POST   /remote/token/rotate  → 200 {token, rotated_at}   (mints if absent)
 *   DELETE /remote/token         → 200 {deleted:true}
 * GET does NOT re-mint after a delete → "Mint token" = rotate.
 */

import { Show, createEffect, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { mcConfirm } from '~/lib/modal';
import { withAuthRetry } from '~/lib/retry';
import { Block } from './atoms';

const COMMS_DOC = '.meshkore/docs/conventions/master-copilot.md';

interface RemoteTokenState {
  minted: boolean;
  token: string | null;
  error: string | null;
}

export function RemoteControlBlock() {
  const client = () => daemonStore.state.client;

  // 2026-07-09 fix — this block now mounts at APP BOOT (GeneralConfigDrawer
  // is always in the DOM so its close animation can play), well before the
  // daemon client attaches. A one-shot `createResource(fn)` with no
  // reactive `source` param captures that early `null` client FOREVER and
  // never refetches once the daemon connects — the exact "Daemon offline /
  // not minted" bug the operator hit, even though the daemon was live and
  // the token was already auto-minted at boot (`daemon.py` calls
  // `_ensure_remote_token()`). Fixed the same way `CredentialsBlock` (V107.16)
  // already solved this: a plain signal refreshed from a `createEffect`
  // keyed on `daemonStore.state.client`, so it reruns the moment the client
  // attaches (or changes on a project switch) — not just once at mount.
  const [state, setState] = createSignal<RemoteTokenState>({ minted: false, token: null, error: null });

  const refetch = async (): Promise<void> => {
    const c = client();
    if (!c) {
      setState({ minted: false, token: null, error: null });
      return;
    }
    // `withAuthRetry` absorbs a 401 that happens right after the daemon
    // (re)connects (observed: fails on first load, succeeds a few seconds
    // later on a manual retry) — the operator should never have to click a
    // button for a request that "can't fail"; give it the same few seconds
    // automatically before ever showing an error.
    const r = await withAuthRetry(() => c.remoteTokenGet());
    if (r.ok) {
      setState({ minted: r.data.minted !== false && !!r.data.token, token: r.data.token ?? null, error: null });
      return;
    }
    if (r.status === 404) {
      setState({ minted: false, token: null, error: null });
      return;
    }
    setState({ minted: false, token: null, error: `HTTP ${r.status}` });
  };

  createEffect(() => {
    client(); // establishes the dependency — reruns on attach/project-switch
    void refetch();
  });

  const [revealed, setRevealed] = createSignal(false);
  const [snippetOpen, setSnippetOpen] = createSignal(false);
  const [copied, setCopied] = createSignal<'token' | 'snippet' | null>(null);
  const [busy, setBusy] = createSignal<'rotate' | 'delete' | 'mint' | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);

  const token = () => state()?.token ?? null;
  const minted = () => !!state()?.minted && !!token();

  const copy = async (what: 'token' | 'snippet', text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
    } catch {
      setActionError('Copy failed — your browser blocked clipboard access.');
    }
  };

  /** Endpoint the personal agent targets — the shared daemon on loopback.
   *  Derive the port from this cockpit's transport (same idiom as TEG-3),
   *  never hardcode it. */
  const askBase = (): string => {
    let port = 5573;
    try {
      const raw = new URL(client()?.transport.httpBase ?? '').port;
      if (raw) port = Number(raw);
    } catch { /* keep default */ }
    return `https://127.0.0.1:${port}`;
  };

  const connectionSnippet = (tok: string): string => {
    const base = askBase();
    return [
      `# Remote control — one machine token drives EVERY project on this Mac.`,
      `# The header X-MeshKore-Project selects which project each call hits.`,
      ``,
      `export MK_TOKEN="${tok}"`,
      `export MK_BASE="${base}"`,
      ``,
      `# 1. Discover projects`,
      `curl -sk $MK_BASE/projects -H "Authorization: Bearer $MK_TOKEN"`,
      ``,
      `# 2. Ask a project's master — returns {"request_id": "..."}`,
      `curl -sk -X POST $MK_BASE/team/architect-master/ask \\`,
      `  -H "Authorization: Bearer $MK_TOKEN" \\`,
      `  -H "X-MeshKore-Project: <project-id>" \\`,
      `  -H "content-type: application/json" \\`,
      `  -d '{"text": "How is the roadmap going?"}'`,
      ``,
      `# 3. Poll until status is "done" — the answer is in result_text`,
      `curl -sk $MK_BASE/team/requests/<request_id> \\`,
      `  -H "Authorization: Bearer $MK_TOKEN" \\`,
      `  -H "X-MeshKore-Project: <project-id>"`,
      ``,
      `# Full playbook (discover → address → ask → poll → create project;`,
      `# orders vs questions; serialization; 403 = revoked):`,
      `#   ${COMMS_DOC}`,
    ].join('\n');
  };

  const rotate = async (): Promise<void> => {
    const c = client();
    if (!c) return;
    const isMint = !minted();
    const ok = await mcConfirm(
      isMint
        ? 'Mint a new remote-control token? Paste it into your personal agent to give it access to all projects on this machine.'
        : 'Regenerate the remote-control token? The current token stops working immediately — you must re-paste the new value into your personal agent.',
      { title: isMint ? 'Mint remote token' : 'Regenerate remote token', okLabel: isMint ? 'Mint' : 'Regenerate' },
    );
    if (!ok) return;
    setBusy(isMint ? 'mint' : 'rotate');
    setActionError(null);
    const r = await c.remoteTokenRotate();
    setBusy(null);
    if (!r.ok) { setActionError(`Failed (HTTP ${r.status}).`); return; }
    setRevealed(true);
    await refetch();
  };

  const revoke = async (): Promise<void> => {
    const c = client();
    if (!c) return;
    const ok = await mcConfirm(
      'Revoke the remote-control token? Your personal agent loses access to ALL projects immediately — every remote call starts returning 401 until you mint a new token.',
      { title: 'Revoke remote token', okLabel: 'Revoke', danger: true },
    );
    if (!ok) return;
    setBusy('delete');
    setActionError(null);
    const r = await c.remoteTokenDelete();
    setBusy(null);
    if (!r.ok) { setActionError(`Revoke failed (HTTP ${r.status}).`); return; }
    setRevealed(false);
    await refetch();
  };

  return (
    <Block
      title="Remote control"
      subtitle="Machine-level token — one per daemon, drives every project. Not per-project."
    >
      <p class="text-[12px] text-gray-500 leading-relaxed mb-3">
        Your personal agent (Hermes) uses this single token to discover
        projects and talk to every project's <code class="font-mono text-emerald-300/90">architect-master</code>{' '}
        through the shared daemon. It is separate from per-member (Team)
        tokens: this one is the operator's remote control, not a limited
        third-party credential.
      </p>

      {/* Status line */}
      <div class="flex items-center gap-2 py-0.5 mb-2">
        <span class="text-gray-600 font-mono text-xs min-w-[12rem]">status</span>
        <Show
          when={minted()}
          fallback={
            <span class="inline-flex items-center gap-1.5 font-mono text-[11px] text-amber-300">
              <span class="w-1.5 h-1.5 rounded-full bg-amber-400" /> not minted
            </span>
          }
        >
          <span class="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-300">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400" /> active
          </span>
        </Show>
      </div>

      <Show when={state()?.error}>
        <div class="flex items-center justify-between gap-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200 mb-2">
          <span>{state()?.error}</span>
          <button
            type="button"
            onClick={() => void refetch()}
            class="flex-shrink-0 text-[11px] font-mono uppercase tracking-wider text-red-200 hover:text-white border border-red-500/40 hover:border-red-400/70 rounded px-2 py-1"
          >Retry</button>
        </div>
      </Show>
      <Show when={actionError()}>
        <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200 mb-2">{actionError()}</div>
      </Show>

      <Show
        when={minted()}
        fallback={
          <div class="space-y-3">
            <p class="text-[11px] text-gray-500 leading-snug">
              No remote token exists — remote calls are refused (401). Mint
              one to hand to your personal agent.
            </p>
            <button
              type="button"
              onClick={() => void rotate()}
              disabled={busy() !== null}
              class="text-[12px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-3 py-1.5 disabled:opacity-50"
            >{busy() === 'mint' ? 'Minting…' : 'Mint token'}</button>
          </div>
        }
      >
        <div class="space-y-3">
          {/* Token */}
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="font-mono text-[10px] uppercase tracking-wider text-gray-500">Bearer token</span>
              <span class="text-[10px] text-gray-600">Never expires — rotate or revoke below.</span>
            </div>
            <div class="flex gap-1.5 items-center">
              <code class="flex-1 min-w-0 truncate bg-[#020617] border border-gray-700/40 rounded px-2.5 py-1.5 text-[12px] font-mono text-gray-100 select-all">
                {revealed() ? token() : '••••••••••••••••••••••••'}
              </code>
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                class="flex-shrink-0 text-[11px] font-mono text-gray-400 hover:text-gray-100 border border-gray-700/50 hover:border-gray-500/60 rounded px-2 py-1.5"
                title={revealed() ? 'Hide token' : 'Reveal token'}
              >{revealed() ? 'Hide' : 'Reveal'}</button>
              <button
                type="button"
                onClick={() => void copy('token', token() ?? '')}
                class="flex-shrink-0 text-[11px] font-mono text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1.5"
                title="Copy token to clipboard"
              >{copied() === 'token' ? 'Copied ✓' : 'Copy'}</button>
            </div>
          </div>

          {/* Actions */}
          <div class="flex gap-1.5">
            <button
              type="button"
              onClick={() => void rotate()}
              disabled={busy() !== null}
              class="text-[11px] font-mono text-amber-300 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 rounded px-2.5 py-1.5 disabled:opacity-50"
              title="Mint a new token — the old one stops working immediately"
            >{busy() === 'rotate' ? 'Regenerating…' : 'Regenerate'}</button>
            <button
              type="button"
              onClick={() => void revoke()}
              disabled={busy() !== null}
              class="text-[11px] font-mono text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 rounded px-2.5 py-1.5 disabled:opacity-50"
              title="Destroy the token — your personal agent loses access to ALL projects immediately"
            >{busy() === 'delete' ? 'Revoking…' : 'Revoke'}</button>
          </div>

          {/* Connection snippet — collapsed by default (it's a wall of
              text most operators only need once); Show/Hide toggles it. */}
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
                  onClick={() => void copy('snippet', connectionSnippet(token()!))}
                  class="text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1"
                  title="Copy the ready-to-paste snippet (includes the real token)"
                >{copied() === 'snippet' ? 'Copied ✓' : 'Copy'}</button>
              </div>
            </div>
            <Show when={snippetOpen()}>
              <pre class="bg-[#020617] border border-gray-700/40 rounded px-2.5 py-2 text-[11px] font-mono leading-relaxed text-gray-200 overflow-x-auto whitespace-pre">
                {connectionSnippet(revealed() ? token()! : '<token — use Copy>')}
              </pre>
              <p class="text-[10px] text-gray-600 leading-snug">
                Hand this to your personal agent. The copied version always
                contains the real token. Set <code class="font-mono">X-MeshKore-Project</code>{' '}
                per call to pick the target project; the endpoint is this
                machine's shared daemon (loopback only). Full playbook:{' '}
                <code class="font-mono">{COMMS_DOC}</code>.
              </p>
            </Show>
          </div>
        </div>
      </Show>
    </Block>
  );
}
