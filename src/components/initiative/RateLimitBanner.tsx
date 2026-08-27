/**
 * RateLimitBanner — the daemon's paused quota pools, and the escape hatch.
 *
 * Dispatches against a paused pool return 503 until the cooldown
 * expires; the daemon's QuotaProber re-checks each pool every ~minute
 * and auto-unpauses when the upstream window resets. "Unpause now"
 * short-circuits that wait.
 *
 * Two shapes are read because they coexist across daemon versions:
 * `health.quota` (current, per pool key) and the legacy
 * `health.paused_agent_types` (per agent type). Current wins when present.
 */

import { For, Show, createMemo } from 'solid-js';
import { daemonStore, daemonHealth } from '~/state/daemon';
import { hhmm } from '~/lib/format-time';
import { log } from '~/lib/log';

interface PausedRow {
  label: string;
  /** Daemon-supplied unpause path — never rebuilt client-side. */
  unpauseUrl: string;
  expires_at: string;
  reason?: string;
  consecutive: number;
  last_probe?: string;
}

interface QuotaEntry {
  paused?: boolean;
  paused_until?: string;
  reason?: string;
  consecutive_rate_limits?: number;
  probes?: Array<{ at?: string; outcome?: string }>;
}
interface LegacyEntry {
  expires_at?: string;
  reason?: string;
  quota_key?: string;
  consecutive_rate_limits?: number;
}

function readPaused(): PausedRow[] {
  const h = daemonHealth() as {
    quota?: Record<string, QuotaEntry>;
    paused_agent_types?: Record<string, LegacyEntry>;
  } | null;
  const out: PausedRow[] = [];

  const q = h?.quota;
  if (q && typeof q === 'object') {
    for (const [key, entry] of Object.entries(q)) {
      if (!entry?.paused) continue;
      const probes = entry.probes ?? [];
      const last = probes[probes.length - 1];
      out.push({
        label: key,
        unpauseUrl: `/quota/${key}/unpause`,
        expires_at: String(entry.paused_until ?? ''),
        reason: entry.reason,
        consecutive: Number(entry.consecutive_rate_limits ?? 0),
        last_probe: last ? `${hhmm(last.at)} → ${last.outcome ?? '?'}` : undefined,
      });
    }
    return out;
  }

  const legacy = h?.paused_agent_types;
  if (legacy && typeof legacy === 'object') {
    for (const [type, entry] of Object.entries(legacy)) {
      out.push({
        label: entry.quota_key ?? type,
        unpauseUrl: `/agent-types/${type}/unpause`,
        expires_at: String(entry.expires_at ?? ''),
        reason: entry.reason,
        consecutive: Number(entry.consecutive_rate_limits ?? 0),
      });
    }
  }
  return out;
}

export function RateLimitBanner() {
  const paused = createMemo<PausedRow[]>(readPaused);

  const unpause = async (path: string): Promise<void> => {
    const client = daemonStore.state.client;
    if (!client) return;
    const r = await client.quotaUnpause(path);
    if (r.ok) log.info('[rate-limit] unpause requested', { path });
    else log.warn('[rate-limit] unpause failed', { path, status: r.status });
  };

  return (
    <Show when={paused().length > 0}>
      <div class="mb-4 rounded-lg border border-rose-500/40 bg-rose-500/5 px-4 py-3 text-sm">
        <div class="flex items-start gap-3">
          <span class="text-rose-300 text-lg leading-none" aria-hidden="true">⏸</span>
          <div class="flex-1 min-w-0">
            <p class="font-medium text-rose-200">
              {paused().length === 1
                ? 'Quota pool paused — rate-limited'
                : `${paused().length} quota pools paused — rate-limited`}
            </p>
            <p class="text-rose-100/75 text-xs mt-1 leading-relaxed">
              Dispatches against these pools will return 503 until the cooldown expires. The daemon's
              QuotaProber re-checks each one every ~minute and auto-unpauses when the upstream window resets.
            </p>
            <div class="mt-3 space-y-1.5">
              <For each={paused()}>
                {(p) => (
                  <div class="flex flex-wrap items-center gap-2 text-xs text-rose-100/80">
                    <code class="font-mono px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/40 text-rose-100">{p.label}</code>
                    <span class="text-gray-400">until</span>
                    <span class="font-mono text-rose-200">{hhmm(p.expires_at) || p.expires_at}</span>
                    <Show when={p.consecutive > 1}>
                      <span class="text-amber-300/80 font-mono">×{p.consecutive}</span>
                    </Show>
                    <Show when={p.last_probe}>
                      <span class="text-gray-500 font-mono">probe@{p.last_probe}</span>
                    </Show>
                    <Show when={p.reason}>
                      <span class="text-gray-500 truncate">· {p.reason}</span>
                    </Show>
                    <button
                      type="button"
                      onClick={() => { void unpause(p.unpauseUrl); }}
                      class="ml-auto px-2 py-0.5 rounded-md text-[10px] font-mono uppercase tracking-wider border bg-rose-500/15 hover:bg-rose-500/30 text-rose-200 border-rose-500/40"
                    >
                      Unpause now
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default RateLimitBanner;
