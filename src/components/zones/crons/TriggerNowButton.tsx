/**
 * TriggerNowButton — confirm-then-fire a manual cron run.
 *
 * Confirmation routes through the M6.1 modal harness (`mcConfirm`). A
 * `destructive: true` job gets the red-button variant so the operator
 * sees the danger.
 */

import { Show } from 'solid-js';
import { mcConfirm } from '~/lib/modal';

export default function TriggerNowButton(props: {
  jobId: string;
  jobName: string;
  destructive: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onTrigger: () => Promise<void>;
}) {
  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    if (props.disabled) return;
    const ok = await mcConfirm(
      props.destructive
        ? `Trigger "${props.jobName}" now? This job is flagged destructive — make sure you mean it.`
        : `Trigger "${props.jobName}" now? Scheduled runs are unaffected.`,
      {
        title: 'Trigger cron',
        okLabel: 'Trigger',
        cancelLabel: 'Cancel',
        danger: props.destructive,
      },
    );
    if (!ok) return;
    await props.onTrigger();
  };

  return (
    <Show
      when={!props.disabled}
      fallback={
        <button
          type="button"
          disabled
          title={props.disabledReason ?? 'Disabled'}
          class="px-2 py-1 rounded-md text-[10px] font-medium bg-gray-800/40 border border-gray-800 text-gray-600 cursor-not-allowed"
        >
          Trigger now
        </button>
      }
    >
      <button
        type="button"
        onClick={handleClick}
        class="px-2 py-1 rounded-md text-[10px] font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
      >
        Trigger now
      </button>
    </Show>
  );
}
