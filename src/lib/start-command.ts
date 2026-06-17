/**
 * start-command.ts — single source of truth for the per-project daemon
 * start command and the "hand it to Claude Code" prompt.
 *
 * Before A-STARTCMD-HELPER-01 (2026-06-16) these strings were duplicated
 * across three surfaces:
 *   - ReviveList   (in-wizard revive of a known stopped project — the
 *                   detached `nohup … & disown` form)
 *   - OfflinePanel (per-PROJECT offline screen — the foreground
 *                   `cd … && python3 …` form + a Claude Code prompt)
 *   - NoDaemon     (global "no daemon detected" screen — A-NODAEMON-GUIDE-01)
 *
 * Each surface kept its own copy and they had already started to drift.
 * This module centralizes them; call sites pass a `StartCommandTarget`
 * (a KnownProject-shaped subset) and get back the exact strings they
 * used to build inline. NO behaviour change — the helpers reproduce the
 * prior output verbatim.
 */

/**
 * The minimal project shape the command builders need. A `KnownProject`
 * (from `~/lib/known-projects`) satisfies this structurally, as does the
 * offline-selection record once you read `repo_path` off the known list.
 */
export interface StartCommandTarget {
  port: number;
  repo_path?: string | null;
  cluster_id?: string;
  cluster_name?: string;
}

/**
 * The `cd` line, or the no-repo_path fallback comment.
 * Returns `cd "<repo_path>"` when known, else `# cd <your project folder>`.
 */
export function cdLine(p: StartCommandTarget): string {
  return p.repo_path ? `cd "${p.repo_path}"` : '# cd <your project folder>';
}

/**
 * The `cd` line ONLY when a repo path is known, else null. OfflinePanel
 * renders the cd step as a separate copy block and omits it entirely
 * when there's no path (rather than showing the fallback comment).
 */
export function cdCommandOrNull(p: StartCommandTarget): string | null {
  return p.repo_path ? `cd "${p.repo_path}"` : null;
}

/** The bare foreground start command: `python3 … --port <port>`. */
export function startCommand(p: StartCommandTarget): string {
  return `python3 .meshkore/scripts/daemon.py --port ${p.port}`;
}

/**
 * The canonical one-liner: `cd "<repo>" && python3 … --port <port>`,
 * with the `# cd <your project folder>` fallback when no repo_path.
 * This is the form used by the global NoDaemon screen.
 */
export function startCommandLine(p: StartCommandTarget): string {
  return `${cdLine(p)} && ${startCommand(p)}`;
}

/**
 * The detached launch block used by the in-wizard ReviveList. Preserves
 * the prior multi-line `nohup … & disown` form verbatim (no `--port`;
 * the daemon self-selects from the 5570–5589 range).
 */
export function reviveCommand(p: StartCommandTarget): string {
  // NOTE: ReviveList historically used the UNQUOTED `cd <path>` form
  // (vs OfflinePanel's quoted `cd "<path>"`). Preserved verbatim here to
  // keep the A-STARTCMD-HELPER-01 refactor output-identical.
  return [
    p.repo_path ? `cd ${p.repo_path}` : '# cd <your project folder>',
    'mkdir -p .meshkore/.runtime && \\',
    '  nohup python3 .meshkore/scripts/daemon.py \\',
    '    > .meshkore/.runtime/daemon.log 2>&1 & \\',
    '  disown ; echo "✓ daemon launched on :5570-5589"',
  ].join('\n');
}

/**
 * The "hand it to Claude Code" prompt. Reproduces OfflinePanel's
 * `agentPrompt()` verbatim so the diagnose-and-fix instructions stay in
 * one place. Includes the TLS-bundle repair branch.
 */
export function agentPrompt(p: StartCommandTarget): string {
  const port = p.port;
  const cid = p.cluster_id ? ` (cluster_id=${p.cluster_id})` : '';
  return (
`The MeshKore architect cockpit at https://architect.meshkore.com can't reach ` +
`this project's daemon${cid} on port ${port}. Diagnose and fix:

1. Check if a daemon is already listening:
   \`lsof -iTCP:${port} -sTCP:LISTEN\`

2a. If NO process owns the port → start the daemon:
    \`python3 .meshkore/scripts/daemon.py --port ${port}\`

2b. If a process IS bound → the daemon is alive but its TLS bundle is missing,
    so the HTTPS-only cockpit can't speak to it. Repair:
    - shutdown the running daemon:
      \`curl -s -X POST http://localhost:${port}/shutdown -H "Authorization: Bearer $(cat .meshkore/credentials/portal-token)"\`
    - copy a recent daemon.py + tls/ bundle from a peer project (e.g.
      \`~/Documents/Prj/asimovia/meshkore/.meshkore/scripts/{daemon.py,tls/}\`)
      into THIS project's \`.meshkore/scripts/\`.
    - restart: \`python3 .meshkore/scripts/daemon.py --port ${port}\`

The cockpit will auto-reconnect the moment /health responds over HTTPS at
https://daemon.meshkore.com:${port}/health.`
  );
}
