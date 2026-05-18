/**
 * log.ts — single source of truth for cockpit logging.
 *
 * The whole SPA logs through one helper so we can centrally:
 *   - prefix lines with `[architect]` for easy filtering in DevTools
 *   - mirror to a future debug overlay when needed
 *   - silence in production via `?quiet=1` if it ever gets noisy
 */

const noisy = !/(\?|&)quiet=1\b/.test(typeof location !== 'undefined' ? location.search : '');

function fmt(level: string, args: unknown[]): unknown[] {
  return [`%c[architect:${level}]`, 'color:#34d399;font-weight:600', ...args];
}

export const log = {
  info: (...args: unknown[]) => { if (noisy) console.log(...fmt('info', args)); },
  warn: (...args: unknown[]) => console.warn(...fmt('warn', args)),
  error: (...args: unknown[]) => console.error(...fmt('error', args)),
  debug: (...args: unknown[]) => { if (noisy) console.debug(...fmt('debug', args)); },
};
