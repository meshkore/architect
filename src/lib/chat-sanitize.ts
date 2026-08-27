/**
 * chat-sanitize.ts — pure text/payload scrubbers for the chat layer.
 *
 * AX12 (cockpit-excellence). These three helpers were buried inside the
 * chat store; they touch no store state, so they live here where they
 * can be unit-tested and reused by any renderer.
 *
 * Both strippers are belt-and-braces: the daemon already scrubs its own
 * output server-side, but a `delta` from an older daemon (or a message
 * persisted by one) can still carry the wire markers, and the operator
 * must never see them.
 */

import { log } from '~/lib/log';

/** Chat attachment served by the daemon. The `url` is daemon-relative
 *  (e.g. `/chat/uploads/2026-06-10/abc.png`); resolve against the
 *  active daemon's httpBase to display. */
export interface ChatAttachment {
  kind: 'image' | 'file';
  media_type: string;
  url: string;
  size_bytes?: number;
  filename?: string;
}

/** Drop `REMEMBER: …` lines an agent emitted for the role-memory
 *  sidecar — they are instructions to the daemon, not operator prose. */
export function stripRememberLines(text: string): string {
  if (!text) return text;
  return text
    .split('\n')
    .filter((ln) => !/^\s*(?:[-*]\s+)?REMEMBER:\s/i.test(ln))
    .join('\n')
    .trimEnd();
}

/**
 * Strip the daemon↔frontend `⟦anchor⟧ {...}` /
 * `⟦anchor-progress⟧ {...}` wire markers.
 *
 * Daemon py-1.13.2 strips them before persisting, but messages written
 * by py-1.13.0/1.13.1 — and any older daemon on the other end — still
 * carry them.
 */
export function stripAnchorMarkers(text: string): string {
  if (!text || !text.includes('⟦anchor')) return text;
  return text
    .replace(/^[\s\n]*⟦anchor⟧\s*\{[^\n]*\}[ \t]*\n?/, '')
    .replace(/⟦anchor-progress⟧\s*\{[^\n]*\}[ \t]*\n?/g, '');
}

/** Both scrubbers in the order the ingest path applies them. */
export function cleanChatText(text: string): string {
  return stripAnchorMarkers(stripRememberLines(text));
}

/**
 * Validate + normalise the daemon's `chat.user.attachments` field.
 * Returns undefined when nothing valid survives; the caller treats that
 * the same as "no attachments".
 *
 * A-UPLOAD-URL-01 (2026-06-16) — only a real served upload
 * (`/chat/uploads/…`), an absolute http(s) url, or a local `data:` URL
 * (optimistic bubble) may be rendered. A conv slug once leaked into
 * `url` and painted a broken `<img>`; anything else is malformed.
 */
export function parseAttachments(raw: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ChatAttachment[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const rec = e as Record<string, unknown>;
    const url = typeof rec.url === 'string' ? rec.url : '';
    const media_type = typeof rec.media_type === 'string' ? rec.media_type : '';
    if (!url || !media_type) continue;
    const validUrl =
      url.startsWith('/chat/uploads/') ||
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('data:');
    if (!validUrl) {
      log.warn('parseAttachments dropped malformed url', { url: url.slice(0, 80) });
      continue;
    }
    out.push({
      kind: rec.kind === 'image' ? 'image' : 'file',
      media_type,
      url,
      size_bytes: typeof rec.size_bytes === 'number' ? rec.size_bytes : undefined,
      filename: typeof rec.filename === 'string' ? rec.filename : undefined,
    });
  }
  return out.length ? out : undefined;
}
