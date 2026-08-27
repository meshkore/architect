/**
 * format-time.ts — the cockpit's timestamp vocabulary.
 *
 * AX11 (cockpit-excellence). Every panel sliced ISO strings by hand
 * (`iso.slice(11, 16)`), which silently produced garbage for anything
 * that was not a 20-char UTC ISO string. These helpers validate the
 * shape first and return '' rather than a half-timestamp.
 *
 * Deliberately string-based, not Date-based: the daemon emits UTC ISO
 * and the operator reads the daemon's clock, so converting to local
 * time would make cockpit stamps disagree with the daemon logs they
 * are being compared against.
 */

const ISO_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;

/** `HH:MM` — '' when `iso` is not a parseable timestamp. */
export function hhmm(iso: string | null | undefined): string {
  const m = ISO_RE.exec(String(iso ?? ''));
  return m ? m[2]! : '';
}

/** `YYYY-MM-DD` — '' when `iso` is not a parseable timestamp. */
export function dateStamp(iso: string | null | undefined): string {
  const m = ISO_RE.exec(String(iso ?? ''));
  return m ? m[1]! : '';
}

/** `YYYY-MM-DD HH:MM` — '' when `iso` is not a parseable timestamp. */
export function fullStamp(iso: string | null | undefined): string {
  const m = ISO_RE.exec(String(iso ?? ''));
  return m ? `${m[1]} ${m[2]}` : '';
}

/**
 * The stamp a human wants at a glance: `HH:MM` for today, the full
 * `YYYY-MM-DD HH:MM` for anything older, '' for unparseable input.
 * `today` is injectable so this stays a pure function under test.
 */
export function smartTs(iso: string | null | undefined, today = dateStamp(new Date().toISOString())): string {
  const m = ISO_RE.exec(String(iso ?? ''));
  if (!m) return '';
  return m[1] === today ? m[2]! : `${m[1]} ${m[2]}`;
}
