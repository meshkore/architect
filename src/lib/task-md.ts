/**
 * task-md.ts — pure parsers for a task's on-disk markdown (Standard §4,
 * `## Resolution` from v26).
 *
 * AX14 (cockpit-excellence). Extracted verbatim out of InitiativeCard so
 * the regexes can be reasoned about (and tested) without a Solid runtime.
 * Zero imports on purpose: everything here is string → string.
 *
 * Regex-bug history worth keeping in mind when editing:
 *   `\Z` is a PYTHON end-of-input anchor. JavaScript has no such escape,
 *   so `\Z` degraded to a literal "Z" and the lazy resolution match
 *   stopped at the first capital Z in the prose — a resolution reading
 *   "Fixed the ZAI provider fallback" rendered as "Fixed the ".
 *   `(?![\s\S])` is the real end-of-input assertion and still composes
 *   with the /m flag that `^##` needs.
 */

/** Pull the `## Resolution` section body out of a task .md (Standard v26). */
export function extractResolution(body: string): string {
  const m = /^##\s+Resolution[ \t]*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(body);
  return stripResolutionMetaPrefix(m ? (m[1] ?? '').trim() : '');
}

/**
 * Drop the legacy "who/when" italic prefix line the daemon used to write
 * at the top of every resolution — `_Resolved by A023 via `conv` at …._`
 * / `_Failed (exit 1) — … via `conv` at …._`. It's pure noise: the
 * operator doesn't care which ephemeral subagent ran, and who/when
 * already render on their own line (`resolved_by` + `completed_at`). The
 * daemon stopped emitting it (2026-07-11), but tasks resolved before that
 * still carry it on disk, so we strip it defensively on read.
 */
export function stripResolutionMetaPrefix(text: string): string {
  return text
    .replace(/^\s*_(?:Resolved by|Failed)\b[^\n]*_\s*(?:\n+|$)/, '')
    .trim();
}

/** The task description = the body intro (after frontmatter + H1 title,
 *  before the first `##` section). */
export function extractDescription(body: string): string {
  let b = body.replace(/^---\n[\s\S]*?\n---\n?/, ''); // strip frontmatter
  b = b.replace(/^#\s+.*\n?/, '');                     // strip H1 title
  const idx = b.search(/^##\s/m);
  return (idx >= 0 ? b.slice(0, idx) : b).trim();
}

/** Files modified by the task — `files_changed` once the daemon records
 *  it (QX5). Unknown/absent → empty, never a partial guess. */
export function taskFiles(task: Record<string, unknown>): string[] {
  const fc = Array.isArray(task.files_changed) ? (task.files_changed as unknown[]) : null;
  if (fc) return fc.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return [];
}

/** Short commit SHAs persisted on the task, the fallback for `taskFiles`. */
export function taskCommits(task: Record<string, unknown>): string[] {
  const cs = Array.isArray(task.commit_shas) ? (task.commit_shas as unknown[]) : null;
  if (cs) {
    return cs
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .map((s) => s.slice(0, 9));
  }
  return [];
}
