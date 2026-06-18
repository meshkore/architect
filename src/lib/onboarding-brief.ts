/**
 * onboarding-brief.ts — welcome bubbles per agent type + the V46
 * "bootstrap brief" (context_doc attached to the Coordinator's
 * first turn when the cluster is empty).
 *
 * V86r — Per-agent welcomes. Each default agent type (Coordinator /
 * deploy / db / testing / audit / docs / review) gets its OWN
 * welcome line so the operator knows what that agent is for on the
 * first interaction. Plain-text agents (custom) get the Coordinator
 * line. Welcomes are seeded ONLY when the project has no prior chat
 * history (see seedOnboardingConv + createConv in state/chat.ts) —
 * we never want to greet the operator with "I'm new here" when they
 * already have months of conversation on record.
 */

import type { AgentType } from '~/state/chat';

export const ONBOARDING_COORDINATOR_AUTHOR = 'coordinator';

export function welcomeForAgentType(t: AgentType | string | undefined): string {
  switch (t) {
    case 'deploy':
      return (
        "I'm your **Deploy** agent. Tell me a target (Cloudflare Pages, " +
        "Workers, R2, Fly.io, custom host) and what you want shipped. I'll " +
        "build, verify the credentials, and run the deploy — and refuse to " +
        "ship uncommitted changes."
      );
    case 'db':
      return (
        "I'm your **DB** agent. Schema, migrations, seeds, dry-run plans. " +
        "Describe the model you need (or the change you want) and I'll " +
        "draft the migration + rollback before touching production data."
      );
    case 'testing':
      return (
        "I'm your **Testing** agent. Point me at a module / task / endpoint " +
        "and I'll write the integration tests + smoke runs to cover it. I " +
        "don't mock the database — that's the only way mock/prod divergence " +
        "stays caught."
      );
    case 'audit':
      return (
        "I'm your **Audit** agent. Drop a branch / PR / module and I'll " +
        "score it against the cluster's audit standards (`webapp/reference/" +
        "standards/audit/*`). Solid below 80 is a FAIL, no judgment calls."
      );
    case 'docs':
      return (
        "I'm your **Docs** agent. I keep `.meshkore/docs/` honest with the " +
        "code: architecture, conventions, deploy, security, ops. Tell me " +
        "what changed and I'll update the canonical doc + its links."
      );
    case 'review':
      return (
        "I'm your **Review** agent. Code review against the project's " +
        "conventions + the changed lines' context — not a generic checklist. " +
        "Give me the diff or branch name to start."
      );
    case 'custom':
    default:
      return (
        "I'm your **Coordinator**. Tell me what this project is — goal, " +
        "audience, rough shape — and I'll generate the initial roadmap, " +
        "tasks and context in `.meshkore/`."
      );
  }
}

/**
 * Legacy single-text shim for callers that haven't migrated to the
 * agent-type-aware helper above. Always returns the Coordinator copy.
 */
export function onboardingWelcomeText(): string {
  return welcomeForAgentType('custom');
}

export function onboardingBootstrapBrief(): string {
  return [
    '# Project bootstrap brief (MeshKore Coordinator role)',
    '',
    'You are the **Coordinator** agent for a freshly-scaffolded MeshKore cluster.',
    'The user has just installed `.meshkore/` and is about to describe what',
    'they want to build. This is the FIRST message of the project — no',
    'roadmap, no tasks, no initiatives exist yet.',
    '',
    '## How the system works (read this before acting)',
    '',
    '- A Python daemon is running locally in the user\'s project folder. It',
    '  watches `.meshkore/` and re-broadcasts state every ~1.5 seconds.',
    '- The user is staring at the MeshKore Architect cockpit in their browser:',
    '  modules tree on the left, roadmap initiatives in the centre, a Tasks /',
    '  Context / Diagrams subtab strip below the roadmap header, a chat panel',
    '  on the right.',
    '- **Anything you write inside `.meshkore/` becomes visible in the',
    '  architect within ~2 seconds, with no refresh.** Don\'t tell the user to',
    '  reload — just write the files and they\'ll see them.',
    '',
    '## Your job on this first turn',
    '',
    '1. Read the user\'s project description carefully.',
    '2. Consult https://api.meshkore.com/v1/standard.json for file shapes (initiative,',
    '   task_frontmatter, module layout).',
    '3. **Write first, talk after.** Don\'t fire a long list of clarifying',
    '   questions before writing anything. If the brief is at all actionable,',
    '   generate a reasonable v1 of:',
    '   - 1-3 initiatives under `.meshkore/roadmap/initiatives/<id>.md`',
    '   - 3-8 initial tasks under `.meshkore/modules/general/tasks/<id>.md`',
    '     (or a more appropriate module — create it under .meshkore/modules/',
    '     if needed)',
    '   - A short `.meshkore/docs/context.md` capturing the goal, audience,',
    '     constraints, and any non-obvious decisions from the brief.',
    '   Mark assumptions with a small `> assumption:` line inside each file',
    '   so the user can challenge them.',
    '4. Only after the writes, reply in chat with: (a) one paragraph summary',
    '   of what you wrote, (b) at most TWO open questions whose answers would',
    '   materially change the plan. Do NOT paste the file contents back; the',
    '   architect already shows them.',
    '',
    '## When the brief is genuinely too vague',
    '',
    'If the user typed something like "hi", "help me" or one-word answers',
    'with no project intent at all, ask ONE focused question — not five.',
    'Example: *"What problem is this project meant to solve, in one or two',
    'sentences?"* — then stop and wait.',
    '',
    '## Your role going forward',
    '',
    'You are this cluster\'s **master coordinator**. Other agents (deploy,',
    'test, doc, etc.) are subordinate — you decide who runs what.',
    '',
    '## Output format',
    '',
    'Plain markdown reply. The architect cockpit renders it in the chat',
    'thread. Keep it short — the roadmap itself is the artefact, not your',
    'summary.',
  ].join('\n');
}
