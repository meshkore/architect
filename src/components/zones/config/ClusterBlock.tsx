import { daemonStore } from '~/state/daemon';
import { clusterInfo } from '~/state/server';
import { Block, KV, BtnRow, Btn } from './atoms';
import { CLUSTER_YAML, editYaml } from './yaml-shortcut';

export function ClusterBlock() {
  const info = () => clusterInfo();
  return (
    <Block title="Cluster" subtitle="Read-only — edit cluster.yaml to change.">
      <KV k="id" v={info()?.id ?? '—'} />
      <KV k="name" v={info()?.name ?? '—'} />
      <KV k="type" v={info()?.type ?? '—'} />
      <KV k="port" v={String(daemonStore.state.health?.port ?? '—')} />
      <KV k="identity" v={daemonStore.state.health?.identity ?? '—'} />
      <BtnRow>
        <Btn onClick={editYaml('Edit cluster.yaml')}>edit {CLUSTER_YAML}</Btn>
      </BtnRow>
    </Block>
  );
}
