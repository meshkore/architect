/**
 * team-snippet.ts — the ready-to-paste curl pair for an EXTERNAL team
 * member (TEG-3).
 *
 * The endpoint is this machine's SHARED daemon on loopback, so the port
 * is derived from the live transport rather than hardcoded: one daemon
 * serves every project on this Mac and its port moves between installs.
 * `-k` is not laziness — the daemon serves a self-signed cert on
 * 127.0.0.1 and there is no CA to trust it against.
 *
 * Pure string building; the caller decides whether the real token or a
 * placeholder goes in.
 */

const DEFAULT_DAEMON_PORT = 5573;

/** `https://127.0.0.1:<port>` for the daemon behind `httpBase`. */
export function askBase(httpBase: string | null | undefined): string {
  let port = DEFAULT_DAEMON_PORT;
  try {
    const raw = new URL(httpBase ?? '').port;
    if (raw) port = Number(raw);
  } catch { /* malformed or empty — keep the default */ }
  return `https://127.0.0.1:${port}`;
}

export interface SnippetInput {
  memberId: string;
  token: string;
  clusterId: string;
  httpBase: string | null | undefined;
}

/** The two-step ask → poll snippet handed to the consuming project. */
export function connectionSnippet(input: SnippetInput): string {
  const base = askBase(input.httpBase);
  const id = input.memberId;
  return [
    `# 1. Ask ${id} — returns {"request_id": "..."}`,
    `curl -sk -X POST ${base}/team/${id}/ask \\`,
    `  -H "Authorization: Bearer ${input.token}" \\`,
    `  -H "X-MeshKore-Project: ${input.clusterId}" \\`,
    `  -H "content-type: application/json" \\`,
    `  -d '{"text": "Your question here"}'`,
    ``,
    `# 2. Poll until status is "done" — the answer is in result_text`,
    `curl -sk ${base}/team/requests/<request_id> \\`,
    `  -H "Authorization: Bearer ${input.token}" \\`,
    `  -H "X-MeshKore-Project: ${input.clusterId}"`,
  ].join('\n');
}
