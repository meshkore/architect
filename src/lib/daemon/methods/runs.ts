/**
 * methods/runs.ts — py-1.10.0 story-run coordinator. Last link of the
 * method chain; `DaemonClient` extends this.
 */

import { TeamMethods } from './team';
import type { Result } from '../result';
import type { RunRecord, RunStartBody, RunsList } from '../types/runs';

type RunResult = Result<{ ok: boolean; run: RunRecord }>;

export class RunsMethods extends TeamMethods {
  async runsList(activeOnly = false, signal?: AbortSignal): Promise<Result<RunsList>> {
    return this.request<RunsList>('GET', `/runs${activeOnly ? '?active=1' : ''}`, undefined, signal);
  }

  async runStart(body: RunStartBody, signal?: AbortSignal): Promise<RunResult> {
    return this.request<{ ok: boolean; run: RunRecord }>('POST', '/runs', body, signal);
  }

  async runCancel(id: string, signal?: AbortSignal): Promise<RunResult> {
    return this.request<{ ok: boolean; run: RunRecord }>(
      'POST', `/runs/${encodeURIComponent(id)}/cancel`, {}, signal,
    );
  }

  async runAdvance(id: string, cursor: number, streamId?: string, signal?: AbortSignal): Promise<RunResult> {
    const body: Record<string, unknown> = { cursor };
    if (streamId) body.stream_id = streamId;
    return this.request<{ ok: boolean; run: RunRecord }>(
      'POST', `/runs/${encodeURIComponent(id)}/advance`, body, signal,
    );
  }

  async runFinish(id: string, status: 'done' | 'failed', error?: string, signal?: AbortSignal): Promise<RunResult> {
    const body: Record<string, unknown> = { status };
    if (error) body.error = error;
    return this.request<{ ok: boolean; run: RunRecord }>(
      'POST', `/runs/${encodeURIComponent(id)}/finish`, body, signal,
    );
  }

  async runSetStream(id: string, streamId: string, signal?: AbortSignal): Promise<RunResult> {
    return this.request<{ ok: boolean; run: RunRecord }>(
      'POST', `/runs/${encodeURIComponent(id)}/stream`, { stream_id: streamId }, signal,
    );
  }
}
