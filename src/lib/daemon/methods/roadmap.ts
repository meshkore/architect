/**
 * methods/roadmap.ts — the plan + knowledge surface: initiatives, tasks,
 * the context and knowledge trees, module links, workflows (protocols),
 * the daily log, and the raw-markdown static reads.
 *
 * The three raw-text reads (`logFile`, `contextFile`, `readMarkdownFile`)
 * each build only their PATH here; the wire work is `core.requestText`.
 * Before AX16 each one hand-rolled its own `fetch` + headers and so ran
 * without the 401 self-heal, the 15s timeout and the version fan-out.
 */

import { ConfigMethods } from './config';
import { encodePathSegments, rewriteMeshkoreStaticPath } from '../core';
import type { Result, TextResult } from '../result';
import type {
  ContextTreeResponse,
  InitiativeActivity,
  KnowledgeNodeBody,
  KnowledgeTreeResponse,
  LinksRegistry,
  LiveTasksResponse,
  LogListResponse,
  ProtocolDetail,
  TaskCreateBody,
} from '../types/roadmap';

export class RoadmapMethods extends ConfigMethods {
  /** py-1.28.3 — tiny live-task overlay (which task each live subagent works on
   *  RIGHT NOW). Polled (~2.5s) so the roadmap loader is reliable even if a
   *  conv.* WS event was missed (reconnect / project switch). */
  async liveTasks(signal?: AbortSignal): Promise<Result<LiveTasksResponse>> {
    return this.request<LiveTasksResponse>('GET', '/roadmap/live', undefined, signal);
  }

  /** V86w — Per-initiative git activity. Returns commits whose
   *  subject/body mentions the initiative id, plus the files each
   *  commit touched. Multi-repo workspaces walk depth-1
   *  sub-repos and combine results. */
  async initiativeActivity(id: string, signal?: AbortSignal): Promise<Result<InitiativeActivity>> {
    return this.request<InitiativeActivity>(
      'GET', `/initiative/${encodeURIComponent(id)}/activity`, undefined, signal,
    );
  }

  /** Move an initiative to a wall at a given position. The daemon writes
   *  `status: <wall>` + `wall_order` to the .md (walls.py), recompacts the
   *  wall, and broadcasts `initiative.reordered`. The Queue wall (py-1.22+)
   *  uses this as the shared, disk-persisted staging primitive: stage =
   *  move to `next`; unstage = move to `active`. A CLI agent reading the
   *  standard sees the same `status: next` + `wall_order` order. */
  async initiativeReorder(
    id: string,
    wall: 'active' | 'next' | 'backlog' | 'archived',
    order: number,
    signal?: AbortSignal,
  ): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/initiative/reorder', { id, wall, order }, signal);
  }

  async tasksCreate(body: TaskCreateBody, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/tasks', body, signal);
  }

  async taskTransition(id: string, status: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', `/tasks/${encodeURIComponent(id)}/transition`, { status }, signal);
  }

  async taskCancel(id: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', `/tasks/${encodeURIComponent(id)}/cancel`, {}, signal);
  }

  async protocols(signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('GET', '/protocols', undefined, signal);
  }

  /** V86j — Single protocol body + frontmatter. The daemon serves
   *  it at `/protocols/<id>` (id is the P<N> slug). */
  async protocolDetail(id: string, signal?: AbortSignal): Promise<Result<ProtocolDetail>> {
    return this.request<ProtocolDetail>('GET', `/protocols/${encodeURIComponent(id)}`, undefined, signal);
  }

  async links(signal?: AbortSignal): Promise<Result<LinksRegistry>> {
    return this.request<LinksRegistry>('GET', '/links', undefined, signal);
  }

  /** V107.34 — Standard v14 project context. GET /context returns
   *  the .meshkore/context/ tree (folders + files with parsed
   *  frontmatter + word counts + budget warnings). GET /context/<path>
   *  serves the raw markdown body of a single file. Cockpit's
   *  Context tab consumes both. Daemon must be at py-1.12.10+. */
  async contextTree(signal?: AbortSignal): Promise<Result<ContextTreeResponse>> {
    return this.request<ContextTreeResponse>('GET', '/context', undefined, signal);
  }

  /** knowledge-tree-unified KT3 — the unified knowledge tree. GET
   *  /knowledge returns the manifest-driven concept tree (overlay over
   *  context/+docs/+modules/; per-node load policy + spawn-token budget).
   *  GET /knowledge/<id> serves a single node's processed body, lazily.
   *  Daemon must be at py-1.24.0+. */
  async knowledgeTree(signal?: AbortSignal): Promise<Result<KnowledgeTreeResponse>> {
    return this.request<KnowledgeTreeResponse>('GET', '/knowledge', undefined, signal);
  }

  async knowledgeNode(id: string, signal?: AbortSignal): Promise<Result<KnowledgeNodeBody>> {
    return this.request<KnowledgeNodeBody>('GET', '/knowledge/' + encodeURIComponent(id), undefined, signal);
  }

  /** py-1.9.0 — daily narrative log index. Returns descending-by-date
   *  metadata for every `.meshkore/log/<date>.md` file. The Diary tab
   *  uses this to drive its scroll-paged viewer. */
  async logList(signal?: AbortSignal): Promise<Result<LogListResponse>> {
    return this.request<LogListResponse>('GET', '/log', undefined, signal);
  }

  // ── Raw-text reads ────────────────────────────────────────────────

  /** py-1.9.0 — ONE day-log body as raw markdown; the cockpit renders. */
  async logFile(name: string, signal?: AbortSignal): Promise<TextResult> {
    return this.requestText('/log/' + encodeURIComponent(name), signal);
  }

  /** One `.meshkore/context/` file body. A 404 is the normal "not
   *  written yet" answer for a node the tree lists but has no file for. */
  async contextFile(path: string, signal?: AbortSignal): Promise<TextResult> {
    const rel = path.replace(/^\/+/, '');
    return this.requestText('/context/' + encodePathSegments(rel), signal);
  }

  /** V107.22 — fetch ANY file under the cluster root as raw markdown
   *  via the daemon's static file route. `path` is the repo-relative
   *  string the daemon embeds in task / initiative records
   *  (`.meshkore/modules/<m>/tasks/<file>.md`, etc.). Used by the
   *  Roadmap UI to render rich initiative descriptions + task bodies
   *  on expand without bloating the /state payload.
   *
   *  V107.26 — Map the cluster-relative `.meshkore/<subdir>/...` path
   *  into the daemon's actual static routes. The daemon does NOT mount
   *  `.meshkore/` at root; it exposes three explicit prefixes under
   *  different names (see daemon.py do_GET, py-1.12.x):
   *
   *    `.meshkore/docs/...`     → `GET /docs/...`
   *    `.meshkore/modules/...`  → `GET /modules/...`
   *    `.meshkore/roadmap/...`  → `GET /tasks/...`   ← yes, renamed
   *    `.meshkore/log/...`      → `GET /log/<file>`
   *
   *  Pre-V107.26 every fetch hit `/.meshkore/...` directly → 404 every
   *  time. Symptom: InitiativeCard descriptions + TaskCard bodies +
   *  Diary entries all stuck on "no body" / blank on any project
   *  whose conversation history wasn't already in convMap from a live
   *  WS session (Cavioca field report 2026-06-02).
   *
   *  An SPA index.html served for an unknown route is a FAILURE here,
   *  not a body — hence the doctype sniff. It reports status 0 because
   *  the transport call itself succeeded; only the payload is wrong. */
  async readMarkdownFile(path: string, signal?: AbortSignal): Promise<TextResult> {
    // Strip a leading slash; the daemon mounts the cluster root at /
    const rel = path.replace(/^\/+/, '');
    const mapped = rewriteMeshkoreStaticPath(rel);
    const res = await this.requestText('/' + encodePathSegments(mapped), signal);
    if (!res.ok) return res;
    const head = res.body.slice(0, 200).toLowerCase();
    if (head.includes('<!doctype') || head.includes('<html')) {
      return { ok: false, status: 0, error: 'daemon returned HTML for markdown request' };
    }
    return res;
  }
}
