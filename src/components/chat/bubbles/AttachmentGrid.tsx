/**
 * AttachmentGrid — the persisted attachments of a `chat.user` message.
 * Images become clickable thumbnails; other files render as a chip with
 * the filename.
 *
 * Daemon URLs are daemon-relative and resolved against the active
 * daemon's `httpBase`. FC-2 (daemon-centralized): an `<img>` / `<a>`
 * load cannot send the `X-MeshKore-Project` header, so the centralized
 * daemon would resolve the upload against its default project (→ 404).
 * The project therefore rides in the query string, which the daemon's
 * guard honours.
 */

import { For } from 'solid-js';
import type { ChatMsg } from '~/state/chat';
import { daemonStore } from '~/state/daemon';

export function AttachmentGrid(props: { msg: ChatMsg; align: 'left' | 'right' }) {
  const resolve = (url: string): string => {
    if (!url) return url;
    if (/^https?:\/\//.test(url)) return url;
    const base = daemonStore.state.client?.transport.httpBase ?? '';
    if (!base) return url;
    let out = base.replace(/\/+$/, '') + url;
    const pid = daemonStore.state.client?.transport.projectId;
    if (pid) out += (out.includes('?') ? '&' : '?') + 'project=' + encodeURIComponent(pid);
    return out;
  };
  const list = (): NonNullable<ChatMsg['attachments']> => props.msg.attachments ?? [];
  return (
    <div
      class={`mt-1 flex flex-wrap gap-1.5 max-w-[85%] ${
        props.align === 'right' ? 'justify-end pr-2' : 'justify-start pl-2'
      }`}
    >
      <For each={list()}>
        {(a) => {
          const href = resolve(a.url);
          const isImg = a.kind === 'image' || a.media_type.startsWith('image/');
          if (isImg) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                class="block w-20 h-20 rounded overflow-hidden border border-gray-800 hover:border-gray-600 transition-colors bg-gray-900"
                title={a.filename ?? 'image'}
              >
                <img
                  src={href}
                  alt={a.filename ?? 'attached image'}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', 'object-fit': 'cover' }}
                />
              </a>
            );
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              class="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-gray-800 hover:border-gray-600 bg-gray-900 text-[11px] text-gray-300 transition-colors"
              title={a.filename ?? 'file'}
            >
              <span aria-hidden="true">📎</span>
              <span class="font-mono truncate max-w-[160px]">{a.filename ?? a.media_type}</span>
            </a>
          );
        }}
      </For>
    </div>
  );
}

export default AttachmentGrid;
