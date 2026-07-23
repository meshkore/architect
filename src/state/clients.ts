/**
 * state/clients.ts — reactive mirror of the daemon's CLI-client catalog
 * (DM-CLI-06/07, multi-cli-clients).
 *
 * The daemon owns the catalog (GET /clients, DM-CLI-06): which CLI
 * clients exist, whether each is installed/authed on the daemon's own
 * machine (probed fresh every request), and each client's current
 * model/effort options. This store is a thin, fetch-once-per-cluster
 * mirror — mirrors state/team.ts's shape, minus WS events (the catalog
 * doesn't change mid-session the way the roster does).
 *
 * Graceful degradation is the whole point: a daemon older than
 * DM-CLI-06 404s on /clients, and this store treats that exactly like
 * an empty catalog — `catalogFor()`/`options()` both fall back to the
 * hardcoded claude-code-only catalog in `lib/models.ts`, so the team
 * UI never breaks just because the daemon hasn't self-updated yet.
 */

import { createStore } from 'solid-js/store';
import { log } from '~/lib/log';
import type { ClientInfo, DaemonClient, ProviderInfo } from '~/lib/daemon-client';
import { EFFORT_CATALOG, MODEL_CATALOG } from '~/lib/models';

interface ClientsStoreState {
  list: ClientInfo[];
  hydrated: boolean;
  loading: boolean;
  error: string | null;
}

const [state, setState] = createStore<ClientsStoreState>({
  list: [],
  hydrated: false,
  loading: false,
  error: null,
});

let activeCluster: string | null = null;

function bindCluster(clusterId: string | null): void {
  if (activeCluster === clusterId) return;
  activeCluster = clusterId;
  setState({ list: [], hydrated: false, loading: false, error: null });
}

/** GET /clients → replace the catalog. Safe to call once per cluster
 *  boot; nothing currently invalidates it mid-session (no client is
 *  installed/uninstalled while the cockpit is open in practice). */
async function hydrate(client: DaemonClient): Promise<void> {
  setState('loading', true);
  const res = await client.clients();
  if (res.ok) {
    setState({ list: res.data ?? [], hydrated: true, loading: false, error: null });
  } else {
    // Old daemon (pre DM-CLI-06) or a transient failure — fall back to
    // "claude-code only" silently, not a hard error banner.
    const soft = res.status === 404 || res.status === 0;
    setState({
      list: [],
      hydrated: true,
      loading: false,
      error: soft ? null : `Failed to load clients (HTTP ${res.status})`,
    });
    if (!soft) log.warn('clientsStore.hydrate failed', { status: res.status });
  }
}

type Catalog = { models: { id: string; label: string }[]; efforts: { id: string; label: string }[] };

const DEFAULT_CATALOG: Catalog = {
  models: MODEL_CATALOG.map((m) => ({ id: m.id, label: m.label })),
  efforts: EFFORT_CATALOG.map((e) => ({ id: e.id, label: e.label })),
};

/** {models, efforts} for a client id. `claude-code` always uses the
 *  local hardcoded catalog (richer metadata, zero risk of drifting
 *  from what NewMemberDialog/ChatScopeStrip already render for the
 *  overwhelmingly common case) — every OTHER client sources from the
 *  daemon's live /clients response, falling back to the same default
 *  catalog if the daemon hasn't answered yet or doesn't know this id. */
function catalogFor(clientId: string | null | undefined): Catalog {
  const id = (clientId || 'claude-code').toLowerCase();
  if (id === 'claude-code') return DEFAULT_CATALOG;
  const hit = state.list.find((c) => c.id === id);
  return hit ? { models: hit.models, efforts: hit.efforts } : DEFAULT_CATALOG;
}

/** The selectable client list for a picker dropdown. Always leads with
 *  claude-code (present even before hydrate() resolves, or on a
 *  daemon too old to know about /clients) so the default option is
 *  never missing. */
function options(): ClientInfo[] {
  if (state.list.some((c) => c.id === 'claude-code')) return state.list;
  const fallbackClaude: ClientInfo = {
    id: 'claude-code',
    label: 'Claude Code',
    installed: true,
    authConfigured: null,
    models: DEFAULT_CATALOG.models,
    efforts: DEFAULT_CATALOG.efforts,
  };
  return [fallbackClaude, ...state.list];
}

/** MPV1 (multi-provider-agents) — the provider list for a client's
 *  Provider dropdown. Only `claude-code` has providers; other clients
 *  return []. Sourced from the daemon's GET /clients `providers` field;
 *  falls back to Anthropic-only (available) when the daemon is older than
 *  MPV1 or hasn't answered yet — so the dropdown is never empty and ZAI is
 *  simply hidden until a capable daemon reports it. */
function providersFor(clientId: string | null | undefined): ProviderInfo[] {
  const id = (clientId || 'claude-code').toLowerCase();
  if (id !== 'claude-code') return [];
  const hit = state.list.find((c) => c.id === 'claude-code');
  if (hit?.providers && hit.providers.length) return hit.providers;
  return [{ id: 'anthropic', label: 'Anthropic', requiresKey: false, available: true }];
}

export const clientsStore = {
  state,
  bindCluster,
  hydrate,
  catalogFor,
  options,
  providersFor,
};

log.debug('state/clients loaded');
