/**
 * state/nav.ts — cross-component cockpit navigation signal.
 *
 * The cockpit's top-level tab (roadmap / chat / network / config) lives
 * here so panels outside `App.tsx` can request a tab switch. The empty
 * onboarding panel uses it to drop the operator straight into the
 * Coordinator chat (M6.6 V46 flow).
 */

import { createSignal } from 'solid-js';
import { chatStore } from '~/state/chat';

export type CockpitTab = 'roadmap' | 'chat' | 'network' | 'config';

const [cockpitTab, setCockpitTab] = createSignal<CockpitTab>('roadmap');

/** Switch to the chat tab and activate the given conv. */
function goToConv(conv: string): void {
  chatStore.seedOnboardingConv();
  chatStore.setActiveConv(conv);
  setCockpitTab('chat');
}

export const nav = {
  cockpitTab,
  setCockpitTab,
  goToConv,
};
