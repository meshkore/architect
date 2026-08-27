/**
 * enhance-code-blocks.ts — inject a "copy" button into every `<pre>` of a
 * rendered-markdown container.
 *
 * The bubble body is set via `innerHTML` (marked output), so Solid can't
 * own these buttons: we walk the DOM after each render and attach a
 * native button. Idempotent — a `data-copy-enhanced` marker prevents
 * double-injection across re-renders.
 *
 * Styling lives in `styles/cockpit.css` under `.chat-copy-btn`.
 */

const COPIED_MS = 1500;

function copyText(text: string, onDone: () => void): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onDone).catch(() => { /* denied */ });
    return;
  }
  // Fallback for non-secure contexts, where the async API is absent.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); onDone(); } catch { /* noop */ }
  document.body.removeChild(ta);
}

export function enhanceCodeBlocks(root: HTMLElement): void {
  const pres = root.querySelectorAll('pre');
  for (let i = 0; i < pres.length; i += 1) {
    const pre = pres[i] as HTMLElement;
    if (pre.dataset.copyEnhanced === '1') continue;
    pre.dataset.copyEnhanced = '1';
    // The <pre> has to be a positioning context for the absolute button.
    if (getComputedStyle(pre).position === 'static') pre.style.position = 'relative';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-copy-btn';
    btn.textContent = 'copy';
    btn.setAttribute('aria-label', 'Copy code');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // innerText, not textContent: it is the rendered code and keeps
      // the newlines the tokeniser's spans would otherwise flatten.
      copyText(pre.innerText, () => {
        btn.textContent = 'copied';
        btn.classList.add('is-copied');
        window.setTimeout(() => {
          btn.textContent = 'copy';
          btn.classList.remove('is-copied');
        }, COPIED_MS);
      });
    });
    pre.appendChild(btn);
  }
}
