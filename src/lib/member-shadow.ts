/**
 * member-shadow.ts — ATM14. A conv bound to a roster member still sends its
 * own model/effort on every dispatch when the operator once retuned them in
 * the chat header (anything but 'auto' / 'default'). The daemon's
 * "overrides win on any turn" rule (`teamsvc._member_dispatch_prep`) then
 * shadows the member file forever: editing the member's engine changes
 * nothing for that conv. client/provider are NOT shadowed — the cockpit
 * never sends them (`dispatch.ts` builds no `client`/`provider` fields),
 * so the member file wins for those on the next idle turn.
 */

export interface ShadowConvMeta {
  member?: string;
  model?: string;
  effort?: string;
}

/** True when the conv carries its own engine override that beats the member
 *  file on every dispatch. 'auto' / 'default' / empty mean "follow the member". */
export function isPinnedOverride(model?: string, effort?: string): boolean {
  return (
    (model !== undefined && model !== '' && model !== 'auto') ||
    (effort !== undefined && effort !== '' && effort !== 'default')
  );
}

/** Bound, non-archived convs whose pinned model/effort shadow `memberId`'s
 *  engine settings. Sorted for stable rendering. */
export function findShadowedConvs(
  convMeta: Record<string, ShadowConvMeta>,
  archivedConvs: Record<string, true>,
  memberId: string,
): string[] {
  return Object.entries(convMeta)
    .filter(
      ([conv, meta]) =>
        meta?.member === memberId &&
        !archivedConvs[conv] &&
        isPinnedOverride(meta.model, meta.effort),
    )
    .map(([conv]) => conv)
    .sort();
}
