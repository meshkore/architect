/**
 * SectionSaveButton — the per-section Save in a save-by-section editor.
 *
 * AX17 (cockpit-excellence). MemberDetailPanel PATCHes one section at a
 * time and had this exact button copy-pasted four times; the busy label
 * and the disabled state have to agree with `savingSection` in all four
 * or the operator can double-submit a section that is already in
 * flight.
 */

export function SectionSaveButton(props: {
  onClick: () => void;
  saving: boolean;
  label?: string;
  busyLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onClick()}
      disabled={props.saving}
      class="text-[11px] font-mono uppercase tracking-wider text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 hover:border-emerald-500/60 rounded px-2 py-1 disabled:opacity-50 transition-colors"
    >
      {props.saving ? (props.busyLabel ?? 'Saving…') : (props.label ?? 'Save')}
    </button>
  );
}

export default SectionSaveButton;
