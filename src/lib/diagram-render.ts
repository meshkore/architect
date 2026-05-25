/**
 * diagram-render.ts — shared diagram fetcher + mermaid renderer used
 * by ContextPanel and DiagramsPanel. Returns an SVG string ready to
 * be dropped into the DOM via `innerHTML`.
 */

import { daemonStore } from '~/state/daemon';
import { ensureMermaid } from '~/lib/cdn-loaders';

export interface DiagramRef {
  slug: string;
  kind: string;
  title?: string;
  path: string;
  description?: string;
}

export async function renderDiagram(diagram: DiagramRef): Promise<string> {
  const client = daemonStore.state.client;
  if (!client) throw new Error('no daemon');
  // Daemon serves .meshkore/ root: diagrams paths start with
  // `modules/...` or `docs/...`. Anything else gets prefixed.
  const rel = diagram.path.startsWith('modules/') || diagram.path.startsWith('docs/')
    ? diagram.path
    : 'docs/' + diagram.path;
  const url = client.transport.httpBase + '/' + rel;
  const token = client.transport.token;
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(`fetch ${rel} → ${r.status}`);
  let src = await r.text();
  src = src.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '');
  const mermaid = await ensureMermaid();
  const id = 'mmd-' + Math.random().toString(36).slice(2);
  const { svg } = await mermaid.render(id, src);
  return svg;
}
