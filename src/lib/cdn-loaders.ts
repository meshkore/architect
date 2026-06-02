/**
 * cdn-loaders.ts — lazy ESM loaders for `marked` (markdown) and
 * `mermaid` (diagrams). Both are heavy; we load on first use from
 * jsdelivr the same way the V80 monolith does, then cache the module.
 */

let markedPromise: Promise<MarkedLike> | null = null;
let mermaidPromise: Promise<MermaidLike> | null = null;

export interface MarkedLike {
  parse: (src: string, opts?: { gfm?: boolean }) => string;
  use?: (...extensions: unknown[]) => void;
}

/** V107.25 — Marked extension that adds `target="_blank" rel="noopener noreferrer"`
 *  to every absolute (http/https) anchor it renders. Internal anchors
 *  (`#section`, relative `/foo`) pass through untouched. Reason:
 *  agents now emit github commit/PR/branch refs as full markdown
 *  links (closure-protocol R2.1) — clicking one inside the cockpit
 *  navigated the entire tab AWAY from architect.meshkore.com,
 *  losing the operator's place. */
const externalLinksTargetBlank = {
  renderer: {
    link(token: { href?: string; title?: string | null; text?: string; tokens?: unknown[] }): string {
      const href = token.href ?? '';
      const text = token.text ?? href;
      const isExternal = /^https?:\/\//i.test(href);
      const titleAttr = token.title ? ` title="${token.title.replace(/"/g, '&quot;')}"` : '';
      const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${href}"${titleAttr}${targetAttr}>${text}</a>`;
    },
  },
};

export interface MermaidLike {
  initialize: (cfg: Record<string, unknown>) => void;
  render: (id: string, src: string) => Promise<{ svg: string }>;
}

const MARKED_URL = 'https://cdn.jsdelivr.net/npm/marked@12/+esm';
const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';

// `import(<url>)` is a runtime ESM CDN fetch; TS can't resolve the URL
// at compile time, so we go through a typed indirection.
const dynImport = (url: string): Promise<unknown> =>
  (new Function('u', 'return import(u)') as (u: string) => Promise<unknown>)(url);

export function ensureMarked(): Promise<MarkedLike> {
  if (!markedPromise) {
    markedPromise = dynImport(MARKED_URL).then((m) => {
      const marked = (m as { marked: MarkedLike }).marked;
      if (typeof marked.use === 'function') {
        marked.use(externalLinksTargetBlank);
      }
      return marked;
    });
  }
  return markedPromise;
}

export function ensureMermaid(): Promise<MermaidLike> {
  if (!mermaidPromise) {
    mermaidPromise = dynImport(MERMAID_URL).then((m) => {
      const mer = (m as { default: MermaidLike }).default;
      mer.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: { darkMode: true, background: '#0b1220' },
      });
      return mer;
    });
  }
  return mermaidPromise;
}
