import { JSX, Show } from 'solid-js';

export type ChoiceViewProps = {
  supportsSelfUpdate: boolean;
  onAuto: () => void;
  onAgent: () => void;
  onManual: () => void;
};

const CARD_BASE = 'text-left p-4 rounded-lg border transition focus:outline-none';

export function ChoiceView(props: ChoiceViewProps): JSX.Element {
  return (
    <>
      <p class="text-[12px] text-gray-300 mb-4 leading-relaxed">
        Pick how you'd like to update. The bearer token at
        {' '}<code class="font-mono text-gray-200">.meshkore/credentials/architect-token</code>{' '}
        is preserved either way — no re-paste afterwards.
      </p>
      <div class="grid grid-cols-1 gap-2 mb-2">
        <Show
          when={props.supportsSelfUpdate}
          fallback={
            <div
              aria-disabled="true"
              class={`${CARD_BASE} bg-gray-700/10 border-gray-700/30 opacity-60 cursor-not-allowed`}
              title="This daemon is older than py-1.2.0 and doesn't have the /self-update endpoint yet. After this first manual / agent update, future updates can run with one click."
            >
              <div class="flex items-center gap-2 mb-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" width="16" height="16">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                  <polyline points="21 4 21 12 13 12" />
                </svg>
                <span class="text-[13px] font-semibold text-gray-400">Update automatically (one-click)</span>
                <span class="text-[9px] uppercase tracking-wider text-gray-500 ml-auto font-mono">unavailable</span>
              </div>
              <p class="text-[11px] text-gray-500 leading-relaxed">
                This daemon is too old (<code class="font-mono">py-1.0.0</code>-class) to update itself — the
                {' '}<code class="font-mono">/self-update</code>{' '}endpoint doesn't exist yet. Use one of the
                options below this once; every future update will be one-click.
              </p>
            </div>
          }
        >
          <button
            type="button"
            class={`${CARD_BASE} bg-emerald-500/[0.06] border-emerald-400/30 hover:border-emerald-400/50`}
            onClick={props.onAuto}
          >
            <div class="flex items-center gap-2 mb-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" width="16" height="16">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
                <polyline points="21 4 21 12 13 12" />
              </svg>
              <span class="text-[13px] font-semibold text-emerald-300">Update automatically (one-click)</span>
              <span class="text-[9px] uppercase tracking-wider text-emerald-400/70 ml-auto font-mono">recommended</span>
            </div>
            <p class="text-[11px] text-gray-400 leading-relaxed">
              The daemon downloads + swaps itself in. The cockpit
              reconnects to the new port automatically. Nothing for
              you to copy or paste.
            </p>
          </button>
        </Show>
        <button
          type="button"
          class={`${CARD_BASE} bg-gray-900 border-gray-800 hover:border-gray-700`}
          onClick={props.onAgent}
        >
          <div class="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" width="16" height="16">
              <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />
            </svg>
            <span class="text-[13px] font-semibold text-emerald-300">Use a local agent</span>
          </div>
          <p class="text-[11px] text-gray-400 leading-relaxed">
            Generate a paste-ready prompt for Claude Code, Codex,
            Copilot, Cursor, Windsurf… The agent kills the old daemon,
            re-downloads, restarts.
          </p>
        </button>
        <button
          type="button"
          class={`${CARD_BASE} bg-gray-900 border-gray-800 hover:border-gray-700`}
          onClick={props.onManual}
        >
          <div class="flex items-center gap-2 mb-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="2" width="16" height="16">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            <span class="text-[13px] font-semibold text-gray-200">Do it manually</span>
          </div>
          <p class="text-[11px] text-gray-400 leading-relaxed">
            Copy a one-liner and paste it in your terminal. Faster
            if you already have the project folder open in a shell.
          </p>
        </button>
      </div>
    </>
  );
}
