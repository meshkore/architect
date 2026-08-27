/**
 * methods/system.ts — daemon-level and machine-level endpoints: health,
 * lifecycle, the project registry (DC-5 / AX8), the admission queue and
 * the per-type agent surfaces.
 *
 * First link of the method chain: `DaemonCore` → system → config →
 * roadmap → chat → team → runs → `DaemonClient`. The chain exists so
 * each domain lives in its own file while `DaemonClient` keeps ONE flat
 * method namespace — callers write `client.health()` / `client.team()`
 * exactly as before AX16. (A generic mixin factory would express this
 * more symmetrically but TS2545 forbids `extends` on a type parameter
 * whose constructor isn't `(...args: any[])`, and `any` is a lint
 * warning here.)
 */

import { DaemonCore } from '../core';
import type { Result } from '../result';
import type {
  HealthResponse,
  InfoResponse,
  ProjectRegisterResponse,
  SelfUpdateResponse,
  StorageUsageResponse,
} from '../types/system';
import type { ClientInfo } from '../types/team';

export class SystemMethods extends DaemonCore {
  async health(signal?: AbortSignal): Promise<Result<HealthResponse>> {
    return this.request<HealthResponse>('GET', '/health', undefined, signal, /*requireAuth*/ false);
  }

  async state(signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('GET', '/state', undefined, signal);
  }

  async stateSubset(name: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('GET', `/state/${encodeURIComponent(name)}`, undefined, signal);
  }

  /** Standard v22 — `GET /storage/usage`. Returns the per-bucket
   *  disk-usage breakdown of `.meshkore/`. Cached by the daemon
   *  (`cache_ttl_secs`, default 5) so polling is cheap. */
  async storageUsage(signal?: AbortSignal): Promise<Result<StorageUsageResponse>> {
    return this.request<StorageUsageResponse>('GET', '/storage/usage', undefined, signal, /*requireAuth*/ false);
  }

  async info(signal?: AbortSignal): Promise<Result<InfoResponse>> {
    return this.request<InfoResponse>('GET', '/info', undefined, signal);
  }

  async agents(signal?: AbortSignal): Promise<Result<unknown[]>> {
    return this.request<unknown[]>('GET', '/agents', undefined, signal);
  }

  async agentsCreate(body: Record<string, unknown>, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/agents', body, signal);
  }

  /** AX11 — per-type agent memory (`.meshkore/agents/_types/<t>/memory.md`).
   *  404 means "no memory yet", which is not an error for the viewer. */
  async roleMemory(type: string, signal?: AbortSignal): Promise<Result<{ content?: string }>> {
    return this.request<{ content?: string }>(
      'GET', `/agents/types/${encodeURIComponent(type)}/memory`, undefined, signal,
    );
  }

  /** DM-CLI-06 (multi-cli-clients) — GET /clients. 404 on a daemon
   *  older than this feature; callers (state/clients.ts) treat that as
   *  "fall back to the claude-code-only default", not a hard error. */
  async clients(signal?: AbortSignal): Promise<Result<ClientInfo[]>> {
    return this.request<ClientInfo[]>('GET', '/clients', undefined, signal);
  }

  /** DC-5 (daemon-centralized) — POST /projects. Register/adopt an existing
   *  folder (`{ path }`) or create-from-scratch under an allowlisted parent
   *  (`{ parent, name }`); the daemon scaffolds `.meshkore/` if absent and
   *  returns the new `{ id, name, path, scaffolded }`. GLOBAL endpoint (no
   *  project header); portal-token gated. */
  async projectRegister(
    body: { path: string; name?: string } | { parent: string; name: string },
    signal?: AbortSignal,
  ): Promise<Result<ProjectRegisterResponse>> {
    return this.request<ProjectRegisterResponse>('POST', '/projects', body, signal);
  }

  /** AX8 (cockpit-excellence) — DELETE /projects/<id>. Drops the project
   *  from the daemon's registry so a forgotten row stays forgotten; without
   *  it the cockpit's local scrub is undone by the next discovery pass.
   *  GLOBAL endpoint (no project header), portal-token gated. */
  async projectDelete(id: string, signal?: AbortSignal): Promise<Result<{ ok: boolean; id: string; deleted: boolean }>> {
    return this.request<{ ok: boolean; id: string; deleted: boolean }>(
      'DELETE', `/projects/${encodeURIComponent(id)}`, undefined, signal,
    );
  }

  /** AX11 — quota unpause. The rate-limit banner used to raw-fetch this,
   *  which skipped the 401 self-heal and the version fan-out. `path` is the
   *  daemon-supplied unpause path from the quota block. */
  async quotaUnpause(path: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', path, {}, signal);
  }

  /** AX11 — admission queue (public-clusters). 501 means the daemon predates
   *  the admission flow; callers surface that as a stub, not a failure. */
  async admissionList(signal?: AbortSignal): Promise<Result<{ pending?: unknown[] }>> {
    return this.request<{ pending?: unknown[] }>('GET', '/admission/list', undefined, signal);
  }

  async admissionDecide(
    action: 'approve' | 'reject',
    id: string,
    signal?: AbortSignal,
  ): Promise<Result<unknown>> {
    return this.request<unknown>(
      'POST', `/admission/${action}/${encodeURIComponent(id)}`, {}, signal,
    );
  }

  /** AX11 — start a platform OAuth/device flow for a runner credential. */
  async authStart(platform: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>(
      'POST', `/auth/${encodeURIComponent(platform)}/start`, {}, signal,
    );
  }

  async reload(signal?: AbortSignal): Promise<Result<{ ok: boolean; generated_at: string }>> {
    return this.request<{ ok: boolean; generated_at: string }>('POST', '/reload', {}, signal);
  }

  async shutdown(signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/shutdown', {}, signal);
  }

  async selfUpdate(body: { url?: string } = {}, signal?: AbortSignal): Promise<Result<SelfUpdateResponse>> {
    return this.request<SelfUpdateResponse>('POST', '/self-update', body, signal);
  }

  async versionNext(
    body: { key: string; bump?: 'major' | 'minor' | 'patch' },
    signal?: AbortSignal,
  ): Promise<Result<{ version: string }>> {
    return this.request<{ version: string }>('POST', '/version/next', body, signal);
  }
}
