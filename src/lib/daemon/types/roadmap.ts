/**
 * types/roadmap.ts — the knowledge + plan surface: context tree, unified
 * knowledge tree, initiatives/tasks, module links, workflows (protocols)
 * and the daily narrative log index.
 */

// V107.34 — Standard v14 project context tree, served by the daemon's
// /context endpoint (py-1.12.10+).
export interface ContextNode {
  kind: 'file' | 'dir';
  name: string;
  path: string;
  title: string;
  updated?: string;
  status?: string;
  words?: number;
  over_cap?: boolean;
  children?: ContextNode[];
}
export interface ContextTreeResponse {
  exists: boolean;
  root: string;
  total_words: number;
  token_estimate: number;
  budget_tokens: number;
  over_budget: boolean;
  warnings: string[];
  tree: ContextNode[];
}

// knowledge-tree-unified KT3 — the unified knowledge tree, served by the
// daemon's /knowledge endpoint (py-1.24.0+). A conceptual overlay over
// context/+docs/+modules/ defined in context/_index.yaml. Each node is a
// CONCEPT (never a filename); load policy decides what the agent gets at
// spawn (pinned = full body, skeleton = map line only, on-demand = fetched).
export type KnowledgeLoad = 'pinned' | 'skeleton' | 'on-demand';
export interface KnowledgeNode {
  id: string;
  title: string;
  desc: string;
  load: KnowledgeLoad;
  words: number;
  has_body: boolean;
  src?: string;
  updated?: string;
  feeds?: string;
  children: KnowledgeNode[];
}
export interface KnowledgeTreeResponse {
  exists: boolean;
  root: string;
  version?: number;
  spawn_tokens: number;
  skeleton_tokens?: number;
  pinned_tokens?: number;
  budget_tokens: number;
  over_budget: boolean;
  warnings: string[];
  tree: KnowledgeNode[];
}
export interface KnowledgeNodeBody {
  id: string;
  title: string;
  desc: string;
  has_body: boolean;
  body?: string | null;
  src?: string;
  error?: string;
}

export interface InitiativeActivityCommit {
  repo?: string;
  sha: string;
  short_sha: string;
  ts: string;
  author: string;
  subject: string;
  files: string[];
  files_truncated?: boolean;
}
export interface InitiativeActivity {
  initiative_id: string;
  commits: InitiativeActivityCommit[];
  generated_at: string;
  error?: string;
}

/** py-1.28.3 — live-task overlay row from GET /roadmap/live. */
export interface LiveTaskEntry {
  conv: string;
  task_id: string;
  initiative_id: string | null;
  agent_id: string | null;
}
export interface LiveTasksResponse {
  tasks: LiveTaskEntry[];
  ts: string;
}

export interface TaskCreateBody {
  id?: string;
  title: string;
  module?: string;
  status?: string;
  initiative?: string;
  body?: string;
  [k: string]: unknown;
}

export interface LinksLocal {
  url?: string;
  command?: string;
  health?: string;
}
export interface LinksProd {
  url?: string;
  provider?: string;
  project?: string;
  region?: string;
  deploy_command?: string;
  deployed_version?: string;
  deployed_sha?: string;
  deployed_at?: string;
  deployed_by?: string;
}
export interface LinksRepo {
  branch?: string;
  head_sha?: string;
}
export interface LinksModule {
  id: string;
  local?: LinksLocal;
  prod?: LinksProd;
  repo?: LinksRepo;
}
export interface LinksRegistry {
  version?: number;
  modules: LinksModule[];
}

export interface ProtocolSummary {
  id: string;
  title: string;
  scope?: string;
  status?: string;
  priority?: string;
  owner?: string;
  updated?: string;
  tags?: string[];
  file?: string;
  log_count?: number;
}
export interface ProtocolListResponse {
  protocols: ProtocolSummary[];
}
export interface ProtocolDetail {
  id: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  file?: string;
}

export interface LogEntry {
  name: string;
  date: string | null;
  size: number | null;
  mtime: string | null;
}
export interface LogListResponse {
  entries: LogEntry[];
}
