import { ProjectBlock, ClusterBlock, TokenBlock, MembersBlock, CredentialsBlock, StorageBlock } from './config/blocks';

/**
 * ConfigPanel — the per-PROJECT Config zone (the tab beside Diary).
 *
 * Kept deliberately narrow to what refers to THIS project: identity + which
 * daemon serves it, which private cluster it could connect to (to share an
 * agent cluster), its token, storage usage, credentials, and team members.
 * `Modules` was dropped (2026-07-09 operator call — no interest).
 *
 * Machine-level settings (the shared daemon controls, remote-control token,
 * and clients/providers incl. provider API keys) live behind the ⚙ gear in
 * the header (GeneralConfigDrawer), not here.
 *
 * Scrolls inside its own column (the parent `.col` is overflow:hidden) so a
 * tall config never gets clipped or pushes the page.
 */
export default function ConfigPanel() {
  return (
    <section class="min-w-0 flex-1 min-h-0 overflow-y-auto px-4 py-4">
      <div class="max-w-3xl">
        <div class="flex items-baseline justify-between gap-3 mb-4">
          <h2 class="text-sm font-mono uppercase tracking-wider text-gray-500">Project settings</h2>
          <span class="text-[11px] text-gray-600">Daemon · providers · remote → ⚙ top-right</span>
        </div>
        <ProjectBlock />
        <ClusterBlock />
        <TokenBlock />
        <StorageBlock />
        <CredentialsBlock />
        <MembersBlock />
      </div>
    </section>
  );
}
