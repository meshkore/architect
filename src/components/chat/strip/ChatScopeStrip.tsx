/**
 * ChatScopeStrip — the row above the chat thread.
 *
 * Left to right: the agent-TYPE pill (the A001-style id is internal —
 * diaries, logs, WS — and deliberately not on the chat wall), the bound
 * roster member, the conv title, the live model/effort pickers, the
 * usage chip, the context gauge, a debug-drop badge, STOP while the
 * agent is working, and the action icons.
 *
 * AX17 (cockpit-excellence) split the 453-line component: each chip
 * above is its own file under `chat/strip/`. Several were inline
 * `{(() => {…})()}` subtrees, which create untracked scopes — a real
 * Solid reactivity trap.
 */

import { Show, createSignal } from 'solid-js';
import { chatStore, ONBOARDING_CONV_ID, isFixedAgentConv, type ConvMeta } from '~/state/chat';
import { isConvWorking } from '~/state/live-selectors';
import { teamStore } from '~/state/team';
import { agentVisualInfo } from '~/lib/agent-types';
import { debugDropCount } from '~/lib/debug-transport';
import ContextGauge from './ContextGauge';
import MemberPicker from './MemberPicker';
import ModelEffortPickers from './ModelEffortPickers';
import StopButton from './StopButton';
import StripActions from './StripActions';
import TitleEditor from './TitleEditor';
import UsageChip from './UsageChip';

interface Props {
  conv: string;
  meta: ConvMeta | undefined;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onRename: (next: string) => void;
  onArchive: () => void;
  /** M7.7 — open the per-type role memory viewer for this agent. */
  onOpenRoleMemory?: () => void;
}

export default function ChatScopeStrip(props: Props) {
  const [editing, setEditing] = createSignal(false);

  const title = () => props.meta?.title?.trim() || props.meta?.agentId || props.conv;
  // py-1.10.24 — conv-aware lookup, so the onboarding conv shows as
  // Master Architect and roadmap-architect slugs keep the cyan cap even
  // when conv_meta has drifted.
  const typeInfo = () => agentVisualInfo(props.conv, props.meta);
  // The pill shows the type initial: 1-2 chars verbatim, otherwise the
  // first letter.
  const typeInitial = (): string => {
    const src = (typeInfo().shortLabel ?? typeInfo().label).trim();
    if (!src) return '·';
    return src.length <= 2 ? src.toUpperCase() : src[0]!.toUpperCase();
  };

  const snap = () => chatStore.state.convs[props.conv] ?? null;
  // Daemon-authoritative first, local convMeta as the fallback — the same
  // precedence the pickers themselves apply.
  const modelId = (): string => snap()?.model ?? props.meta?.model ?? 'auto';
  const effortId = (): string => snap()?.effort ?? props.meta?.effort ?? 'default';
  const clientId = (): string => snap()?.client ?? props.meta?.client ?? 'claude-code';

  // ATM12 follow-up (2026-07-07 operator correction) — the fixed-agent
  // explainer sits under THIS agent's own name row, shown only while that
  // agent is selected, instead of one combined note above the rail.
  const fixedNote = (): string | null => {
    if (props.conv === ONBOARDING_CONV_ID) {
      return 'Fixed system agent — plans only (roadmap, context, links, crons). Never writes code.';
    }
    if (isFixedAgentConv(props.conv)) {
      return 'Fixed system agent — executes the queue and may dispatch agents. Never writes code itself.';
    }
    return null;
  };

  // ATM7 — a conv is a DRAFT until it has any message: member and name
  // are editable until then, frozen to a read-only badge afterwards. The
  // onboarding conv is never a draft (it is the always-on master).
  const boundMember = () => teamStore.get(props.meta?.member);
  const isDraft = (): boolean => {
    if (props.conv === ONBOARDING_CONV_ID) return false;
    const msgs = chatStore.state.convMap[props.conv] ?? [];
    return !msgs.some((m) => m.kind === 'user' || m.kind === 'assistant');
  };
  const rebindMember = (id: string): void => {
    const m = teamStore.get(id);
    chatStore.setConvMember(props.conv, id, {
      model: m?.model,
      effort: m?.effort,
      // Only rename when the title still matches the previous member's
      // name — never clobber one the operator typed.
      title: props.meta?.title === boundMember()?.name ? m?.name : undefined,
    });
  };

  const commitRename = (next: string): void => {
    setEditing(false);
    if (next !== (props.meta?.title ?? '')) props.onRename(next);
  };

  /** Chat is the default view; the only way to leave the thread today is
   *  the history toggle, so the chat icon closes it. */
  const goChat = (): void => { if (props.historyOpen) props.onToggleHistory(); };

  return (
    <div class="flex flex-col border-b border-gray-800/60">
      <div class="flex items-center gap-2 px-2 py-1.5">
        <Show
          when={!editing()}
          fallback={
            <TitleEditor
              initial={props.meta?.title ?? ''}
              agentId={props.meta?.agentId}
              onCommit={commitRename}
              onCancel={() => setEditing(false)}
            />
          }
        >
          <span
            class="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0"
            style={{
              background: 'rgba(17,24,39,0.7)',
              // color-mix, not a hex+alpha concat: typeInfo().color is a
              // bare hex for most types but a `var(--theme-…)` reference
              // for the two fixed system agents (ATM12 follow-up).
              border: `1px solid color-mix(in srgb, ${typeInfo().color} 33%, transparent)`,
              color: typeInfo().color,
              'min-width': '20px',
            }}
            title={`${typeInfo().label}${props.meta?.agentId ? ` · ${props.meta.agentId}` : ''}`}
          >
            {typeInitial()}
          </span>
          <Show when={props.meta?.member}>
            <Show
              when={isDraft()}
              fallback={
                <span
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-gray-100 bg-gray-800/60 border border-gray-700/60 flex-shrink-0"
                  title={`Member: ${boundMember()?.name ?? props.meta?.member} — frozen after the first message`}
                >
                  <span aria-hidden="true">{boundMember()?.emoji ?? '🤖'}</span>
                  <span class="truncate max-w-[120px]">{boundMember()?.name ?? props.meta?.member}</span>
                </span>
              }
            >
              <MemberPicker current={props.meta!.member!} onPick={rebindMember} />
            </Show>
          </Show>
          <span class="flex-1 text-sm font-semibold text-gray-100 truncate">{title()}</span>
          <ModelEffortPickers
            conv={props.conv}
            model={modelId()}
            effort={effortId()}
            client={clientId()}
          />
          <Show when={snap()?.usage}>
            {(usage) => <UsageChip usage={usage()} />}
          </Show>
          <Show when={typeof snap()?.context?.fill_ratio === 'number'}>
            <ContextGauge context={snap()!.context!} />
          </Show>
          {/* V50 — the cockpit's `/debug/log` buffer dropped events
              (daemon unreachable or rejecting), so the interleaved
              daemon+cockpit tail has gaps until it drains. */}
          <Show when={debugDropCount() > 0}>
            <span
              class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-amber-200 bg-amber-500/10 border border-amber-500/30 flex-shrink-0"
              title={`Debug stream: ${debugDropCount()} event(s) dropped (buffer overflow). The daemon is unreachable or rejecting — /debug/tail will have gaps until the buffer drains.`}
            >
              ⚠ debug-drops {debugDropCount()}
            </span>
          </Show>
          <Show when={isConvWorking(props.conv)}>
            <StopButton conv={props.conv} />
          </Show>
        </Show>
        <Show when={!editing()}>
          <StripActions
            conv={props.conv}
            chatActive={!props.historyOpen}
            historyOpen={props.historyOpen}
            roleLabel={typeInfo().label}
            onGoChat={goChat}
            onRename={() => setEditing(true)}
            onToggleHistory={props.onToggleHistory}
            onOpenRoleMemory={props.onOpenRoleMemory}
            onArchive={props.onArchive}
          />
        </Show>
      </div>
      <Show when={fixedNote()}>
        {/* Pushed flush right with a real bottom margin (2026-07-07), and
            coloured off the theme accent rather than the rejected
            orange/red — same reasoning as AgentCard's pill. */}
        <p
          class="px-2.5 pb-1.5 mb-1.5 text-[10px] leading-snug text-right"
          style={{ color: 'var(--theme-accent-bright, #34d399)' }}
        >
          {fixedNote()}
        </p>
      </Show>
    </div>
  );
}
