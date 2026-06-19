/**
 * state/nav.ts — cross-component cockpit navigation signal.
 *
 * The Architect zone has 4 sub-tabs (V80 parity): roadmap / tasks /
 * context / diagrams. The chat panel is the PERMANENT right column,
 * always visible regardless of sub-tab — `goToConv` just activates
 * the conv; the chat panel is already on screen.
 */

import { createSignal } from 'solid-js';
import { chatStore } from '~/state/chat';

// 2026-06-19: Tasks parked; Protocols moved into the Roadmap column.
export type CockpitTab = 'roadmap' | 'context' | 'diagrams' | 'protocols';

const [cockpitTab, setCockpitTab] = createSignal<CockpitTab>('roadmap');

/** Activate the given conv in the (always-visible) chat panel. */
function goToConv(conv: string): void {
  chatStore.seedOnboardingConv();
  chatStore.setActiveConv(conv);
}

export const nav = {
  cockpitTab,
  setCockpitTab,
  goToConv,
};
