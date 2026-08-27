/**
 * SystemBubble — client-only in-band notice (dispatch errors, rejected
 * anchors, transient warnings). Distinct from operator and agent
 * bubbles: dimmer chrome, a status-tinted left edge, no byline.
 *
 * Never persisted by the daemon — these live only in the cockpit's
 * in-memory convMap and disappear on cluster swap or reload.
 */

import { Show } from 'solid-js';
import type { ChatMsg } from '~/state/chat';

type Tint = { border: string; dot: string; text: string };

const TINTS: Record<'error' | 'warning' | 'info', Tint> = {
  error: { border: '#ef4444', dot: '#f87171', text: '#fecaca' },
  warning: { border: '#f59e0b', dot: '#fbbf24', text: '#fde68a' },
  info: { border: '#6b7280', dot: '#9ca3af', text: '#d1d5db' },
};

export function SystemBubble(props: { msg: ChatMsg }) {
  const sev = (): 'error' | 'warning' | 'info' => props.msg.system_kind ?? 'info';
  const tint = (): Tint => TINTS[sev()];
  const ts = (): string => {
    const v = props.msg.ts;
    if (!v) return '';
    const d = new Date(v);
    return Number.isFinite(d.getTime())
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
  };
  return (
    <div
      role="alert"
      class="flex items-start gap-2 mx-2 my-1 px-3 py-2 rounded text-[12.5px] leading-relaxed"
      style={{
        background: 'rgba(120, 27, 30, 0.08)',
        'border-left': `3px solid ${tint().border}`,
        color: tint().text,
      }}
    >
      <span
        aria-hidden="true"
        class="flex-shrink-0 mt-1"
        style={{
          width: '6px', height: '6px',
          'border-radius': '50%',
          background: tint().dot,
        }}
      />
      <div class="flex-1 min-w-0">
        <div class="font-mono text-[10px] uppercase tracking-wider opacity-60 mb-0.5">
          {sev() === 'error' ? 'error' : sev() === 'warning' ? 'warning' : 'system'}
          <Show when={ts()}><span class="ml-2 normal-case opacity-80">{ts()}</span></Show>
        </div>
        <div style={{ 'white-space': 'pre-wrap', 'word-break': 'break-word' }}>
          {props.msg.text}
        </div>
      </div>
    </div>
  );
}

export default SystemBubble;
