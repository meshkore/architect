/**
 * log.ts — single source of truth for cockpit logging.
 *
 * Levels: `debug`, `info`, `warn`, `error`.
 *
 * Production build (`import.meta.env.DEV === false`):
 *   - `debug` and `info` are compile-time stripped by Vite via the
 *     dead-code elimination it gets from the `DEV` constant. The
 *     Rollup minifier removes the entire call when DEV is false.
 *   - `warn` and `error` always pass through; operators need them for
 *     incident triage even in production.
 *
 * Operator escape hatch (M0.1):
 *   Set `localStorage['mc-log-mode'] = 'verbose'` and reload to force
 *   debug + info ON in production. Useful when an operator hits an
 *   issue in the live cockpit and wants to capture diagnostic output
 *   without a redeploy. Removing the key restores the default.
 *
 * Format: every line is prefixed `[architect:<level>]` so DevTools
 * filtering and grep-on-screenshot stay trivial.
 *
 * This module is M0.1 of the Solid migration. The monolith's
 * `console.*` callsites get migrated to use this helper in M8.2 — not
 * here. The utility ships first so M8.2 has a target to point to.
 */

const DEV = import.meta.env.DEV;

function verboseOverride(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('mc-log-mode') === 'verbose';
  } catch {
    return false;
  }
}

function fmt(level: string, args: unknown[]): unknown[] {
  return [`%c[architect:${level}]`, 'color:#34d399;font-weight:600', ...args];
}

// py-1.10.17 — Debug stream sink. A separate module
// (`debug-transport.ts`) registers a sink at app boot that batches
// entries and POSTs them to the daemon's `/debug/log`. Keeping the
// sink pluggable means `log.ts` stays free of network / daemon-client
// imports (it's M0.1 — a leaf module).
export interface LogSinkEntry {
  ts: string;          // ISO 8601 UTC with ms
  lvl: 'debug' | 'info' | 'warn' | 'error';
  msg: string;         // concatenated stringified args
  args: unknown[];     // raw args for the sink to serialise as it sees fit
}
type LogSink = (entry: LogSinkEntry) => void;
let _sink: LogSink | null = null;

export function setLogSink(sink: LogSink | null): void {
  _sink = sink;
}

function toMsg(args: unknown[]): string {
  try {
    return args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}`;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
  } catch {
    return '<unserialisable>';
  }
}

function feed(level: 'debug' | 'info' | 'warn' | 'error', args: unknown[]): void {
  if (!_sink) return;
  try {
    _sink({ ts: new Date().toISOString(), lvl: level, msg: toMsg(args), args });
  } catch {
    // Sink failures must never break the caller.
  }
}

export const log = {
  debug: (...args: unknown[]): void => {
    if (DEV || verboseOverride()) console.debug(...fmt('debug', args));
    feed('debug', args);
  },
  info: (...args: unknown[]): void => {
    if (DEV || verboseOverride()) console.log(...fmt('info', args));
    feed('info', args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(...fmt('warn', args));
    feed('warn', args);
  },
  error: (...args: unknown[]): void => {
    console.error(...fmt('error', args));
    feed('error', args);
  },
};
