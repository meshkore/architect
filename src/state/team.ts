/**
 * state/team.ts — reactive mirror of the agent-team roster (ATM3).
 *
 * The daemon owns the roster (`.meshkore/team/*.md`, served at /team,
 * ATM9). This store is a thin cockpit-side mirror:
 *
 *  - `hydrate(client)` calls GET /team and replaces `list` (frontmatter
 *    + live instance counts, sorted by pinned_order).
 *  - `detail(client, id)` lazy-loads a member's init-prompt body and
 *    caches it under `details[id]`.
 *  - WS events `team.created | team.updated | team.deleted` trigger a
 *    re-hydrate so cards appear/disappear within ~1s (ATM3 done-when).
 *  - Mutations (create/update/delete) go to the daemon via the client;
 *    the WS event round-trips back and refreshes the list, but we also
 *    apply an optimistic local patch so the UI feels instant.
 *
 * Per-cluster: `bindCluster` resets the store on project switch so one
 * cluster's roster never bleeds into another (same isolation contract
 * as chatStore / storyStore).
 */

import { createStore } from 'solid-js/store';
import { log } from '~/lib/log';
import type {
  DaemonClient,
  DaemonEvent,
  TeamMember,
  TeamMemberDetail,
  TeamCreateBody,
  TeamPatchBody,
} from '~/lib/daemon-client';

interface TeamStoreState {
  /** Roster, sorted by pinned_order (daemon order preserved). */
  list: TeamMember[];
  /** Lazy-loaded member bodies, keyed by member id. */
  details: Record<string, TeamMemberDetail>;
  /** True once the first hydration round-trip completed for this cluster. */
  hydrated: boolean;
  /** True while a hydrate() is in flight (drives the roster spinner). */
  loading: boolean;
  /** Last hydrate error message, or null. */
  error: string | null;
  /** Member id highlighted briefly after create (ATM4 step 4). */
  recentlyCreated: string | null;
  /** TEG-3 — member id → ms timestamp of the last team.request.* WS
   *  event. Drives the subtle "external activity" pulse on the roster
   *  card; entries clear themselves after a few seconds. */
  requestPulse: Record<string, number>;
}

const [state, setState] = createStore<TeamStoreState>({
  list: [],
  details: {},
  hydrated: false,
  loading: false,
  error: null,
  recentlyCreated: null,
  requestPulse: {},
});

let activeCluster: string | null = null;

function bindCluster(clusterId: string | null): void {
  if (activeCluster === clusterId) return;
  activeCluster = clusterId;
  setState({ list: [], details: {}, hydrated: false, loading: false, error: null, recentlyCreated: null, requestPulse: {} });
}

function sortByPinned(members: TeamMember[]): TeamMember[] {
  return [...members].sort((a, b) => {
    const ao = a.pinned_order ?? 9999;
    const bo = b.pinned_order ?? 9999;
    if (ao !== bo) return ao - bo;
    return (a.name ?? a.id).localeCompare(b.name ?? b.id);
  });
}

/** GET /team → replace the roster. Idempotent; safe to call on any
 *  team.* WS event. */
async function hydrate(client: DaemonClient): Promise<void> {
  setState('loading', true);
  const res = await client.teamList();
  if (res.ok) {
    setState({ list: sortByPinned(res.data ?? []), hydrated: true, loading: false, error: null });
  } else {
    // A daemon that doesn't expose /team yet (older than ATM9) returns
    // 404 — treat as an empty roster, not a hard error, so the panel
    // renders its empty state instead of a red banner.
    const soft = res.status === 404 || res.status === 0;
    setState({
      list: [],
      hydrated: true,
      loading: false,
      error: soft ? null : `Failed to load team (HTTP ${res.status})`,
    });
    if (!soft) log.warn('teamStore.hydrate failed', { status: res.status });
  }
}

/** Lazy-load one member's init-prompt body (GET /team/<id>). Cached. */
async function detail(client: DaemonClient, id: string, force = false): Promise<TeamMemberDetail | null> {
  if (!force && state.details[id]) return state.details[id]!;
  const res = await client.teamGet(id);
  if (!res.ok) {
    log.warn('teamStore.detail failed', { id, status: res.status });
    return null;
  }
  setState('details', id, res.data);
  return res.data;
}

/** Look up a member from the list (frontmatter only, no body). */
function get(id: string | null | undefined): TeamMember | undefined {
  if (!id) return undefined;
  return state.list.find((m) => m.id === id);
}

/** The generic `developer` member — the default `+` binding (ATM7).
 *  Falls back to the first profile if a cluster renamed it. */
function developer(): TeamMember | undefined {
  return get('developer') ?? state.list.find((m) => m.kind === 'profile' && !m.required);
}

/** Members eligible for the chat-rail picker: hide singletons that
 *  already have a live instance (ATM7). */
function pickable(): TeamMember[] {
  return state.list.filter((m) => !(m.kind === 'singleton' && (m.instances ?? 0) > 0));
}

// ── Mutations ───────────────────────────────────────────────────────

async function create(
  client: DaemonClient,
  body: TeamCreateBody,
): Promise<{ ok: true; member: TeamMember } | { ok: false; status: number; error?: string }> {
  const res = await client.teamCreate(body);
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.body };
  }
  // Optimistic insert so the card shows immediately; the team.created
  // WS event will re-hydrate the authoritative list right after.
  setState('list', (prev) => sortByPinned([...prev.filter((m) => m.id !== res.data.id), res.data]));
  setState('recentlyCreated', res.data.id);
  setTimeout(() => {
    if (state.recentlyCreated === res.data.id) setState('recentlyCreated', null);
  }, 4000);
  return { ok: true, member: res.data };
}

async function update(
  client: DaemonClient,
  id: string,
  body: TeamPatchBody,
): Promise<{ ok: true; member: TeamMember } | { ok: false; status: number; error?: string }> {
  const prevList = state.list;
  const prevDetail = state.details[id];
  // Optimistic patch on both the list row and the cached detail.
  setState('list', (m) => m.id === id, (m) => ({ ...m, ...body }));
  if (prevDetail) setState('details', id, (d) => ({ ...d, ...body }));
  const res = await client.teamUpdate(id, body);
  if (!res.ok) {
    // Rollback.
    setState('list', prevList);
    if (prevDetail) setState('details', id, prevDetail);
    return { ok: false, status: res.status, error: res.body };
  }
  setState('list', (m) => m.id === id, () => res.data);
  if (prevDetail) setState('details', id, (d) => ({ ...d, ...res.data }));
  // TEG-3 — revoke hygiene: flipping to internal destroys the token
  // server-side; drop the cached copy immediately so no stale token
  // lingers in memory (the merge above wouldn't clear it).
  if (body.exposure === 'internal' && state.details[id]) {
    setState('details', id, 'token', undefined);
  }
  return { ok: true, member: res.data };
}

/** TEG-3 — POST /team/<id>/token/rotate. On success, patches the cached
 *  detail so the panel shows the fresh token without a refetch. The
 *  token lives ONLY in this in-memory store — never in localStorage. */
async function rotateToken(
  client: DaemonClient,
  id: string,
): Promise<{ ok: true; token: string } | { ok: false; status: number; error?: string }> {
  const res = await client.teamRotateToken(id);
  if (!res.ok) {
    log.warn('teamStore.rotateToken failed', { id, status: res.status });
    return { ok: false, status: res.status, error: res.body };
  }
  if (state.details[id]) setState('details', id, 'token', res.data.token);
  return { ok: true, token: res.data.token };
}

async function remove(
  client: DaemonClient,
  id: string,
): Promise<{ ok: true } | { ok: false; status: number; error?: string }> {
  const res = await client.teamDelete(id);
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.body };
  }
  setState('list', (prev) => prev.filter((m) => m.id !== id));
  setState('details', id, undefined as unknown as TeamMemberDetail);
  return { ok: true };
}

// ── WS ──────────────────────────────────────────────────────────────

/** Handle a `team.*` WS event. Any of created/updated/deleted just
 *  re-hydrates the list (the payload is only { id, ts }). Cheap: the
 *  roster is small and this endpoint is anonymous. */
function onTeamEvent(client: DaemonClient, ev: DaemonEvent): void {
  const t = ev.type;
  // TEG-3 — external request lifecycle { member, request_id, ts }.
  // External convs are ordinary instances (counts move via conv.*);
  // here we only flash a short-lived activity pulse on the card.
  if (t === 'team.request.created' || t === 'team.request.done' || t === 'team.request.error') {
    const member = typeof ev.member === 'string' ? ev.member : null;
    if (!member) return;
    const stamp = Date.now();
    setState('requestPulse', member, stamp);
    setTimeout(() => {
      if (state.requestPulse[member] === stamp) {
        setState('requestPulse', member, undefined as unknown as number);
      }
    }, 4000);
    return;
  }
  if (t === 'team.created' || t === 'team.updated' || t === 'team.deleted') {
    const id = typeof ev.id === 'string' ? ev.id : null;
    if (t === 'team.deleted' && id) {
      setState('list', (prev) => prev.filter((m) => m.id !== id));
      setState('details', id, undefined as unknown as TeamMemberDetail);
    }
    void hydrate(client);
    // Drop any stale cached body for an updated member so the editor
    // re-fetches the fresh prompt next time it opens.
    if (t === 'team.updated' && id && state.details[id]) {
      void detail(client, id, /*force*/ true);
    }
  }
}

export const teamStore = {
  state,
  bindCluster,
  hydrate,
  detail,
  get,
  developer,
  pickable,
  create,
  update,
  remove,
  rotateToken,
  onTeamEvent,
};

log.debug('state/team loaded');
