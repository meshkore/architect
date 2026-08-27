/**
 * methods/config.ts — credentials, cron, and the two machine-level
 * config surfaces (remote-control token, AI providers).
 */

import { SystemMethods } from './system';
import type { Result } from '../result';
import type {
  CredentialReadResponse,
  CredentialsListResponse,
  CronListResponse,
  CronTriggerResponse,
  ProvidersConfigPatch,
  ProvidersConfigResponse,
  RemoteTokenResponse,
} from '../types/config';

export class ConfigMethods extends SystemMethods {
  // ── Credentials (py-1.11.3) ───────────────────────────────────────

  async credentials(signal?: AbortSignal): Promise<Result<CredentialsListResponse>> {
    return this.request<CredentialsListResponse>('GET', '/credentials', undefined, signal);
  }

  /** py-1.11.3 — Read a single credential's value. Auth-required.
   *  Cockpit only calls this when the operator clicks "reveal" so the
   *  value never moves over the wire until explicitly requested. */
  async credentialRead(name: string, signal?: AbortSignal): Promise<Result<CredentialReadResponse>> {
    return this.request<CredentialReadResponse>(
      'GET',
      `/credentials/${encodeURIComponent(name)}`,
      undefined,
      signal,
    );
  }

  /** py-1.11.3 — Create or overwrite a credential. Protected names
   *  (portal-token) return 403 — managed by the daemon itself. */
  async credentialWrite(
    name: string,
    value: string,
    signal?: AbortSignal,
  ): Promise<Result<{ name: string; size: number }>> {
    return this.request<{ name: string; size: number }>(
      'PUT',
      `/credentials/${encodeURIComponent(name)}`,
      { value },
      signal,
    );
  }

  /** py-1.11.3 — Delete a credential file. Protected names → 403. */
  async credentialDelete(
    name: string,
    signal?: AbortSignal,
  ): Promise<Result<{ deleted: boolean; name: string }>> {
    return this.request<{ deleted: boolean; name: string }>(
      'DELETE',
      `/credentials/${encodeURIComponent(name)}`,
      undefined,
      signal,
    );
  }

  // ── Cron ──────────────────────────────────────────────────────────

  async cronList(signal?: AbortSignal): Promise<Result<CronListResponse>> {
    return this.request<CronListResponse>('GET', '/cron/list', undefined, signal);
  }

  async cronTrigger(id: string, signal?: AbortSignal): Promise<Result<CronTriggerResponse>> {
    return this.request<CronTriggerResponse>('POST', `/cron/${encodeURIComponent(id)}/trigger`, {}, signal);
  }

  async cronCancel(
    id: string,
    signal?: AbortSignal,
  ): Promise<Result<{ ok: boolean; id: string; cancelled: boolean }>> {
    return this.request<{ ok: boolean; id: string; cancelled: boolean }>(
      'POST', `/cron/${encodeURIComponent(id)}/cancel`, {}, signal,
    );
  }

  // ── master-copilot (CPL-2/CPL-4) — machine-level remote-control token ──
  //
  // ONE operator-grade credential per DAEMON (not per project). It
  // authorizes project discovery/creation + master ask/poll across ALL
  // projects (header-routed). The daemon mints it on boot; the cockpit's
  // "Remote control" block (Config → daemon section) views/rotates/revokes
  // it. All three calls are portal-authed (same transport.token as the
  // other privileged endpoints). Observed daemon contract (py-1.30.1):
  //   GET    /remote/token         → 200 {token, minted:true}
  //                                   404 {error:"remote_token_absent", minted:false} after delete
  //   POST   /remote/token/rotate  → 200 {token, rotated_at}  (mints if absent)
  //   DELETE /remote/token         → 200 {deleted:true}       (GET 401s remote calls until re-minted)

  /** GET /remote/token — current machine remote token. 404 (mapped to
   *  ok:false, status:404) means "not minted" (deleted); the block reads
   *  that as an absent state rather than an error. */
  async remoteTokenGet(signal?: AbortSignal): Promise<Result<RemoteTokenResponse>> {
    return this.request<RemoteTokenResponse>('GET', '/remote/token', undefined, signal);
  }

  /** POST /remote/token/rotate — mint a fresh remote token; the old one
   *  dies instantly. Also mints when the token was previously deleted
   *  (the block's "Mint token" path). */
  async remoteTokenRotate(signal?: AbortSignal): Promise<Result<RemoteTokenResponse>> {
    return this.request<RemoteTokenResponse>('POST', '/remote/token/rotate', {}, signal);
  }

  /** DELETE /remote/token — destroy the remote token. Remote callers 401
   *  immediately (the personal agent loses access to ALL projects) until a
   *  new one is minted via rotate. */
  async remoteTokenDelete(signal?: AbortSignal): Promise<Result<{ deleted: boolean }>> {
    return this.request<{ deleted: boolean }>('DELETE', '/remote/token', undefined, signal);
  }

  // ── multi-provider-agents (MPV1) — machine-global clients/providers cfg ──
  //
  // Portal-gated, machine-level (no project header needed). GET returns the
  // full config incl. per-provider `keyPresent` (never the key value); POST
  // applies a partial patch and returns the fresh config. A daemon older
  // than MPV1 404s on both — the Config-General block treats that as
  // "feature unavailable", not an error.

  /** GET /config/providers — enabled clients + per-provider config. */
  async providerConfigGet(signal?: AbortSignal): Promise<Result<ProvidersConfigResponse>> {
    return this.request<ProvidersConfigResponse>('GET', '/config/providers', undefined, signal);
  }

  /** POST /config/providers — set client/provider enable flags, provider
   *  base-url/small-model, and set/clear API keys. Returns the fresh config. */
  async providerConfigSet(
    body: ProvidersConfigPatch,
    signal?: AbortSignal,
  ): Promise<Result<ProvidersConfigResponse>> {
    return this.request<ProvidersConfigResponse>('POST', '/config/providers', body, signal);
  }
}
