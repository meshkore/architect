/**
 * StorageBlock — Standard v22 capacity panel for `.meshkore/`.
 *
 * Polls `GET /storage/usage` every 10 s (cheaper than the daemon's
 * 5-s cache means most polls are cache hits). Renders a per-bucket
 * progress bar so the operator can see which subtree is growing
 * fastest, the bucket's retention policy when one applies, and the
 * total at the bottom.
 *
 * Initiative: capacity-tuning. Future: per-bucket "Purge older than
 * N days" buttons + per-bucket retention dials writing back to
 * cluster.yaml. v22 ships the read-only view.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import type { StorageBucket, StorageUsageResponse } from '~/lib/daemon-client';
import { Block } from './atoms';

type BucketRow = StorageBucket;
type StorageReport = StorageUsageResponse;

const POLL_MS = 10_000;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function StorageBlock() {
  const [report, setReport] = createSignal<StorageReport | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let timer: number | undefined;

  const fetchOnce = async (): Promise<void> => {
    const c = daemonStore.state.client;
    if (!c) {
      setError('No daemon connection');
      return;
    }
    try {
      const r = await c.storageUsage();
      if (!r.ok) {
        setError(`HTTP ${r.status}`);
        return;
      }
      setReport(r.data);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  onMount(() => {
    void fetchOnce();
    timer = window.setInterval(() => void fetchOnce(), POLL_MS);
  });
  onCleanup(() => {
    if (timer !== undefined) window.clearInterval(timer);
  });

  const total = (): number => report()?.total_bytes ?? 0;
  const buckets = createMemo<BucketRow[]>(() => {
    const r = report();
    if (!r) return [];
    // Sort by size desc so the biggest is on top — operators care most.
    return r.buckets.slice().sort((a, b) => b.bytes - a.bytes);
  });

  return (
    <Block
      title="Storage — .meshkore/"
      subtitle="Disk usage per bucket. The daemon caches results for 5 s; the cockpit polls every 10 s."
    >
      <Show when={error()}>
        <div class="text-red-300 text-xs font-mono mb-2">⚠ {error()}</div>
      </Show>
      <Show
        when={report()}
        fallback={<div class="text-gray-500 text-xs font-mono">loading…</div>}
      >
        <ul class="space-y-1.5">
          <For each={buckets()}>
            {(b) => {
              const pct = (): number => (total() > 0 ? (b.bytes / total()) * 100 : 0);
              return (
                <li class="grid items-center gap-x-3 py-0.5" style={{ 'grid-template-columns': '8.5rem 1fr auto' }}>
                  <span class="text-gray-300 font-mono text-xs flex items-center gap-1.5 min-w-0">
                    <span class="truncate" title={b.name}>{b.name}</span>
                    <Show when={b.retention_days !== undefined}>
                      <span
                        class="text-[9px] text-amber-300/80 font-mono whitespace-nowrap"
                        title={`Retention: ${b.retention_days} days`}
                      >
                        · {b.retention_days}d
                      </span>
                    </Show>
                  </span>
                  <span class="h-2 rounded bg-gray-800/70 overflow-hidden relative min-w-0">
                    <span
                      class="absolute inset-y-0 left-0 rounded transition-[width] duration-300"
                      style={{
                        width: `${Math.max(2, pct())}%`,
                        background: b.exists
                          ? 'var(--theme-accent-bright, #34d399)'
                          : 'transparent',
                        opacity: b.exists ? 0.8 : 0,
                      }}
                    />
                  </span>
                  <span class="text-gray-400 font-mono text-[11px] whitespace-nowrap text-right">
                    <span class="text-gray-200">{formatBytes(b.bytes)}</span>
                    <span class="text-gray-600"> · {b.files}f</span>
                  </span>
                </li>
              );
            }}
          </For>
        </ul>
        <div class="flex justify-between items-center mt-3 pt-3 border-t border-gray-800/70">
          <span class="text-gray-500 font-mono text-[10px]">
            {report()!.total_files} files · cached {report()!.cache_ttl_secs}s
          </span>
          <span class="text-gray-100 font-mono text-sm">
            total {formatBytes(total())}
          </span>
        </div>
      </Show>
    </Block>
  );
}
