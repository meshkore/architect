/**
 * types/runs.ts — py-1.10.0 RunStore: the story-run coordinator that
 * drives an initiative's task list through one conv, step by step.
 */

export type RunStatus = 'running' | 'stopping' | 'cancelled' | 'done' | 'failed';

export interface RunRecord {
  id: string;
  initiative_id: string;
  initiative_title: string;
  conv: string;
  agent_id: string;
  agent_title: string;
  task_ids: string[];
  cursor: number;
  status: RunStatus;
  started_at: string;
  last_step_at: string;
  ended_at: string | null;
  stream_id: string | null;
  error: string | null;
  /** Derived server-side: is there a live chat session for the conv right
   *  now? `false` while between steps OR after the daemon restarts. */
  live: boolean;
}

export interface RunsList { runs: RunRecord[]; count: number }

export interface RunStartBody {
  initiative_id: string;
  initiative_title: string;
  conv: string;
  agent_id: string;
  agent_title: string;
  task_ids: string[];
}
