/**
 * state/boot-gate.ts — what the cockpit's main area is allowed to show.
 *
 * Two policies, extracted from `Cockpit.tsx` (ST-13) so they are
 * readable and testable in one place:
 *
 *   createBootGate()    — when the workspace may paint instead of the
 *                         BootingPanel, including AX3's rule that a
 *                         project we already have data for paints
 *                         immediately and revalidates behind a marker.
 *   createCockpitGate() — the whole main-area decision as ONE union,
 *                         replacing a six-deep chain of nested <Show>.
 *
 * Both create Solid signals/effects, so call them from inside a
 * component (or a root).
 */

import { createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { chatStore } from '~/state/chat';
import { daemonStore } from '~/state/daemon';
import { serverStore } from '~/state/server';
import { isDaemonBehind } from '~/lib/version';

/**
 * 2026-06-13 — BootingPanel escape hatch. The gate normally waits for
 * BOTH the roadmap snapshot and the chat snapshot. If `/chat/snapshot`
 * hangs (a ChatSessions lock deadlock — ikamiro incident) the panel
 * would block the ENTIRE project forever, so chat hydration gets a grace
 * window and then we fall through: chat lazy-loads when a conv is
 * focused. A hung chat endpoint must never brick the whole UI.
 */
const CHAT_HYDRATE_GRACE_MS = 3000;

/**
 * A-BOOT-01 (V109) — the same dead-end existed on the roadmap leg, with
 * no escape at all. Two exits: the refresh reported an error, or this
 * hard grace elapses. On escape the cockpit renders and the roadmap zone
 * shows its own empty/error state.
 */
const BOOT_HARD_GRACE_MS = 10000;

export interface BootGate {
  /** May the workspace paint? */
  booted: () => boolean;
  /** AX3 — the workspace is painting from the in-memory session cache
   *  and fresh daemon data has not landed yet. */
  revalidating: () => boolean;
}

export function createBootGate(): BootGate {
  // Track boolean readiness, NOT snapshot object identity:
  // `serverStore.state.snapshot` is replaced on every roadmap refresh, so
  // reading it directly in the grace effect restarted the timer forever
  // and BootingPanel hung whenever /chat/snapshot was slow.
  const has = (v: unknown): boolean => v !== null && v !== undefined;
  const snapReady = createMemo(() => has(serverStore.state.snapshot));
  const chatReady = createMemo(() => has(chatStore.state.convsHydratedAt));
  const snapFailed = createMemo(
    () => !has(serverStore.state.snapshot) && has(serverStore.state.error),
  );

  const [chatGraceElapsed, setChatGraceElapsed] = createSignal(false);
  createEffect(() => {
    // Start the chat grace once the roadmap snapshot is in but chat is
    // not. Only re-runs when either BOOLEAN flips.
    if (snapReady() && !chatReady()) {
      setChatGraceElapsed(false);
      const t = setTimeout(() => setChatGraceElapsed(true), CHAT_HYDRATE_GRACE_MS);
      onCleanup(() => clearTimeout(t));
    }
  });

  const [hardGraceElapsed, setHardGraceElapsed] = createSignal(false);
  // AX3 — whether the roadmap slice for this project was ALREADY
  // populated at the instant we switched to it. Sampled in the same
  // effect that resets the escape window, i.e. before any fetch for this
  // activation can have resolved, so a non-null slice here can only have
  // come from a previous visit. That is what distinguishes "cached, paint
  // now" from "cold boot, wait".
  const [roadmapFromCache, setRoadmapFromCache] = createSignal(false);
  createEffect(() => {
    const id = daemonStore.state.activeId;
    // UNTRACKED on purpose: this effect must re-run on a project switch
    // and nothing else. `byCluster[id]` is rewritten on every refresh
    // tick, and tracking it would restart the hard-grace timer forever —
    // the same shape as the bug the chat grace comment above describes.
    untrack(() => setRoadmapFromCache(!!id && has(serverStore.state.byCluster[id]?.snapshot)));
    setHardGraceElapsed(false);
    const t = setTimeout(() => setHardGraceElapsed(true), BOOT_HARD_GRACE_MS);
    onCleanup(() => clearTimeout(t));
  });

  /**
   * AX3 — this project was visited earlier in the session and its data
   * is still in memory. `convsStale` is set by the chat store when
   * `bindCluster` restores a cached slice; it clears when the daemon
   * snapshot lands.
   */
  const paintableFromCache = (): boolean => {
    if (!daemonStore.state.activeId) return false;
    return chatStore.state.convsStale || roadmapFromCache();
  };

  const booted = (): boolean => {
    // Cached data beats every wait: the operator already saw this
    // project, blocking them behind two serial round-trips to re-learn
    // what we still have in memory is the bug AX3 fixes.
    if (paintableFromCache()) return true;
    if (snapFailed() || hardGraceElapsed()) return true; // escape — never brick
    if (!snapReady()) return false;                      // roadmap still loading
    if (chatReady()) return true;                        // both ready
    return chatGraceElapsed();                           // chat slow/hung
  };

  const revalidating = (): boolean =>
    paintableFromCache() && (chatStore.state.convsStale || !snapReady());

  return { booted, revalidating };
}

/**
 * The main area's state. Ordered by precedence — a daemon the cockpit
 * cannot talk to outranks anything it would otherwise render.
 *
 * `outdated` / `ahead` / `behind` are three genuinely distinct live
 * states with three different remedies (upgrade the daemon, reload the
 * cockpit, wait for the self-update) and must not be consolidated.
 */
export type CockpitGate =
  | 'connection'   // no daemon attached and the boot probe is unresolved
  | 'outdated'     // daemon below the minimum this cockpit supports
  | 'ahead'        // daemon ahead by ≥ minor; the wire format may have moved
  | 'behind'       // daemon between MIN and EXPECTED; self-update path
  | 'offline'      // the operator selected an unreachable project
  | 'empty'        // no project selected
  | 'booting'      // first-ever visit, nothing paintable yet
  | 'ready';

export function createCockpitGate(connectionUnresolved: () => boolean): {
  gate: () => CockpitGate;
  revalidating: () => boolean;
} {
  const { booted, revalidating } = createBootGate();
  const gate = createMemo<CockpitGate>(() => {
    if (!daemonStore.state.activeId && connectionUnresolved()) return 'connection';
    if (daemonStore.state.outdated) return 'outdated';
    if (daemonStore.state.ahead) return 'ahead';
    const version = daemonStore.state.version;
    if (version && isDaemonBehind(version)) return 'behind';
    if (daemonStore.state.offlineSelection) return 'offline';
    if (!daemonStore.state.activeId) return 'empty';
    if (!booted()) return 'booting';
    return 'ready';
  });
  return { gate, revalidating };
}
