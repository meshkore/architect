/**
 * types/system.ts — daemon-level wire shapes: health/info, storage, the
 * project registry, self-update, and the generic event envelope.
 */

/** Standard v22 `GET /storage/usage` response. */
export interface StorageBucket {
  name: string;
  bytes: number;
  files: number;
  exists: boolean;
  retention_days?: number;
}
export interface StorageUsageResponse {
  root: string;
  total_bytes: number;
  total_files: number;
  buckets: StorageBucket[];
  generated_at: string;
  cache_ttl_secs: number;
}

/** DC-5 (daemon-centralized) — POST /projects 201 body. `id` is the cluster
 *  id (stable, portable); `scaffolded` true when the daemon created a fresh
 *  `.meshkore/` for a folder that had none. */
export interface ProjectRegisterResponse {
  id: string;
  name: string;
  path: string;
  scaffolded: boolean;
}

export interface HealthResponse {
  ok: boolean;
  identity: string;
  port: number;
  mode: string;
  implementation?: string;
  version?: string;
  cluster_id?: string;
  cluster_name?: string;
  cluster_type?: string;
  device?: { hostname: string; platform: string; arch: string; os_release: string };
  features?: string[];
  /** D-TLS-01 — scheme advertised by daemon (py-1.8.0+). */
  tls?: boolean;
  /** D-TLS-01 — full URL the cockpit should target. */
  endpoint?: string;
  /** py-1.2.0 — cluster.yaml.daemon block. Drives the auto-update flow. */
  daemon?: {
    auto_update?: boolean;
    auto_update_source?: string;
  };
  ts?: string;
}

export interface InfoResponse {
  ok: boolean;
  root: string;
  cluster_id?: string;
  cluster_name?: string;
  port: number;
  pid: number;
  [k: string]: unknown;
}

/** The WS/event envelope. Every daemon broadcast and every stored chat
 *  message flattens to this. */
export interface DaemonEvent {
  type: string;
  ts?: string;
  conv?: string;
  author?: string;
  [k: string]: unknown;
}

export interface SelfUpdateResponse {
  ok: boolean;
  new_pid: number;
  new_port: number;
  shutdown_in_sec: number;
  old_backup: string;
  old_version: string;
  source_url: string;
}
