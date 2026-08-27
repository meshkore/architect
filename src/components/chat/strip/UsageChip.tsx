/**
 * UsageChip — CU1 (daemon py-1.13.3). Cumulative token usage and cost
 * for the conv, broadcast after every `chat.assistant.final`. Hidden
 * until the first turn finalises. Resets on daemon restart — durable
 * accounting is `usage-ledger` territory.
 */

import type { ChatUsageTotal } from '~/lib/daemon-client';

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export default function UsageChip(props: { usage: ChatUsageTotal }) {
  const tooltip = (): string => {
    const u = props.usage;
    return `${u.turns} turns · ${u.input_tokens} input · ${u.output_tokens} output · `
      + `${u.cache_read_input_tokens} cache-read · ${u.cache_creation_input_tokens} cache-write · `
      + `$${u.cost_usd.toFixed(4)}`;
  };
  return (
    <span
      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-300 bg-gray-800/60 border border-gray-700/50 flex-shrink-0"
      title={tooltip()}
    >
      <span class="text-gray-400">↓</span>
      <span>{compact(props.usage.input_tokens)}</span>
      <span class="text-gray-400">↑</span>
      <span>{compact(props.usage.output_tokens)}</span>
      <span class="text-gray-500">·</span>
      <span class="text-emerald-300">${(props.usage.cost_usd ?? 0).toFixed(2)}</span>
    </span>
  );
}
