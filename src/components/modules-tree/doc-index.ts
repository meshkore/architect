/**
 * doc-index.ts — V86i.
 *
 * Indexes the `snapshot.docs.tree` payload so ModulesTree can light up
 * each module row with three independent visual indicators:
 *
 *   - tasks    (already in the per-module aggregate, shown as a count)
 *   - context  (does this scope have a README-style doc?)
 *   - diagrams (does that doc declare any mermaid blocks?)
 *
 * Also surfaces the project-level doc categories (architecture,
 * security, deploy, conventions, …) so the tree can render them as
 * top-level "project" items alongside the modules. Clicking one of
 * those navigates the Context + Diagrams panels to that doc.
 *
 * The scope ID format the rest of the cockpit uses:
 *   - `null`                      → "All projects"
 *   - `<moduleId>`                → an entry from snapshot.modules
 *   - `doc:<category>/<slug>`     → a project-level doc (V86i)
 *
 * Existing callers (`pickDoc` in ContextPanel/DiagramsPanel, the
 * roadmap filter) keep working unchanged for the first two cases;
 * the third is opt-in.
 */

import { createMemo } from 'solid-js';
import { serverStore } from '~/state/server';

interface DocRef {
  category: string;
  slug: string;
  title?: string;
  diagrams?: unknown[];
}
interface DocCategory { category?: string; items: DocRef[]; }

export const PROJECT_DOC_SCOPE_PREFIX = 'doc:';

export const docTree = createMemo<DocCategory[]>(() => {
  const tree = (serverStore.state.snapshot as { docs?: { tree?: DocCategory[] } } | null)?.docs?.tree;
  return Array.isArray(tree) ? tree : [];
});

/** All docs flattened with their category attached. */
export const allDocs = createMemo<Array<DocRef & { category: string }>>(() => {
  const out: Array<DocRef & { category: string }> = [];
  for (const cat of docTree()) {
    const catName = (cat.category as string | undefined) ?? '';
    for (const item of cat.items ?? []) {
      out.push({ ...item, category: item.category ?? catName });
    }
  }
  return out;
});

/** Module-scoped indicators. */
export interface ModuleDocFlags { hasContext: boolean; hasDiagrams: boolean; }
export const moduleDocFlags = createMemo<Map<string, ModuleDocFlags>>(() => {
  const map = new Map<string, ModuleDocFlags>();
  for (const d of allDocs()) {
    if (d.category !== 'modules') continue;
    const diagrams = Array.isArray(d.diagrams) ? d.diagrams.length > 0 : false;
    map.set(d.slug, { hasContext: true, hasDiagrams: diagrams });
  }
  return map;
});

/** Top-level project docs: anything NOT under the `modules` category.
 *  Sorted: architecture first (highest signal), then alphabetical. */
export interface ProjectDoc {
  scopeId: string;     // `doc:<category>/<slug>`
  label: string;
  category: string;
  slug: string;
  hasDiagrams: boolean;
}
const CATEGORY_ORDER: Record<string, number> = {
  architecture: 0,
  product: 1,
  conventions: 2,
  security: 3,
  deploy: 4,
  ops: 5,
};
export const projectDocs = createMemo<ProjectDoc[]>(() => {
  const out: ProjectDoc[] = [];
  for (const d of allDocs()) {
    if (d.category === 'modules') continue;
    out.push({
      scopeId: `${PROJECT_DOC_SCOPE_PREFIX}${d.category}/${d.slug}`,
      label: d.title ?? d.slug,
      category: d.category,
      slug: d.slug,
      hasDiagrams: Array.isArray(d.diagrams) ? d.diagrams.length > 0 : false,
    });
  }
  out.sort((a, b) => {
    const oa = CATEGORY_ORDER[a.category] ?? 99;
    const ob = CATEGORY_ORDER[b.category] ?? 99;
    if (oa !== ob) return oa - ob;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.label.localeCompare(b.label);
  });
  return out;
});

/** Resolve a `doc:<cat>/<slug>` scope back to its underlying doc, if any. */
export function findProjectDoc(scopeId: string | null): { category: string; slug: string } | null {
  if (!scopeId || !scopeId.startsWith(PROJECT_DOC_SCOPE_PREFIX)) return null;
  const rest = scopeId.slice(PROJECT_DOC_SCOPE_PREFIX.length);
  const idx = rest.indexOf('/');
  if (idx < 0) return null;
  return { category: rest.slice(0, idx), slug: rest.slice(idx + 1) };
}

export function isProjectDocScope(scopeId: string | null): boolean {
  return !!scopeId && scopeId.startsWith(PROJECT_DOC_SCOPE_PREFIX);
}
