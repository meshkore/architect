/**
 * RunnerAuthCard — shown in the chat when the daemon emits
 * `runner.auth.required`. Lets the operator trigger the OAuth browser
 * flow for cursor-agent or claude-code with one click, then polls via
 * `runner.auth.polling` / `runner.auth.completed` WS events until done.
 *
 * Dismissed automatically on `runner.auth.completed`. The operator can
 * re-trigger at any time by clicking the button again.
 */

import { createSignal, Show, onCleanup } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { log } from '~/lib/log';
import type { DaemonEvent } from '~/lib/daemon-client';

const PLATFORM_LABELS: Record<string, { name: string; hint: string }> = {
  cursor: {
    name: 'Cursor Agent',
    hint: 'A browser window will open to authorize Cursor. Accept access and come back here.',
  },
  'claude-code': {
    name: 'Claude Code',
    hint: 'A browser window will open to authorize Claude Code (Anthropic). Accept and come back here.',
  },
  wrangler: {
    name: 'Cloudflare (Wrangler)',
    hint: 'A browser window will open to authorize Wrangler on your Cloudflare account. Required for Pages/Workers deploys.',
  },
  gh: {
    name: 'GitHub CLI',
    hint: 'A browser window will open to authorize the GitHub CLI (gh). Required for repository and Actions operations.',
  },
  fly: {
    name: 'Fly.io',
    hint: 'A browser window will open to authorize Fly.io. Required for fly.io deploys.',
  },
  vercel: {
    name: 'Vercel',
    hint: 'A browser window will open to authorize Vercel. Required for vercel.com deploys.',
  },
};

type AuthState = 'idle' | 'started' | 'polling' | 'done' | 'error';

export default function RunnerAuthCard(props: {
  platform: string;
  conv: string;
  onDismiss?: () => void;
}) {
  const [authState, setAuthState] = createSignal<AuthState>('idle');
  const [elapsed, setElapsed] = createSignal(0);
  const [errMsg, setErrMsg] = createSignal('');

  const info = () => PLATFORM_LABELS[props.platform] ?? {
    name: props.platform,
    hint: 'A browser window will open to authenticate this runner.',
  };

  // Listen for auth WS events from the daemon
  const ws = () => (daemonStore.state as any).ws as { on: (t: string, cb: (e: DaemonEvent) => void) => () => void } | undefined;

  let ticker: ReturnType<typeof setInterval> | undefined;
  let offPolling: (() => void) | undefined;
  let offCompleted: (() => void) | undefined;

  const stopListening = () => {
    offPolling?.();
    offCompleted?.();
    offPolling = undefined;
    offCompleted = undefined;
    if (ticker) { clearInterval(ticker); ticker = undefined; }
  };

  const startListening = () => {
    stopListening();
    const w = ws();
    if (!w) return;

    offPolling = w.on('runner.auth.polling', (ev) => {
      if (ev.platform !== props.platform) return;
      setAuthState('polling');
    });

    offCompleted = w.on('runner.auth.completed', (ev) => {
      if (ev.platform !== props.platform) return;
      setAuthState('done');
      stopListening();
      // Auto-dismiss after 2 s
      setTimeout(() => props.onDismiss?.(), 2000);
    });

    // Elapsed counter
    ticker = setInterval(() => setElapsed((n) => n + 1), 1000);
  };

  onCleanup(stopListening);

  const handleAuth = async () => {
    setAuthState('started');
    setElapsed(0);
    setErrMsg('');
    startListening();

    const client = daemonStore.state.client;
    if (!client) { setAuthState('error'); setErrMsg('No daemon client available.'); return; }

    const res = await (client as any).request?.('POST', `/auth/${props.platform}/start`, {}, undefined)
      ?? await fetch(
          `${(client as any).transport?.httpBase ?? ''}/auth/${props.platform}/start`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(((client as any).transport?.token) ? { authorization: `Bearer ${(client as any).transport.token}` } : {}),
            },
            body: '{}',
          },
        ).then((r) => r.json()).catch(() => ({ ok: false }));

    if (!res || res.ok === false) {
      setAuthState('error');
      setErrMsg(res?.body ?? res?.msg ?? 'Failed to launch login');
      stopListening();
    }
    log.info('runner-auth start', { platform: props.platform, res });
  };

  const btnLabel = () => {
    switch (authState()) {
      case 'idle': return `Authenticate ${info().name}`;
      case 'started': return 'Opening browser…';
      case 'polling': return `Verifying… ${elapsed()}s`;
      case 'done': return '✓ Authenticated';
      case 'error': return 'Retry';
    }
  };

  const btnDisabled = () => authState() === 'started' || authState() === 'done';

  return (
    <div class="my-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <div class="flex items-start gap-3">
        {/* Icon */}
        <div class="mt-0.5 flex-shrink-0 text-amber-400 text-lg leading-none">⚠</div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-amber-300 mb-1">
            {info().name} needs authentication
          </p>
          <p class="text-gray-300 mb-3 leading-relaxed">
            {info().hint}
          </p>

          <Show when={authState() === 'polling'}>
            <p class="text-gray-400 text-xs mb-2">
              Waiting for daemon confirmation… ({elapsed()}s)
              <span class="ml-1 inline-block animate-pulse">●</span>
            </p>
          </Show>

          <Show when={authState() === 'done'}>
            <p class="text-emerald-400 text-xs mb-2 font-medium">
              ✓ Authentication completed — resuming…
            </p>
          </Show>

          <Show when={authState() === 'error'}>
            <p class="text-red-400 text-xs mb-2">{errMsg()}</p>
          </Show>

          <div class="flex gap-2 flex-wrap">
            <button
              onClick={handleAuth}
              disabled={btnDisabled()}
              class={[
                'rounded px-4 py-1.5 text-sm font-medium transition-colors',
                authState() === 'done'
                  ? 'bg-emerald-600 text-white cursor-default'
                  : 'bg-amber-500 hover:bg-amber-400 text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed',
              ].join(' ')}
            >
              {btnLabel()}
            </button>
            <Show when={authState() !== 'done'}>
              <button
                onClick={() => props.onDismiss?.()}
                class="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
              >
                Dismiss
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
