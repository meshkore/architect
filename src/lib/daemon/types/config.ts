/**
 * types/config.ts — machine-level configuration surfaces: credentials,
 * cron, the remote-control token, and the AI-provider config.
 */

// py-1.11.3 — Credentials CRUD wire shapes. Listing returns names +
// metadata only (never values). credentialRead returns the value with
// `protected: true` for daemon-managed entries (portal-token).
export interface CredentialListEntry {
  name: string;
  size: number | null;
  is_symlink: boolean;
  protected: boolean;
}
export type CredentialsListResponse = CredentialListEntry[];

export interface CredentialReadResponse {
  name: string;
  value: string;
  protected: boolean;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  cmd: string;
  cwd?: string | null;
  env?: Record<string, string>;
  enabled: boolean;
  max_runtime_sec: number;
  restart_policy: 'never' | 'on-failure' | 'always';
  retention_runs: number;
  destructive: boolean;
  next_run: string;
  running: boolean;
}

export interface CronListResponse {
  jobs: CronJob[];
  coordinator: boolean;
  owner: string | null;
  identity: string;
  tick_sec: number;
}

export interface CronTriggerResponse {
  id: string;
  started_at: string;
  pid: number;
  log_path: string;
  status: string;
}

// ─── master-copilot (CPL-2/CPL-4) — remote-control token ────────────
//
// Machine-level (one per daemon) operator credential. GET returns the
// live token; after a DELETE the daemon 404s with minted:false.
export interface RemoteTokenResponse {
  /** The bearer value. Present on 200 (minted / just-rotated). */
  token?: string;
  /** true when a token exists; false in the 404 "absent" body. */
  minted?: boolean;
  /** ISO timestamp, only on the rotate response. */
  rotated_at?: string;
  /** e.g. "remote_token_absent" in the 404 body. */
  error?: string;
}

// ─── multi-provider-agents (MPV1 + follow-up) — machine-global AI-provider
// credential config ─────────────────────────────────────────────────────
//
// GET/POST /config/providers (portal-gated). Machine-level (one per
// daemon) — shown in the General settings drawer, not per-project. ONE
// unified list covers every daemon-managed AI credential: claude-code's
// own providers (Anthropic — no key; ZAI — key + swappable endpoint) PLUS
// the other CLIENTS that authenticate via a single stored key (Codex,
// Gemini — `hasEndpoint: false`, no base-url/small-model). API key VALUES
// are NEVER in these payloads — only a `keyPresent` boolean; the key is
// written via the POST `key` field and stored server-side (chmod 0600).
export interface ProviderConfigInfo {
  id: string;
  label: string;
  requiresKey: boolean;
  /** true only for claude-code providers that swap an Anthropic-compatible
   *  endpoint (today: ZAI) — gates whether the cockpit shows the base-url /
   *  small-model inputs. Codex/Gemini are false: they only ever talk to
   *  their own vendor's API. */
  hasEndpoint: boolean;
  enabled: boolean;
  baseUrl: string;
  smallFastModel: string;
  keyPresent: boolean;
  available: boolean;
  models: { id: string; label: string }[];
}
export interface ProvidersConfigResponse {
  providers: ProviderConfigInfo[];
}
/** Partial patch for POST /config/providers. `key` sets/replaces the API
 *  key; `clear_key: true` deletes it. `base_url`/`small_fast_model` are
 *  accepted but ignored for entries where `hasEndpoint` is false. Unknown
 *  ids are ignored server-side. */
export interface ProvidersConfigPatch {
  providers?: Record<
    string,
    {
      enabled?: boolean;
      base_url?: string;
      small_fast_model?: string;
      key?: string;
      clear_key?: boolean;
    }
  >;
}
