/**
 * use-markdown.ts — one place where markdown becomes HTML.
 *
 * AX11 (cockpit-excellence). The `ensureMarked()` + `createResource` +
 * `innerHTML` + error-fallback dance was re-implemented in six files,
 * each with its own idea of what happens when the CDN load fails.
 * `marked` is loaded lazily from a CDN, so the failure path is real
 * (offline machine, blocked CDN) and every caller must degrade to the
 * raw text rather than render nothing.
 *
 * The hook returns a resource that yields `''` for empty input and
 * `null` when rendering failed — `null` is the signal for callers (or
 * `<Markdown>`) to fall back to a plain <pre>.
 */

import { createResource, type Resource } from 'solid-js';
import { ensureMarked } from '~/lib/cdn-loaders';
import { log } from '~/lib/log';

/**
 * Render a reactive markdown source to HTML.
 *
 * `source` returning `null` parks the resource (nothing is rendered and
 * nothing is fetched) — use it to defer the CDN load until a preview
 * tab is actually opened.
 */
export function useMarkdown(source: () => string | null): Resource<string | null> {
  const [html] = createResource(source, async (raw: string) => {
    if (!raw.trim()) return '';
    try {
      const marked = await ensureMarked();
      return marked.parse(raw, { gfm: true });
    } catch (e) {
      log.warn('markdown render failed', e instanceof Error ? e.message : String(e));
      return null;
    }
  });
  return html;
}

/** One-shot render for code paths that are already async (no resource). */
export async function renderMarkdown(raw: string): Promise<string | null> {
  if (!raw.trim()) return '';
  try {
    const marked = await ensureMarked();
    return marked.parse(raw, { gfm: true });
  } catch (e) {
    log.warn('markdown render failed', e instanceof Error ? e.message : String(e));
    return null;
  }
}
