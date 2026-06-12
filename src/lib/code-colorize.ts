/**
 * code-colorize — JetBrains Darcula-inspired tokenizer for inline
 * `<code>` spans in chat bubbles.
 *
 * Why this exists: chat replies are dense with file paths, endpoints,
 * variable names, JSON snippets and literal values. Rendering all of
 * them in one accent colour (emerald, pre-2026-06-12) made replies
 * look "todo verde" — the operator couldn't differentiate at a glance
 * between an endpoint, an identifier, a literal, and a value.
 *
 * This module wraps recognizable atoms inside an inline `<code>` span
 * in `<span data-tok="…">` so the cockpit's CSS can colour them
 * independently. Seven kinds, scanned in priority order (first match
 * wins so an identifier inside a URL doesn't get reclassified):
 *
 *   url      — http(s):// URLs incl. scheme (whole atom, one colour)
 *   string   — quoted strings, "..." / '...'
 *   stamp    — build / version / commit stamps with `·` separators
 *   path     — atoms with `/` or `::`, file paths and namespaced ids
 *   literal  — true / false / null / undefined / None
 *   number   — integer / decimal literals (HTTP status codes land here)
 *   ident    — multi-segment dotted identifiers (Foo.bar.baz)
 *   default  — everything else (rendered in the chat's neutral gray)
 *
 * The classifier runs ONLY on inline `<code>` (not on `<pre> <code>` —
 * block code keeps its dark slate styling). Skipping it is safe:
 * default text colour falls back to the same gray as body prose.
 */

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

const KIND_ORDER = ['url', 'string', 'stamp', 'path', 'literal', 'number', 'ident'] as const;
const TOKEN_RE = new RegExp([
  // url — full http(s):// URLs incl. scheme. Highest priority so a URL
  // never gets split between scheme and path. Stops at whitespace,
  // quote, paren, bracket, angle, or backtick — common URL boundaries.
  '(?<url>\\bhttps?:\\/\\/[^\\s\'"<>`)\\]]+)',
  // string — double or single quoted, supports escaped quote
  '(?<string>"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')',
  // stamp — version / build / commit stamps separated by middle-dot
  // `·` (U+00B7) or pipe, e.g. `v0.0.1·3a7c81b·2026-06-12`. Atomic so
  // the renderer doesn\'t fracture the stamp into three different colours.
  '(?<stamp>[A-Za-z_]?[\\w.\\-]+(?:[·|][\\w.\\-]+)+)',
  // path — `/`, `::`, or `\\` separator between word chars (file paths,
  // namespaced ids, Windows paths). URLs are already caught above.
  '(?<path>[A-Za-z_][\\w.\\-]*(?:[\\/:\\\\]{1,2}[\\w.\\-]+)+)',
  // literal — common multi-language reserved values
  '(?<literal>\\b(?:true|false|null|undefined|None|True|False)\\b)',
  // number — int / decimal, optional sign. Order matters: number AFTER
  // stamp so `2026-06-12` inside a stamp doesn\'t get pre-eaten.
  '(?<number>-?\\b\\d+(?:\\.\\d+)?\\b)',
  // ident — dotted multi-segment identifier (Foo.bar, namespace.x.y)
  '(?<ident>[A-Za-z_][\\w]*(?:\\.[A-Za-z_][\\w]*)+)',
].join('|'), 'g');

/** Tokenize the plain-text body of a single inline `<code>` span and
 *  return HTML where each recognized atom is wrapped in
 *  `<span data-tok="<kind>">`. Unrecognized text is escaped untouched
 *  (will pick up the default code colour from CSS).
 */
export function tokenizeInlineCode(text: string): string {
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    const groups = m.groups ?? {};
    let kind: string = 'default';
    for (const k of KIND_ORDER) {
      if (groups[k] != null) { kind = k; break; }
    }
    out += `<span data-tok="${kind}">${escapeHtml(m[0])}</span>`;
    last = TOKEN_RE.lastIndex;
    if (m[0].length === 0) TOKEN_RE.lastIndex += 1;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}

/** Walk an HTML string, find every inline `<code>` (excluding those
 *  nested inside `<pre>`), and rewrite its body via tokenizeInlineCode.
 *  Uses DOMParser → safe-by-construction (the parsed text content is
 *  re-escaped on emit). Returns the original HTML untouched if
 *  DOMParser is unavailable or parsing fails.
 */
export function colorizeInlineCodeInHtml(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return html;
  try {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild as HTMLElement | null;
    if (!root) return html;
    const codes = root.querySelectorAll('code');
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i];
      if (code.closest('pre')) continue;
      const text = code.textContent ?? '';
      if (!text) continue;
      code.innerHTML = tokenizeInlineCode(text);
    }
    return root.innerHTML;
  } catch {
    return html;
  }
}
