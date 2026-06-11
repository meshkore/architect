/* @refresh reload */
import { render } from 'solid-js/web';
import App from '~/App';
import { log } from '~/lib/log';
import { installChunkGuard } from '~/lib/chunk-guard';
import { startCockpitVersionPoll, COCKPIT_COMMIT, COCKPIT_VERSION } from '~/lib/cockpit-version';
import { installDebugTransport } from '~/lib/debug-transport';
import { auditLocalStorage } from '~/lib/storage-audit';
import './index.css';

// SRL4 — drop stale localStorage keys before anything reads from it.
// The architect's persistent state is only the per-browser preferences
// listed in storage-audit.ts; anything else is daemon-side state cache
// from an older version and gets garbage-collected here. Cheap, runs
// once at boot, never throws.
auditLocalStorage();

// py-1.10.17 — Wire the debug stream sink BEFORE the first log.* call
// so the boot line below is captured. Feature-gated server-side; no-op
// if the daemon doesn't advertise `debug.stream.v1`.
installDebugTransport();

log.info('script loaded', { version: COCKPIT_VERSION, commit: COCKPIT_COMMIT });

// V93 — Reload-once safety net for stale-deploy dynamic-import failures.
// Installed before App mounts so it covers chunks loaded during boot too.
installChunkGuard();
// V99 — Start the cockpit-version self-poll. Fetches /health.json every
// 5 min and flips `cockpitOutdated` when the server's commit differs
// from this bundle's. Cockpit.tsx renders the banner. Survives every
// tab indefinitely — no service worker required.
startCockpitVersionPoll();

const root = document.getElementById('app');
if (!root) {
  log.error('#app mount node missing — index.html is broken');
  throw new Error('#app mount node missing');
}

try {
  // Solid Router is intentionally NOT used yet. We'll add it in Hito 2 when
  // the cockpit actually has multiple tabs/routes. For Hito 1 we want the
  // smallest possible runtime so any mount failure is easy to diagnose.
  render(() => <App />, root);
  log.info('Solid mounted into #app');
} catch (err) {
  log.error('Solid mount threw', err);
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
