/**
 * GeneralConfigPanel — MACHINE-LEVEL settings (not per-project).
 *
 * The MeshKore daemon is centralized: ONE shared process per Mac serving
 * every project (routed by the X-MeshKore-Project header) — no per-project
 * ports or copies. So the things that belong to the machine, not to a
 * single cluster, live here rather than in the per-project Config zone tab:
 *
 *   - Daemon controls (version · auto-update · rebuild · shutdown)
 *   - Remote control token (one operator credential across all projects)
 *   - Clients & providers (which CLIs run agents; provider API keys e.g. ZAI)
 *
 * Rendered inside GeneralConfigDrawer (a right slide-over opened by the gear
 * in the header, beside the theme picker). Per-project settings stay in
 * ConfigPanel (the Config zone tab).
 */

import { DaemonBlock, RemoteControlBlock, ClientsBlock } from '~/components/zones/config/blocks';

export default function GeneralConfigPanel() {
  return (
    <div class="min-w-0">
      <p class="text-[12px] text-gray-500 leading-relaxed mb-4">
        One shared daemon runs every project on this Mac (centralized — no
        per-project ports). These settings apply machine-wide, independent of
        which project you have open.
      </p>
      <DaemonBlock />
      <RemoteControlBlock />
      <ClientsBlock />
    </div>
  );
}
