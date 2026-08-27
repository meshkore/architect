/**
 * snapshot-trim.ts — AX7 (UX-F4). What of a daemon snapshot is allowed
 * into localStorage, and how it degrades when it doesn't fit.
 *
 * The cockpit's `/state` payload is unbounded: every initiative and
 * every task carries its full markdown `body`, and `docs` is a whole
 * tree. On a mature cluster that is megabytes — far past any
 * localStorage quota, and useless as a first-paint cache because the
 * roadmap rows render from frontmatter alone (bodies are fetched on
 * expand via `readMarkdownFile(path)`).
 *
 * So the cache stores the SHAPE, never the prose, and a hard budget
 * decides what survives. Over budget we degrade in stages rather than
 * writing nothing: a cluster whose roadmap alone blows the cap should
 * still get its chat rail painted instantly.
 *
 * Deliberately dependency-free (same rule as `link-status.ts` /
 * `swap-guard.ts`): the trim and the cap are the load-bearing rules
 * here, so they stay directly testable without a DOM, a store, or a
 * daemon.
 */

export const SNAPSHOT_CACHE_VERSION = 1;

/**
 * Per-cluster byte budget. localStorage gives a browser ~5 MB for the
 * WHOLE origin and the cockpit shares it with tokens, view prefs and
 * convMeta, so a handful of clusters must fit comfortably inside a
 * fraction of it. 180 KB × 6 clusters ≈ 1 MB worst case.
 */
export const SNAPSHOT_CACHE_BUDGET = 200_000;

/** How many clusters keep a cached snapshot before the oldest is evicted. */
export const SNAPSHOT_CACHE_MAX_CLUSTERS = 6;

/**
 * Conv summaries kept when the payload has to shrink. A cluster that has
 * been running agents for months accumulates hundreds of archived convs
 * — 276 of them, 127 KB, on the cockpit's own project — which would eat
 * the whole budget and push the roadmap out for a rail nobody scrolls
 * that far down. The most recently active ones are the rail.
 */
export const CONV_CACHE_CAP = 120;

export type JsonObject = Record<string, unknown>;

export interface CachedSnapshotEnvelope {
  v: number;
  /** Epoch ms the payload was written. Drives eviction + the age log. */
  saved_at: number;
  /** Which degradation stage survived the budget (0 = nothing extra dropped). */
  stage: number;
  server: JsonObject | null;
  chat: JsonObject | null;
}

/**
 * Size in UTF-16 code units — what browsers actually charge against the
 * localStorage quota, and what `String.length` reports. Using
 * TextEncoder here would measure UTF-8 and understate the real cost.
 */
function measure(json: string): number {
  return json.length;
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Copy an entry minus the fields that carry markdown prose. */
function withoutBody(entry: unknown): JsonObject | null {
  if (!isObject(entry)) return null;
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'body') continue;
    out[k] = v;
  }
  return out;
}

function stripBodies(entries: unknown): JsonObject[] {
  const out: JsonObject[] = [];
  for (const e of asArray(entries)) {
    const kept = withoutBody(e);
    if (kept) out.push(kept);
  }
  return out;
}

/**
 * Cache-safe copy of a `ServerSnapshot`.
 *
 * Dropped outright: `docs` (a full tree the knowledge zone re-fetches
 * anyway) and every `body`. Everything the roadmap/module rows read —
 * ids, titles, status, module, initiative, deps, resolution pointers —
 * is frontmatter-sized and stays.
 */
export function trimServerSnapshot(snap: unknown): JsonObject | null {
  if (!isObject(snap)) return null;
  const out: JsonObject = {};
  if (isObject(snap.cluster)) out.cluster = snap.cluster;
  if (typeof snap.generated_at === 'string') out.generated_at = snap.generated_at;

  const modules = asArray(snap.modules)
    .map((m) => {
      if (!isObject(m)) return null;
      const copy: JsonObject = { ...m };
      if ('tasks' in copy) copy.tasks = stripBodies(copy.tasks);
      return copy;
    })
    .filter((m): m is JsonObject => m !== null);
  if (modules.length > 0) out.modules = modules;

  if (isObject(snap.roadmap)) {
    const roadmap: JsonObject = {};
    roadmap.tasks = stripBodies(snap.roadmap.tasks);
    if (isObject(snap.roadmap.stats)) roadmap.stats = snap.roadmap.stats;
    out.roadmap = roadmap;
  }

  const initiatives = stripBodies(snap.initiatives);
  if (initiatives.length > 0) out.initiatives = initiatives;
  return out;
}

/**
 * Cache-safe copy of a `ChatSnapshotResponse`.
 *
 * Conv summaries are small and are exactly what the agents rail paints
 * from, so they stay whole minus two fields: `current_turn` (carries
 * `partial_text`, unbounded) and `queue`. Both describe a turn that was
 * in flight in a PREVIOUS session — replaying them from cache would
 * strand a streaming bubble that no daemon is feeding.
 */
export function trimChatSnapshot(snap: unknown): JsonObject | null {
  if (!isObject(snap)) return null;
  const convs: JsonObject[] = [];
  for (const c of asArray(snap.convs)) {
    if (!isObject(c)) continue;
    const copy: JsonObject = {};
    for (const [k, v] of Object.entries(c)) {
      if (k === 'current_turn' || k === 'queue') continue;
      copy[k] = v;
    }
    convs.push(copy);
  }
  const out: JsonObject = { convs };
  for (const k of ['paused_agent_types', 'quota', 'debug', 'version', 'generated_at']) {
    if (k in snap) out[k] = snap[k];
  }
  return out;
}

/** Keep the `max` most recently active convs. Anything the daemon calls
 *  live survives regardless of where its timestamp sorts. */
function capConvs(chat: JsonObject, max: number): JsonObject {
  const convs = asArray(chat.convs).filter(isObject);
  if (convs.length <= max) return chat;
  const when = (c: JsonObject): string =>
    typeof c.last_activity_at === 'string' ? c.last_activity_at : '';
  const live = convs.filter((c) => c.live === true);
  const rest = convs
    .filter((c) => c.live !== true)
    .sort((a, b) => when(b).localeCompare(when(a)))
    .slice(0, Math.max(0, max - live.length));
  return { ...chat, convs: [...live, ...rest] };
}

/**
 * Successive give-ups, applied only when the trimmed payload is still
 * over budget.
 *
 * The order is what costs the operator least on a cold boot: old convs
 * they would have to scroll for, then the module tree (whose rows also
 * come from `cluster.modules`), then the roadmap.
 *
 * Note what is deliberately NOT a stage: a PARTIAL roadmap. Initiative
 * cards show "19/20 tasks", counted from the task list — cache half of
 * it and the card states a wrong number as fact for a second. The
 * roadmap is cached whole or not at all; when not, the zone shows its
 * own loading state, which is honest.
 */
function degrade(env: CachedSnapshotEnvelope, stage: number): CachedSnapshotEnvelope | null {
  if (stage === 0) return env;
  const capped = env.chat ? capConvs(env.chat, CONV_CACHE_CAP) : null;
  if (stage === 1) return { ...env, stage, chat: capped };
  if (stage === 2 && env.server) {
    const server: JsonObject = { ...env.server };
    delete server.modules;
    return { ...env, stage, server, chat: capped };
  }
  if (stage === 3) return { ...env, stage, server: null, chat: capped };
  return null;
}

const LAST_STAGE = 3;

export interface PackedSnapshot {
  json: string;
  envelope: CachedSnapshotEnvelope;
}

/**
 * Trim, then shrink until it fits. Returns null when even the chat-only
 * payload is over budget — the caller then writes nothing and the boot
 * falls back to the network, which is the pre-AX7 behaviour and always
 * correct.
 */
export function packSnapshot(
  server: unknown,
  chat: unknown,
  savedAt: number,
  budget: number = SNAPSHOT_CACHE_BUDGET,
): PackedSnapshot | null {
  const base: CachedSnapshotEnvelope = {
    v: SNAPSHOT_CACHE_VERSION,
    saved_at: savedAt,
    stage: 0,
    server: trimServerSnapshot(server),
    chat: trimChatSnapshot(chat),
  };
  if (!base.server && !base.chat) return null;
  for (let stage = 0; stage <= LAST_STAGE; stage += 1) {
    const candidate = degrade(base, stage);
    if (!candidate) break;
    const json = JSON.stringify(candidate);
    if (measure(json) <= budget) return { json, envelope: candidate };
  }
  return null;
}

/** True when a parsed blob is an envelope this cockpit understands. */
export function isCachedSnapshot(v: unknown): v is CachedSnapshotEnvelope {
  if (!isObject(v)) return false;
  if (v.v !== SNAPSHOT_CACHE_VERSION) return false;
  if (typeof v.saved_at !== 'number') return false;
  return (isObject(v.server) || v.server === null) && (isObject(v.chat) || v.chat === null);
}

/**
 * Which cached clusters to drop. Newest `max` survive; everything older
 * is a victim, so the cache can never grow with the number of projects
 * the operator has ever opened.
 */
export function evictionVictims(
  entries: ReadonlyArray<{ key: string; savedAt: number }>,
  max: number = SNAPSHOT_CACHE_MAX_CLUSTERS,
): string[] {
  if (entries.length <= max) return [];
  return [...entries]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(max)
    .map((e) => e.key);
}
