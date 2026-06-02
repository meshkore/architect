/**
 * task-id.ts — V107.22. Display + sort helpers for the dotted-numeric
 * task ID convention (`1`, `1.1`, `1.1.1`).
 *
 * Spec: .meshkore/docs/conventions/frontmatter.md §"Task ID format"
 * + webapp/reference/prompts/roadmap-author/v1/task-template.md
 *
 * Two formats coexist:
 *   - PREFERRED: flat dotted-numeric ("1", "1.1", "1.1.1"). Display
 *     with `#` prefix; sort by dotted-number lex (1 < 1.1 < 1.1.1 < 1.2 < 2).
 *   - LEGACY: alphanumeric codes (T1, M1.1, DEMO3, MKT5, CRON-02).
 *     Display literally (no `#` prefix); sort by string compare or
 *     the existing `order:` frontmatter field.
 *
 * One helper module so every component renders ids the same way.
 */

const FLAT_ID_RE = /^\d+(\.\d+)*$/;

/** True when `id` matches the new flat dotted-numeric format. */
export function isFlatId(id: string): boolean {
  return FLAT_ID_RE.test(id);
}

/** Display form. Flat ids get a `#` prefix; legacy ids render as-is. */
export function displayTaskId(id: string): string {
  if (!id) return '—';
  return isFlatId(id) ? `#${id}` : id;
}

/**
 * Comparator for dotted-numeric ids. Returns the usual <0 / 0 / >0.
 *
 * Splits each id on `.` and compares part-by-part numerically. Shorter
 * ids sort BEFORE longer ones with the same prefix (so `1` < `1.1`).
 *
 * Legacy ids that don't match the flat shape fall back to string
 * compare. When one is flat and the other isn't, flat ids sort first
 * (the operator prefers the new format on top).
 */
export function compareTaskIds(a: string, b: string): number {
  const aFlat = isFlatId(a);
  const bFlat = isFlatId(b);
  if (aFlat && !bFlat) return -1;
  if (!aFlat && bFlat) return 1;
  if (!aFlat && !bFlat) return a.localeCompare(b);
  const ap = a.split('.').map((p) => parseInt(p, 10));
  const bp = b.split('.').map((p) => parseInt(p, 10));
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i += 1) {
    const av = ap[i] ?? -1;  // missing parts sort BEFORE present ones (1 < 1.1)
    const bv = bp[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Sort an array of `{ id }` records in-place by task id, using
 * `order:` frontmatter as a tie-breaker (legacy roadmaps relied on it).
 */
export function sortTasksByDottedId<T extends { id: string; order?: number | string }>(tasks: T[]): T[] {
  return tasks.slice().sort((a, b) => {
    // Primary: id comparator
    const byId = compareTaskIds(a.id, b.id);
    if (byId !== 0) return byId;
    // Tie-breaker: order: frontmatter
    const ao = typeof a.order === 'number' ? a.order : Number(a.order ?? 0);
    const bo = typeof b.order === 'number' ? b.order : Number(b.order ?? 0);
    return ao - bo;
  });
}

/**
 * Parse known sections out of a markdown body. Returns the raw body
 * for the rich render PLUS structured slices the cockpit displays
 * separately (Files list, Module badge).
 *
 * Conservative: missing sections are empty strings / arrays. The
 * `body` field is the FULL markdown (Goal + Done when + How + …);
 * components decide whether to render the whole thing or just the
 * sections they care about.
 */
export interface ParsedTaskBody {
  body: string;
  files: string[];
  moduleNote: string;
}

const FILES_RE = /^##\s+Files\s*$/im;
const MODULE_RE = /^##\s+Module\s*$/im;
const SECTION_RE = /^##\s+\S/m;

export function parseTaskBody(raw: string): ParsedTaskBody {
  // Strip leading frontmatter (the daemon serves the FILE, not the
  // post-frontmatter body, so we do it here).
  const body = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim();

  // ## Files block — bullet list under the heading until the next `## `.
  const filesMatch = FILES_RE.exec(body);
  const files: string[] = [];
  if (filesMatch) {
    const after = body.slice(filesMatch.index + filesMatch[0].length);
    const block = sliceUntilNextSection(after);
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('- ') && !trimmed.startsWith('* ')) continue;
      const item = trimmed.slice(2).replace(/^`|`$/g, '').trim();
      if (item) files.push(item);
    }
  }

  // ## Module — single paragraph note.
  const modMatch = MODULE_RE.exec(body);
  let moduleNote = '';
  if (modMatch) {
    const after = body.slice(modMatch.index + modMatch[0].length);
    moduleNote = sliceUntilNextSection(after).trim();
  }

  return { body, files, moduleNote };
}

function sliceUntilNextSection(s: string): string {
  const m = SECTION_RE.exec(s);
  return m ? s.slice(0, m.index) : s;
}

/**
 * Same for initiatives: parse the `## Description` block which the
 * cockpit renders collapsible. Falls back to the full body when no
 * Description section is declared (so the old initiatives that wrote
 * a `## Why` block still get something to clamp).
 */
const DESCRIPTION_RE = /^##\s+Description\s*$/im;

export interface ParsedInitiativeBody {
  description: string;
  full: string;
}

export function parseInitiativeBody(raw: string): ParsedInitiativeBody {
  const full = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim();
  const m = DESCRIPTION_RE.exec(full);
  if (!m) return { description: '', full };
  const after = full.slice(m.index + m[0].length);
  return { description: sliceUntilNextSection(after).trim(), full };
}
