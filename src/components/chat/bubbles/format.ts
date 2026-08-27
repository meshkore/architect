/** Bubble timestamps: HH:MM for today, `12 Aug · 14:03` otherwise. */
export function formatBubbleTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const hhmm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return hhmm;
    const dm = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
    return `${dm} · ${hhmm}`;
  } catch {
    return ts;
  }
}
