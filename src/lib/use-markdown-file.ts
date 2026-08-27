/**
 * use-markdown-file.ts — read a `.meshkore/**.md` file for the ACTIVE
 * project, with a shared body cache.
 *
 * AX14 (cockpit-excellence). Three call sites re-implemented this and
 * each re-documented the same non-obvious rule in a comment, so it is
 * encoded here once:
 *
 *   The resource SOURCE depends only on the path, NEVER on
 *   `daemonStore.state.client`. On a project switch the active client
 *   flips BEFORE the roadmap `<For>` re-renders with the new snapshot —
 *   with the client in the source the resource would re-fire as
 *   (newClient, oldPath) and 404 against the new cluster's daemon. The
 *   client is read INSIDE the fetcher instead: the resource fires once
 *   at mount with the matching client, the card unmounts on switch, and
 *   the new cluster mounts new cards that fetch fresh.
 *
 * The cache exists because the cockpit re-polls `/state` every ~2s and
 * the roadmap recreates its rows on each refresh; without it every row
 * re-fetched and its body flickered. Entries are stamped with the
 * project they were read from — task paths are project-RELATIVE and
 * collide across clusters, so an unstamped cache would serve project
 * A's task body under project B.
 */

import { createResource } from 'solid-js';
import { daemonStore } from '~/state/daemon';

interface Entry { project: string; body: string }

const cache = new Map<string, Entry>();

const currentProject = (): string => daemonStore.state.client?.transport.projectId ?? '';

/** Cached body for `path`, but only if it was read from THIS project. */
function cached(path: string | null): string {
  if (!path) return '';
  const hit = cache.get(path);
  return hit && hit.project === currentProject() ? hit.body : '';
}

export interface MarkdownFile {
  /** The file body — the cached copy until the fetch lands, '' on error. */
  body: () => string;
  loading: () => boolean;
}

/** Read one markdown file by project-relative path. `null` parks the read. */
export function useMarkdownFile(path: () => string | null): MarkdownFile {
  const [res] = createResource<string, { path: string }>(
    () => {
      const p = path();
      return p ? { path: p } : null;
    },
    async (input) => {
      const client = daemonStore.state.client;
      if (!client) return cached(input.path);
      const project = client.transport.projectId ?? '';
      const r = await client.readMarkdownFile(input.path);
      const text = r.ok ? r.body : '';
      if (text) cache.set(input.path, { project, body: text });
      return text;
    },
  );

  return {
    body: () => res() ?? cached(path()),
    loading: () => res.loading,
  };
}
