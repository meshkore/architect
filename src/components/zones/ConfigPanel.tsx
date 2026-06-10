import { ClusterBlock, TokenBlock, DaemonBlock, MembersBlock, ModulesBlock, CredentialsBlock, StorageBlock } from './config/blocks';

export default function ConfigPanel() {
  return (
    <section class="min-w-0 max-w-3xl">
      <h2 class="text-sm font-mono uppercase tracking-wider text-gray-500 mb-4">Config &amp; cluster settings</h2>
      <ClusterBlock />
      <TokenBlock />
      <DaemonBlock />
      <StorageBlock />
      <CredentialsBlock />
      <MembersBlock />
      <ModulesBlock />
    </section>
  );
}
