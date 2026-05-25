import { mcAlert } from '~/lib/modal';
import { Block, BtnRow, Btn } from './atoms';
import { ARCHITECT_TOKEN } from './yaml-shortcut';

export function TokenBlock() {
  function clearLocal() {
    try { localStorage.removeItem('mc-daemon-token'); } catch { /* quota */ }
    void mcAlert(
      `Removed the token from this browser. Reload to paste a fresh one.\n\nTo rotate the daemon token itself, delete ${ARCHITECT_TOKEN} (the daemon regenerates it on next start) then paste the new value here.`,
      { title: 'Token cleared' },
    );
  }
  return (
    <Block title="Token rotation" subtitle={`Bearer token lives in ${ARCHITECT_TOKEN}.`}>
      <p class="text-[12px] text-gray-500 leading-relaxed mb-3">
        Rotating is two-step: delete the file on disk (the daemon regenerates it on next start), then paste the new value into the connection gate. The button below only clears the value the browser has cached.
      </p>
      <BtnRow><Btn onClick={clearLocal}>clear stored token</Btn></BtnRow>
    </Block>
  );
}
