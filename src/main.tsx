/* @refresh reload */
import { render } from 'solid-js/web';
import App from '~/App';
import './index.css';

// Visible early-life logs so we can diagnose mount problems from the browser
// console. The Solid app prints further events as connection progresses.
console.log('[architect] script loaded · version=0.2.0-alpha');

const root = document.getElementById('app');
if (!root) {
  console.error('[architect] #app mount node missing — index.html is broken');
  throw new Error('#app mount node missing');
}

try {
  // Solid Router is intentionally NOT used yet. We'll add it in Hito 2 when
  // the cockpit actually has multiple tabs/routes. For Hito 1 we want the
  // smallest possible runtime so any mount failure is easy to diagnose.
  render(() => <App />, root);
  console.log('[architect] Solid mounted into #app');
} catch (err) {
  console.error('[architect] Solid mount threw', err);
  // Fall back to a plain HTML message so the user sees SOMETHING even when
  // the framework boot fails. Keeps the cockpit URL from looking dead.
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem;color:#fee2e2;background:#020617;font-family:system-ui,sans-serif">
      <div style="max-width:36rem">
        <h1 style="font-size:1.5rem;font-weight:700;margin-bottom:0.75rem">Architect failed to boot</h1>
        <p style="opacity:0.8;margin-bottom:1rem">The Solid runtime threw on mount. Check the browser console for the full stack.</p>
        <pre style="background:#0f172a;border:1px solid #1f2937;border-radius:0.5rem;padding:0.75rem;font-size:0.85rem;overflow:auto">${(err as Error)?.stack ?? String(err)}</pre>
      </div>
    </div>
  `;
}
