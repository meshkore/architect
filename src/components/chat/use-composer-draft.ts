/**
 * use-composer-draft.ts — per-conv draft + attachment persistence.
 *
 * V107.31. `ChatComposer` is mounted once inside `ChatPanel` and reused
 * across conv switches (Solid does not remount on prop-only changes),
 * so a single in-place draft signal leaks text between chats. This hook
 * owns the snapshot map: it stashes the OUTGOING conv's state before
 * loading the incoming one, and saves again on unmount (a cluster swap
 * unmounts the panel).
 *
 * Session-only on purpose. Drafts of "the next message" are short-lived;
 * persisting them across a reload would risk a stale prompt landing in
 * an unrelated conversation days later.
 */

import { createEffect, createSignal, onCleanup, type Accessor, type Setter } from 'solid-js';

export interface PendingImg { dataURL: string; mediaType: string }
export interface PendingDoc { filename: string; content: string }
interface ComposerSnap { draft: string; imgs: PendingImg[]; docs: PendingDoc[] }

const composerByConv = new Map<string, ComposerSnap>();

function readSnap(conv: string): ComposerSnap {
  return composerByConv.get(conv) ?? { draft: '', imgs: [], docs: [] };
}

export interface ComposerDraft {
  draft: Accessor<string>;
  setDraft: Setter<string>;
  imgs: Accessor<PendingImg[]>;
  setImgs: Setter<PendingImg[]>;
  docs: Accessor<PendingDoc[]>;
  setDocs: Setter<PendingDoc[]>;
}

/**
 * @param conv     the conv the composer currently shows
 * @param afterSwap runs once the restored values have landed — the
 *                  composer uses it to resize its textarea
 */
export function useComposerDraft(conv: Accessor<string>, afterSwap: () => void): ComposerDraft {
  // Seed from this conv's snapshot on first mount so a returning
  // operator sees their draft immediately, not a flash of empty.
  const initial = readSnap(conv());
  const [draft, setDraft] = createSignal(initial.draft);
  const [imgs, setImgs] = createSignal<PendingImg[]>(initial.imgs);
  const [docs, setDocs] = createSignal<PendingDoc[]>(initial.docs);

  // The slug whose draft is in the signals right now. `conv()` has
  // already advanced by the time the effect below fires, so the
  // outgoing state has to be filed under this, not under `conv()`.
  let currentConv = conv();

  const stash = (): void => {
    const out: ComposerSnap = { draft: draft(), imgs: imgs(), docs: docs() };
    // Only persist non-empty so the map stays small.
    if (out.draft || out.imgs.length || out.docs.length) composerByConv.set(currentConv, out);
    else composerByConv.delete(currentConv);
  };

  createEffect(() => {
    const next = conv();
    if (next === currentConv) return;
    stash();
    const snap = readSnap(next);
    setDraft(snap.draft);
    setImgs(snap.imgs);
    setDocs(snap.docs);
    currentConv = next;
    queueMicrotask(afterSwap);
  });

  onCleanup(stash);

  return { draft, setDraft, imgs, setImgs, docs, setDocs };
}
