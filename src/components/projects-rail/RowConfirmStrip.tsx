/**
 * RowConfirmStrip — V83 inline second-row delete confirmation.
 *
 * Renders below the project name in `.proj-row-wrap` (which is
 * `flex-direction: column`). Cancel / Remove buttons are
 * right-aligned and the strip swallows mouse + click events so the
 * underlying row doesn't navigate.
 */

export interface RowConfirmStripProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export default function RowConfirmStrip(props: RowConfirmStripProps) {
  return (
    <div
      class="proj-row-confirm"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span class="proj-row-confirm-msg">Remove from rail?</span>
      <button
        type="button"
        class="proj-row-confirm-btn"
        onClick={(e) => { e.stopPropagation(); props.onCancel(); }}
      >Cancel</button>
      <button
        type="button"
        class="proj-row-confirm-btn is-danger"
        onClick={(e) => { e.stopPropagation(); props.onConfirm(); }}
      >Remove</button>
    </div>
  );
}
