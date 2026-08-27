/**
 * ContextGauge — CTX1 (daemon py-1.28.0). The per-turn context-window
 * fill, painted as a small conic-gradient ring. Present only for
 * runtimes with a known window (claude-code); the strip hides it
 * otherwise. Amber once the daemon says the turn ran hot
 * (`should_compact`, ≥50%).
 */

import type { ChatContextBlock } from '~/lib/daemon-client';

export default function ContextGauge(props: { context: ChatContextBlock }) {
  const pct = (): number => Math.round((props.context.fill_ratio ?? 0) * 100);
  const hot = (): boolean => !!props.context.should_compact;
  const ring = (): string => {
    const deg = Math.round((props.context.fill_ratio ?? 0) * 360);
    const fill = hot() ? '#f59e0b' : '#34d399';
    return `conic-gradient(${fill} ${deg}deg, rgba(75,85,99,0.4) ${deg}deg)`;
  };
  const tip = (): string =>
    `Context window: ${pct()}% full `
    + `(${props.context.prompt_tokens.toLocaleString()} / ${(props.context.window ?? 0).toLocaleString()} tokens, `
    + `${props.context.platform})`
    + (hot() ? ' — running hot; will compact at next turn boundary.' : '.');
  return (
    <span
      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0 border"
      classList={{
        'text-amber-200 bg-amber-500/10 border-amber-500/30': hot(),
        'text-gray-300 bg-gray-800/60 border-gray-700/50': !hot(),
      }}
      title={tip()}
    >
      <span class="inline-block w-3 h-3 rounded-full" style={{ background: ring() }} aria-hidden="true" />
      <span>{pct()}%</span>
    </span>
  );
}
