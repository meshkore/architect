/**
 * state/chat/persistence.ts — the two localStorage keys the chat layer
 * still owns, and the migrations that heal them on load.
 *
 *   `mc-conv-meta-v1::<cluster_id>`  — the operator's agent roster
 *      (type, title, model, member). This is what survives a reload.
 *      The daemon pairs it with its own `conv_meta.json` sidecar
 *      (py-1.7.0) so chained turns keep their agent_type even if the
 *      cockpit forgets to re-send it.
 *   `mc-last-conv-v1::<cluster_id>`  — V107.17 sticky-last-conv, read
 *      back at boot by App.pickDefaultConv.
 *
 * py-1.11.0 Phase 2 — the `archivedConvs` cache is NOT persisted: the
 * set is authored server-side and arrives via `GET /chat/snapshot` plus
 * `conv.archived` / `conv.unarchived` events.
 */

import { log } from '~/lib/log';
import { state, setState, activeClusterId } from './store';
import { ONBOARDING_CONV_ID, agentTypeFromSlug, type ConvMeta } from './types';

const CONV_META_KEY_PREFIX = 'mc-conv-meta-v1::';
const LAST_CONV_KEY_PREFIX = 'mc-last-conv-v1::';

function metaKey(): string {
  return CONV_META_KEY_PREFIX + (activeClusterId() ?? 'unknown');
}

function lastConvKey(clusterId: string | null): string {
  return LAST_CONV_KEY_PREFIX + (clusterId ?? 'unknown');
}

export function loadLastActiveConv(clusterId: string | null): string | null {
  try {
    return localStorage.getItem(lastConvKey(clusterId));
  } catch {
    return null;
  }
}

export function saveLastActiveConv(conv: string | null): void {
  try {
    const key = lastConvKey(activeClusterId());
    if (conv) localStorage.setItem(key, conv);
    else localStorage.removeItem(key);
  } catch { /* quota — non-fatal */ }
}

/** The daemon owns the archived set; this is the seam kept so callers
 *  still read as "persist the change" at the mutation points. */
export function saveArchivedConvs(): void { /* no-op; daemon is the source */ }

function isConvMeta(v: unknown): v is ConvMeta {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.agentId === 'string' && typeof r.type === 'string';
}

export function saveConvMeta(): void {
  try {
    localStorage.setItem(metaKey(), JSON.stringify(state.convMeta));
  } catch {
    /* quota / private mode */
  }
}

export function loadConvMeta(): void {
  try {
    const raw = localStorage.getItem(metaKey());
    if (!raw) {
      setState('convMeta', {});
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const out: Record<string, ConvMeta> = {};
    let migrated = 0;
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isConvMeta(v)) continue;
      let healed = { ...v };
      let touched = false;
      // V107.8 — heal stale slug/type mismatches on load.
      const slugImplied = agentTypeFromSlug(k);
      if (slugImplied && healed.type !== slugImplied) {
        healed = { ...healed, type: slugImplied };
        touched = true;
      }
      // V107.12 — rename the onboarding master from the legacy
      // 'Coordinator' label. Only flips the default; a title the
      // operator typed themselves is preserved.
      if (k === ONBOARDING_CONV_ID && healed.title === 'Coordinator') {
        healed = { ...healed, title: 'Architect Agent' };
        touched = true;
      }
      if (touched) migrated += 1;
      out[k] = healed;
    }
    setState('convMeta', out);
    if (migrated > 0) {
      log.info('convMeta migrated stale agent_type entries', { count: migrated });
      // Persist the healed entries so later sessions skip the work.
      saveConvMeta();
    }
  } catch (e) {
    log.warn('convMeta load failed', e instanceof Error ? e.message : String(e));
  }
}
