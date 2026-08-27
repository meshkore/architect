/**
 * QueueBar — the execution wall's control strip: progress, run/stop, reset.
 *
 * Run and Stop are mutually exclusive on purpose. While the architect is
 * working the bar shows a "Running…" pill plus Stop, never an enabled
 * play: the chat's STOP button and this bar read the SAME truth
 * (`isArchitectWorking()` from state/live-selectors), because they used
 * to disagree — the chat showed a run in progress while this bar still
 * offered "▶ Run queue".
 */

import { Show } from 'solid-js';
import type { ServerInitiative } from '~/state/server';
import { isArchitectWorking } from '~/state/live-selectors';
import { stopArchitect } from '~/lib/architect-dispatch';
import { clearQueue } from '~/lib/queue';
import { ConfirmButtons } from '~/components/ui/ConfirmButtons';

export function QueueBar(props: {
  queued: ServerInitiative[];
  progress: { done: number; total: number; pct: number };
  onRun: () => void;
}) {
  const empty = (): boolean => props.queued.length === 0;

  return (
    <div class="rt-queuebar">
      <div
        class="rt-qbar-progress"
        title={`${props.progress.done}/${props.progress.total} tasks completed`}
      >
        <span class="rt-qbar-fill" style={{ width: `${props.progress.pct}%` }} />
      </div>
      <span class="rt-qbar-stat">
        {props.progress.done}/{props.progress.total} tasks · {props.queued.length} queued
      </span>
      <div class="ml-auto flex items-center gap-2 flex-shrink-0">
        <Show
          when={!isArchitectWorking()}
          fallback={
            <span class="rt-qbtn rt-qbtn-running" title="The queue is running — the Roadmap Architect is working">
              <span class="rt-qbar-spinner" aria-hidden="true" /> Running…
            </span>
          }
        >
          <button
            type="button"
            onClick={() => props.onRun()}
            disabled={empty()}
            class="rt-qbtn rt-qbtn-run"
            title="Run the queued stories, in order"
          >
            ▶ Run queue
          </button>
        </Show>
        <Show when={isArchitectWorking()}>
          <button
            type="button"
            onClick={() => { void stopArchitect(); }}
            class="rt-qbtn rt-qbtn-stop"
            title="Stop the current run"
          >
            ⏹ Stop
          </button>
        </Show>
        <ConfirmButtons
          question="Clear the queue?"
          onConfirm={clearQueue}
          questionClass="rt-qbar-stat"
          confirmClass="rt-qbtn rt-qbtn-stop"
          cancelClass="rt-qbtn rt-qbtn-clear"
          trigger={(arm) => (
            <button
              type="button"
              onClick={arm}
              disabled={empty()}
              class="rt-qbtn rt-qbtn-clear"
              title="Clear the queue (asks for confirmation; doesn't affect what's already running)"
            >
              Reset
            </button>
          )}
        />
      </div>
    </div>
  );
}

export default QueueBar;
