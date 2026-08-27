/**
 * methods/team.ts — agent-team roster (ATM9 daemon contract) + TEG-3
 * external-exposure tokens.
 *
 * The py-1.29.0 daemon envelopes its team responses:
 *   GET  /team      → { members: [...], count }
 *   GET  /team/<id> → { frontmatter: {...}, body, instances, token? }
 *   POST /team, PATCH /team/<id> → { frontmatter: {...}, body }
 * The cockpit-facing types (TeamMember / TeamMemberDetail) are flat, so
 * normalise here — one chokepoint — and tolerate both the enveloped and
 * a flat shape so older/newer daemons keep working.
 */

import { ChatMethods } from './chat';
import type { Result } from '../result';
import type {
  TeamCreateBody,
  TeamDraftBody,
  TeamDraftResponse,
  TeamMember,
  TeamMemberDetail,
  TeamPatchBody,
} from '../types/team';

function normalizeTeamList(data: unknown): TeamMember[] {
  if (Array.isArray(data)) return data as TeamMember[];
  if (data && typeof data === 'object') {
    const members = (data as { members?: unknown }).members;
    if (Array.isArray(members)) return members as TeamMember[];
  }
  return [];
}

function flattenTeamMember(data: unknown): TeamMemberDetail {
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const fm = (obj.frontmatter && typeof obj.frontmatter === 'object'
    ? obj.frontmatter
    : obj) as Record<string, unknown>;
  const out = { ...fm } as unknown as TeamMemberDetail;
  if (typeof obj.body === 'string') out.body = obj.body;
  if (typeof obj.instances === 'number') out.instances = obj.instances;
  // TEG-3 — the bearer token may arrive top-level or (defensively) in
  // the frontmatter block; surface it flat either way.
  if (typeof obj.token === 'string') out.token = obj.token;
  return out;
}

export class TeamMethods extends ChatMethods {
  /** GET /team — full roster (frontmatter + live instance counts),
   *  sorted by pinned_order. Anonymous read (matches /chat/snapshot).
   *  The daemon envelopes as {members, count}; normalised to a flat
   *  array here. Tokens are NEVER present in the list. */
  async teamList(signal?: AbortSignal): Promise<Result<TeamMember[]>> {
    const res = await this.request<unknown>('GET', '/team', undefined, signal, /*requireAuth*/ false);
    if (!res.ok) return res;
    return { ...res, data: normalizeTeamList(res.data) };
  }

  /** GET /team/<id> — one member incl. its init-prompt body. Authed
   *  (TEG-3): the daemon only includes the bearer `token` of an
   *  external member on cockpit-authed reads. */
  async teamGet(id: string, signal?: AbortSignal): Promise<Result<TeamMemberDetail>> {
    const res = await this.request<unknown>('GET', `/team/${encodeURIComponent(id)}`, undefined, signal);
    if (!res.ok) return res;
    return { ...res, data: flattenTeamMember(res.data) };
  }

  /** POST /team — create a new member (always kind:'profile'). */
  async teamCreate(body: TeamCreateBody, signal?: AbortSignal): Promise<Result<TeamMember>> {
    const res = await this.request<unknown>('POST', '/team', body, signal);
    if (!res.ok) return res;
    return { ...res, data: flattenTeamMember(res.data) };
  }

  /** PATCH /team/<id> — partial update. `kind`/`required` are immutable
   *  (the daemon rejects them); send only the edited section's fields. */
  async teamUpdate(id: string, body: TeamPatchBody, signal?: AbortSignal): Promise<Result<TeamMember>> {
    const res = await this.request<unknown>('PATCH', `/team/${encodeURIComponent(id)}`, body, signal);
    if (!res.ok) return res;
    return { ...res, data: flattenTeamMember(res.data) };
  }

  /** DELETE /team/<id> — 409 when the member is required. */
  async teamDelete(id: string, signal?: AbortSignal): Promise<Result<{ deleted: boolean; id: string }>> {
    return this.request<{ deleted: boolean; id: string }>(
      'DELETE', `/team/${encodeURIComponent(id)}`, undefined, signal,
    );
  }

  /** POST /team/draft — LLM normaliser: free-text mission → structured
   *  draft the operator reviews before saving (ATM4/ATM5). */
  async teamDraft(body: TeamDraftBody, signal?: AbortSignal): Promise<Result<TeamDraftResponse>> {
    return this.request<TeamDraftResponse>('POST', '/team/draft', body, signal);
  }

  /** TEG-3 — POST /team/<id>/token/rotate. Mints a fresh bearer token
   *  for an external member; the old one stops working immediately. */
  async teamRotateToken(id: string, signal?: AbortSignal): Promise<Result<{ token: string }>> {
    return this.request<{ token: string }>(
      'POST', `/team/${encodeURIComponent(id)}/token/rotate`, {}, signal,
    );
  }
}
